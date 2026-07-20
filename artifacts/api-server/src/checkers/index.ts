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

/** Standardised result codes — every checker plugin MUST return one of these. */
export type ResultCode =
  | "ACTIVE"           // Logged in, plan still active
  | "PACKAGE_LOST"     // Logged in but subscription/plan no longer active
  | "PASSWORD_INVALID" // Wrong password
  | "ACCOUNT_BANNED"   // Account suspended / banned
  | "ACCOUNT_LOCKED"   // Account locked (not suspended, but inaccessible)
  | "REQUIRE_EMAIL"    // Needs email verification
  | "REQUIRE_PHONE"    // Needs phone / 2FA verification
  | "CAPTCHA"          // Bot-detection / CAPTCHA / rate-limit block
  | "NETWORK_ERROR"    // Connection issue
  | "TIMEOUT"          // Playwright timed out
  | "NO_PLUGIN"        // No checker registered for this product type
  | "UNKNOWN";         // Unrecognised state

export interface CheckResult {
  /** Standardised outcome code */
  code: ResultCode;
  /** Human-readable message shown in the UI */
  message: string;
  /** Wall-clock time of the check in ms, null if not applicable */
  responseTime: number | null;
  /** Base64-encoded screenshot on failure (optional) */
  screenshotBase64?: string;
  /** Playwright / browser log lines on failure (optional) */
  playwrightLog?: string;
}

export interface CheckOptions {
  /** Max ms to wait for the whole check (default: 60 000) */
  timeoutMs?: number;
  /**
   * Raw Cookie header value saved from a real browser session.
   * When set, the Grok checker uses fetch() directly (no Playwright / no
   * Cloudflare challenge) instead of the full browser login flow.
   * Example: "__Secure-next-auth.session-token=eyJ...; other=val"
   */
  sessionCookie?: string;
  /**
   * HTTP/SOCKS proxy for Playwright browser launch.
   * server format: "http://host:port" or "socks5://host:port"
   * When set, Playwright routes all traffic through this proxy — bypasses
   * Cloudflare datacenter IP blocks by using a residential proxy.
   */
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
}

export interface CheckerPlugin {
  /** Lowercase product identifier — matched against order product name */
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

/** Look up a plugin by product type key (case-insensitive). */
export function getPlugin(productType: string): CheckerPlugin | undefined {
  return registry.get((productType ?? "").toLowerCase().trim());
}

/** List all registered plugins. */
export function listPlugins(): CheckerPlugin[] {
  return [...registry.values()];
}

/**
 * Detect the checker plugin key from an order's productName.
 * Returns the plugin id string to pass to getPlugin().
 */
export function detectPluginType(productName: string): string {
  const lower = (productName ?? "").toLowerCase();
  if (lower.includes("grok")) return "grok";
  if (lower.includes("chatgpt") || lower.includes("openai") || lower.includes("gpt")) return "chatgpt";
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("claude") || lower.includes("anthropic")) return "claude";
  // Fallback: first word of product name
  return lower.split(/\s+/)[0] || "unknown";
}

// ── Register known plugins ────────────────────────────────────────────────────
// Import plugins AFTER registry is initialised to avoid circular-import issues.

import grokPlugin from "./grok.js";
import chatgptPlugin from "./chatgpt.js";

registerAll([
  grokPlugin,
  chatgptPlugin,
  // geminiPlugin,
  // claudePlugin,
]);
