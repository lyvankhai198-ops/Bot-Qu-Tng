/**
 * productScanner.ts — Quét toàn bộ đơn hàng và phân tích tên sản phẩm
 * Thuần local, không gọi AI API — normalize → deduplicate → group → confidence.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProductNameStat {
  name: string;
  count: number;
  warrantyPattern: string | null;
  baseName: string;
  normalizedBase: string;
}

export interface FamilySuggestion {
  suggestedName: string;
  confidence: number;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  members: ProductNameStat[];
  warrantyVariants: string[];
  existingGuideId: string | null;
  existingGuideName: string | null;
  newAliases: string[];
}

export interface UnclassifiedProduct {
  name: string;
  count: number;
  reason: string;
}

export interface ScanResult {
  stats: {
    ordersScanned: number;
    uniqueNames: number;
    familiesFound: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    unclassified: number;
    guidesNew: number;
    aliasesNew: number;
  };
  families: FamilySuggestion[];
  unclassified: UnclassifiedProduct[];
  productStats: ProductNameStat[];
  scanTime: string;
}

export interface ApplyItem {
  suggestedName: string;
  aliases: string[];
  warrantyVariants: string[];
  confidence: number;
  confidenceLevel: string;
  existingGuideId: string | null;
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normStr(s: string): string {
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Known abbreviation equivalences (applied before grouping)
const ABBREV_MAP: Array<[RegExp, string]> = [
  [/\bchat\s*gpt\b/gi, 'chatgpt'],
  [/\bgpt\b/gi, 'chatgpt'],
  [/\bgoogle\s+gemini\b/gi, 'gemini'],
  [/\bms\s+365\b/gi, 'microsoft 365'],
  [/\boffice\s+365\b/gi, 'microsoft 365'],
  [/\bclaude\s+ai\b/gi, 'claude'],
];

function applyAbbrevs(s: string): string {
  let r = s;
  for (const [re, rep] of ABBREV_MAP) r = r.replace(re, rep);
  return r;
}

// ─── Warranty extraction ──────────────────────────────────────────────────────

// Order matters — longer patterns first to avoid partial matches
const WARRANTY_RULES: Array<{ regex: RegExp; label: (m: RegExpMatchArray) => string }> = [
  { regex: /\bBHF\b/i,                                        label: () => 'BHF' },
  { regex: /\bbảo\s*hành\s*forever\b/i,                       label: () => 'BHF' },
  { regex: /\bvĩnh\s*viễn\b/i,                                label: () => 'BHF' },
  { regex: /\bforever\b/i,                                     label: () => 'BHF' },
  { regex: /\bKBH\b/i,                                         label: () => 'KBH' },
  { regex: /\bkhông\s*bảo\s*hành\b/i,                         label: () => 'KBH' },
  { regex: /\bBH\s*(\d+)\s*(giờ|gio|h(?:ours?)?)\b/i,        label: m => `${m[1]}H` },
  { regex: /\bBH\s*(\d+)\s*(ngày|ngay|days?|d)\b/i,          label: m => `${m[1]}D` },
  { regex: /\bBH\s*(\d+)\s*(tháng|thang|months?|m)\b/i,      label: m => `${m[1]}M` },
  { regex: /\bBH\s*(\d+)\s*(năm|nam|years?|y)\b/i,           label: m => `${m[1]}Y` },
  { regex: /\b(\d+)\s*(giờ|gio|hours?)\b/i,                   label: m => `${m[1]}H` },
  { regex: /\b(\d+)\s*(ngày|ngay|days?)\b/i,                  label: m => `${m[1]}D` },
  { regex: /\b(\d+)\s*(tháng|thang|months?)\b/i,              label: m => `${m[1]}M` },
  { regex: /\b(\d+)\s*(năm|nam|years?)\b/i,                   label: m => `${m[1]}Y` },
  { regex: /\b(\d+)\s*D\b/i,                                  label: m => `${m[1]}D` },
  { regex: /\b(\d+)\s*M\b/i,                                  label: m => `${m[1]}M` },
  { regex: /\b(\d+)\s*Y\b/i,                                  label: m => `${m[1]}Y` },
  { regex: /\b(\d+)\s*H\b/i,                                  label: m => `${m[1]}H` },
  { regex: /\bbảo\s*hành\b/i,                                 label: () => 'BH' },
  { regex: /\bBH\b/i,                                          label: () => 'BH' },
];

function extractWarranty(name: string): { pattern: string; base: string } {
  let remaining = name;
  const found: string[] = [];

  for (const { regex, label } of WARRANTY_RULES) {
    const m = remaining.match(regex);
    if (m) {
      found.push(label(m));
      remaining = remaining.replace(regex, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  return { pattern: found.join('/'), base: remaining || name };
}

// ─── Garbage detection ────────────────────────────────────────────────────────

const GARBAGE_RE = [
  /^test\d*$/i,
  /^new\s*product$/i,
  /^[x_\-]{2,}$/i,
  /^[a-z]{1,2}\d+[a-z]{0,2}$/i,   // x1, ab2, abc3
  /^\d+$/,
  /^sample$/i,
  /^demo$/i,
  /^n\/a$/i,
];

function isGarbage(name: string): boolean {
  const t = name.trim();
  if (t.length <= 2) return true;
  return GARBAGE_RE.some(r => r.test(t));
}

// ─── String similarity ────────────────────────────────────────────────────────

/** Jaccard token similarity between two normalized strings */
function jaccard(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/).filter(Boolean));
  const setB = new Set(b.split(/\s+/).filter(Boolean));
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Minimum pairwise similarity within a group */
function groupCohesion(bases: string[]): number {
  if (bases.length <= 1) return 1;
  let min = 1;
  for (let i = 0; i < bases.length; i++) {
    for (let j = i + 1; j < bases.length; j++) {
      const s = jaccard(bases[i], bases[j]);
      if (s < min) min = s;
    }
  }
  return min;
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

function readJsonFile(dataDir: string, name: string, def: any = null): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf-8'));
  } catch { return def; }
}

