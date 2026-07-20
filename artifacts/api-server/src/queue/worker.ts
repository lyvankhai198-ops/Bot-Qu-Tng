/**
 * Health-check worker loop.
 *
 * Polls the job queue every POLL_MS milliseconds. On each tick it picks up to
 * `workerCount` (from health config, default 2) "queued" jobs, marks them
 * "running", runs the appropriate checker plugin, saves results to
 * order_health.json, and marks the job "done" or "failed".
 *
 * Data source: reads email, password, twoFA from orders.json using orderId.
 * Results: saved to order_health.json, keyed by orderId.
 */

import {
  getNextQueued,
  updateJob,
  countRunning,
  trimOldJobs,
} from "./jobQueue.js";
import type { HealthJob } from "./jobQueue.js";
import { getPlugin, listPlugins } from "../checkers/index.js";
import type { CheckResult } from "../checkers/index.js";
import { readJson, writeJson, now } from "../lib/dataUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const POLL_MS = 2_000;
const MAX_HISTORY = 50;

// ── State ─────────────────────────────────────────────────────────────────────

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWorkerConfig(): {
  workerCount: number;
  timeoutMs: number;
  proxy?: { server: string; username?: string; password?: string };
} {
  try {
    const h = readJson("order_health", { config: {} }) ?? { config: {} };
    const cfg = h.config ?? {};
    const n = Number(cfg.workerCount ?? 2);
    const t = Number(cfg.timeoutMs ?? 60_000);
    const proxyServer: string = (cfg.proxyServer ?? "").trim();
    const proxy = proxyServer
      ? {
          server: proxyServer,
          username: (cfg.proxyUsername ?? "").trim() || undefined,
          password: (cfg.proxyPassword ?? "").trim() || undefined,
        }
      : undefined;
    return {
      workerCount: Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 10) : 2,
      timeoutMs: Number.isFinite(t) && t >= 5_000 ? t : 120_000,
      proxy,
    };
  } catch {
    return { workerCount: 2, timeoutMs: 60_000 };
  }
}

function saveHealthEntry(
  orderId: string,
  entry: {
    checkedAt: string;
    code: string;
    message: string;
    responseTime: number | null;
    plugin: string;
    screenshotBase64?: string;
    playwrightLog?: string;
  },
) {
  const h = readJson("order_health", { config: {}, checks: {} }) ?? {
    config: {},
    checks: {},
  };
  if (!h.checks) h.checks = {};
  if (!h.checks[orderId]) h.checks[orderId] = [];
  h.checks[orderId].push(entry);
  // Keep only the last MAX_HISTORY entries per order
  if (h.checks[orderId].length > MAX_HISTORY) {
    h.checks[orderId] = h.checks[orderId].slice(-MAX_HISTORY);
  }
  writeJson("order_health", h);
}

// ── Core job processor ────────────────────────────────────────────────────────

async function processJob(job: HealthJob): Promise<void> {
  let result: CheckResult;

  const plugin = getPlugin(job.type);

  if (!plugin) {
    const available = listPlugins().map(p => p.name).join(", ") || "chưa có";
    result = {
      code: "NO_PLUGIN",
      message: `Chưa có plugin cho loại "${job.type || "?"}". Hỗ trợ: ${available}`,
      responseTime: null,
    };
  } else {
    // Read current credentials from orders (may have changed since enqueue)
    const orders: Record<string, any> = readJson("orders", {}) ?? {};
    const order = orders[job.orderId];
    const password: string = order?.password ?? "";
    const sessionCookie: string | undefined =
      order?.grokSessionCookie ? String(order.grokSessionCookie) : undefined;

    const { timeoutMs, proxy } = getWorkerConfig();

    try {
      result = await plugin.check(job.email, password, {
        timeoutMs,
        sessionCookie,
        proxy,
      });
    } catch (err: any) {
      result = {
        code: "UNKNOWN",
        message: `Plugin error: ${err?.message?.slice(0, 200) ?? String(err)}`,
        responseTime: null,
      };
    }
  }

  saveHealthEntry(job.orderId, {
    checkedAt: now(),
    code: result.code,
    message: result.message,
    responseTime: result.responseTime,
    plugin: plugin?.id ?? "none",
    screenshotBase64: result.screenshotBase64,
    playwrightLog: result.playwrightLog,
  });

  // ACTIVE and PACKAGE_LOST = done (check completed successfully)
  // Everything else = failed (need attention)
  const finalStatus: "done" | "failed" =
    result.code === "ACTIVE" || result.code === "PACKAGE_LOST"
      ? "done"
      : "failed";

  updateJob(job.id, {
    status: finalStatus,
    finishedAt: now(),
    result,
  });

  trimOldJobs();
}

// ── Tick ──────────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const { workerCount } = getWorkerConfig();
  const alreadyRunning = countRunning();
  const slots = workerCount - alreadyRunning;

  if (slots <= 0) return;

  const toProcess: HealthJob[] = [];
  for (let i = 0; i < slots; i++) {
    const job = getNextQueued();
    if (!job) break;
    updateJob(job.id, { status: "running", startedAt: now() });
    toProcess.push({ ...job, status: "running" });
  }

  if (toProcess.length === 0) return;

  await Promise.allSettled(
    toProcess.map((job) =>
      processJob(job).catch((err) => {
        console.error(`[worker] Unhandled error in job ${job.id}:`, err);
        updateJob(job.id, {
          status: "failed",
          finishedAt: now(),
          result: {
            code: "UNKNOWN",
            message: `Unhandled: ${err?.message?.slice(0, 200) ?? String(err)}`,
            responseTime: null,
          },
        });
      }),
    ),
  );
}

// ── Public lifecycle ──────────────────────────────────────────────────────────

export function startWorker(): void {
  if (running) return;
  running = true;
  console.log("[health-worker] Started (polling every", POLL_MS, "ms)");

  const loop = async () => {
    if (!running) return;
    try {
      await tick();
    } catch (err) {
      console.error("[health-worker] tick error:", err);
    }
    timer = setTimeout(loop, POLL_MS);
  };

  loop();
}

export function stopWorker(): void {
  running = false;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  console.log("[health-worker] Stopped");
}
