/**
 * Plugin registry for account health checkers.
 *
 * Each product (Grok, ChatGPT, Gemini, …) lives in its own file and exports a
 * default CheckerPlugin object. This module imports them explicitly — no
 * dynamic file-scanning needed — which keeps esbuild bundling predictable.
 *
 * To add a new product:
 *   1. Create  src/checkers/<product>.ts  implementing CheckerPlugin
 *   2. Add     import <product>Plugin from "./<product>.js";
 *   3. Add the plugin to the array passed to registerAll()
 */

// ── Types (re-exported so callers only need one import) ──────────────────────

export interface CheckResult {
  /** Health outcome */
  status: "healthy" | "unhealthy" | "error" | "no_plugin";
  /** Human-readable message shown in the UI */
  message: string;
  /** Wall-clock time of the check in ms, null if not applicable */
  responseTime: number | null;
  /** Extra detail for debugging (not shown in main UI) */
  detail?: string;
}

export interface CheckOptions {
  /** Max ms to wait for the whole check (default: 60 000) */
  timeoutMs?: number;
}

export interface CheckerPlugin {
  /** Lowercase product identifier — matched against account.type (case-insensitive) */
  id: string;
  /** Display name shown in the UI */
  name: string;
  /** Perform the actual check using Playwright */
  check(
    email: string,
    password: string,
    options?: CheckOptions,
  ): Promise<CheckResult>;
}

// ── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<string, CheckerPlugin>();

function registerAll(plugins: CheckerPlugin[]) {
  for (const p of plugins) {
    registry.set(p.id.toLowerCase(), p);
  }
}

/** Look up a plugin by account type (case-insensitive). */
export function getPlugin(accountType: string): CheckerPlugin | undefined {
  return registry.get((accountType ?? "").toLowerCase().trim());
}

/** List all registered plugins. */
export function listPlugins(): CheckerPlugin[] {
  return [...registry.values()];
}

// ── Register known plugins ────────────────────────────────────────────────────
// Import plugins AFTER registry is initialised to avoid circular-import issues.

import grokPlugin from "./grok.js";

registerAll([
  grokPlugin,
  // Add more here as they are implemented:
  // chatgptPlugin,
  // geminiPlugin,
  // claudePlugin,
]);