function writeJsonFile(dataDir: string, name: string, data: any): void {
  fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Main scan ────────────────────────────────────────────────────────────────

export function scanProductFamilies(dataDir: string): ScanResult {
  const orders: Record<string, any>      = readJsonFile(dataDir, 'orders', {}) ?? {};
  const marketOrders: Record<string, any> = readJsonFile(dataDir, 'market_orders', {}) ?? {};
  const guides: any[]                    = readJsonFile(dataDir, 'product_guides', []) ?? [];

  // 1. Count raw product names
  const rawCounts = new Map<string, number>();
  const addName = (raw: unknown) => {
    if (!raw) return;
    const name = String(raw).trim();
    if (name) rawCounts.set(name, (rawCounts.get(name) ?? 0) + 1);
  };

  let ordersScanned = 0;
  for (const o of Object.values(orders)) {
    if (o && typeof o === 'object') { addName(o.productName); ordersScanned++; }
  }
  for (const o of Object.values(marketOrders)) {
    if (o && typeof o === 'object') { addName(o.product_name ?? o.productName); ordersScanned++; }
  }

  // 2. Classify each name
  const stats: ProductNameStat[] = [];
  const unclassified: UnclassifiedProduct[] = [];

  for (const [name, count] of rawCounts) {
    if (isGarbage(name)) {
      unclassified.push({ name, count, reason: 'Tên không hợp lệ / test data' });
      continue;
    }
    const { pattern, base } = extractWarranty(name);
    const normalizedBase = normStr(applyAbbrevs(base));
    stats.push({ name, count, warrantyPattern: pattern || null, baseName: base, normalizedBase });
  }

  // 3. Group by normalized base (exact)
  const groupMap = new Map<string, ProductNameStat[]>();
  for (const s of stats) {
    const arr = groupMap.get(s.normalizedBase) ?? [];
    arr.push(s);
    groupMap.set(s.normalizedBase, arr);
  }

  // 4. Merge singletons into best-matching multi-group (similarity ≥ 0.55)
  const multi = new Map([...groupMap].filter(([, g]) => g.length > 1));
  const singles = [...groupMap].filter(([, g]) => g.length === 1);

  for (const [key, [stat]] of singles) {
    let bestSim = 0.55; // threshold
    let bestKey: string | null = null;
    for (const [gKey] of multi) {
      const sim = jaccard(key, gKey);
      if (sim > bestSim) { bestSim = sim; bestKey = gKey; }
    }
    if (bestKey) {
      multi.get(bestKey)!.push(stat);
      groupMap.delete(key);
    }
  }

  // 5. Also try to merge singleton-to-singleton (threshold 0.7)
  const remainingSingles = [...groupMap].filter(([, g]) => g.length === 1);
  const mergedSingleKeys = new Set<string>();

  for (let i = 0; i < remainingSingles.length; i++) {
    const [keyA, [statA]] = remainingSingles[i];
    if (mergedSingleKeys.has(keyA)) continue;
    for (let j = i + 1; j < remainingSingles.length; j++) {
      const [keyB, [statB]] = remainingSingles[j];
      if (mergedSingleKeys.has(keyB)) continue;
      if (jaccard(keyA, keyB) >= 0.7) {
        // Merge B into A
        const arrA = groupMap.get(keyA)!;
        arrA.push(statB);
        groupMap.delete(keyB);
        mergedSingleKeys.add(keyB);
      }
    }
  }

  // 6. Build FamilySuggestion for each group
  const families: FamilySuggestion[] = [];

  for (const groupMembers of groupMap.values()) {
    const warrantyVariants = [...new Set(
      groupMembers.map(s => s.warrantyPattern).filter(Boolean) as string[]
    )];

    // Suggest canonical name: base with highest order count among members with no warranty suffix,
    // fallback to shortest base
    const noWty = groupMembers.filter(s => !s.warrantyPattern);
    const source = noWty.length > 0
      ? noWty.sort((a, b) => b.count - a.count)[0]
      : groupMembers.sort((a, b) => a.baseName.length - b.baseName.length)[0];
    const suggestedName = source.baseName;

    // Confidence
    const bases = groupMembers.map(s => s.normalizedBase);
    const uniqueBases = [...new Set(bases)];
    let confidence: number;
    let confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';

    if (groupMembers.length === 1) {
      confidence = 55;
      confidenceLevel = 'LOW';
    } else if (uniqueBases.length === 1) {
      // All same base after normalization → very high
      confidence = Math.min(99, 93 + groupMembers.length);
      confidenceLevel = 'HIGH';
    } else {
      const cohesion = groupCohesion(bases);
      if (cohesion >= 0.75) {
        confidence = Math.round(75 + cohesion * 22);
        confidenceLevel = 'HIGH';
      } else if (cohesion >= 0.5) {
        confidence = Math.round(50 + cohesion * 45);
        confidenceLevel = 'MEDIUM';
      } else {
        confidence = Math.round(Math.max(25, cohesion * 70));
        confidenceLevel = 'LOW';
      }
    }

    // Match against existing guides (exact, partial, token)
    let existingGuideId: string | null = null;
    let existingGuideName: string | null = null;
    let newAliases: string[] = [];

    const normSuggested = normStr(suggestedName);
    const allNames = groupMembers.map(s => s.name);

    for (const guide of guides) {
      const gNorm = normStr(guide.product ?? '');
      const gAliases: string[] = (guide.aliases ?? []).map((a: string) => normStr(a));
      const isMatch =
        gNorm === normSuggested ||
        gNorm.includes(normSuggested) ||
        normSuggested.includes(gNorm) ||
        jaccard(gNorm, normSuggested) >= 0.75 ||
        allNames.some(n => {
          const nn = normStr(n);
          return nn === gNorm || gAliases.includes(nn);
        });

      if (isMatch) {
        existingGuideId = guide.id;
        existingGuideName = guide.product;
        const existingSet = new Set([gNorm, ...gAliases]);
        newAliases = allNames.filter(n => {
          const nn = normStr(n);
          return !existingSet.has(nn);
        });
        break;
      }
    }

    if (!existingGuideId) {
      newAliases = allNames.filter(n => normStr(n) !== normSuggested);
    }

    families.push({
      suggestedName,
      confidence,
      confidenceLevel,
      members: groupMembers.sort((a, b) => b.count - a.count),
      warrantyVariants,
      existingGuideId,
      existingGuideName,
      newAliases,
    });
  }

  // Sort: HIGH first, then by total orders
  families.sort((a, b) => {
    const levelOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const lo = levelOrder[a.confidenceLevel] - levelOrder[b.confidenceLevel];
    if (lo !== 0) return lo;
    const sumA = a.members.reduce((s, x) => s + x.count, 0);
    const sumB = b.members.reduce((s, x) => s + x.count, 0);
    return sumB - sumA;
  });

  const highConf = families.filter(f => f.confidenceLevel === 'HIGH').length;
  const medConf  = families.filter(f => f.confidenceLevel === 'MEDIUM').length;
  const lowConf  = families.filter(f => f.confidenceLevel === 'LOW').length;
  const guidesNew = families.filter(f => !f.existingGuideId && f.confidenceLevel !== 'LOW').length;
  const aliasesNew = families.reduce((s, f) => s + f.newAliases.length, 0);

  return {
    stats: {
      ordersScanned,
      uniqueNames: stats.length + unclassified.length,
      familiesFound: families.length,
      highConfidence: highConf,
      mediumConfidence: medConf,
      lowConfidence: lowConf,
      unclassified: unclassified.length,
      guidesNew,
      aliasesNew,
    },
    families,
    unclassified,
    productStats: stats.sort((a, b) => b.count - a.count),
    scanTime: new Date().toISOString(),
  };
}

// ─── Apply selected suggestions ───────────────────────────────────────────────

export function applyScanResult(
  dataDir: string,
  items: ApplyItem[],
  adminName = 'admin',
): { created: number; updated: number; skipped: number } {
  const guides: any[] = readJsonFile(dataDir, 'product_guides', []) ?? [];
  const now = new Date().toISOString();
  let created = 0, updated = 0, skipped = 0;

  for (const item of items) {
    if (item.existingGuideId) {
      // Merge aliases into existing guide
      const idx = guides.findIndex((g: any) => g.id === item.existingGuideId);
      if (idx < 0) { skipped++; continue; }

      const guide = guides[idx];
      const existingAliases: string[] = guide.aliases ?? [];
      const existingNorms = new Set([
        normStr(guide.product ?? ''),
        ...existingAliases.map(normStr),
      ]);
      const toAdd = item.aliases.filter(a => !existingNorms.has(normStr(a)));
      const wvToAdd = item.warrantyVariants.filter(
        (v: string) => !(guide.warranty_variants ?? []).includes(v)
      );

      if (toAdd.length > 0 || wvToAdd.length > 0) {
        guide.aliases = [...existingAliases, ...toAdd];
        guide.warranty_variants = [...new Set([...(guide.warranty_variants ?? []), ...wvToAdd])];
        guide.updated_at = now;
        updated++;
      } else {
        skipped++;
      }
    } else {
      // Create new guide skeleton
      const normSuggested = normStr(item.suggestedName);
      const aliases = item.aliases.filter(a => normStr(a) !== normSuggested);

      const newGuide: any = {
        id: crypto.randomUUID().slice(0, 8),
        product: item.suggestedName,
        aliases,
        title: '',
        activation_guide: '',
        usage_guide: '',
        error_guide: '',
        warranty_guide: '',
        refund_note: '',
        enabled: true,
        warranty_variants: item.warrantyVariants,
        confidence: item.confidence,
        confidence_level: item.confidenceLevel,
        created_at: now,
        updated_at: now,
      };
      guides.push(newGuide);
      created++;
    }
  }

  writeJsonFile(dataDir, 'product_guides', guides);

  // Append to scan log
  const logs: any[] = readJsonFile(dataDir, 'scan_logs', []) ?? [];
  logs.unshift({
    scan_time: now,
    admin: adminName,
    items_applied: items.length,
    created,
    updated,
    skipped,
  });
  if (logs.length > 100) logs.splice(100);
  writeJsonFile(dataDir, 'scan_logs', logs);

  return { created, updated, skipped };
}
