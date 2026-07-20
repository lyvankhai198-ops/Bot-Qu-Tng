/**
 * Health-check worker loop.
 *
 * Polls the job queue every POLL_MS milliseconds. On each tick it picks up to
 * `workerCount` (from health config, default 2) "queued" jobs, marks them
 * "running", runs the appropriate checker plugin, saves results to
 * account_health.json, and marks the job "done" or "failed".
 *
 * Multiple jobs run concurrently (Promise.allSettled) so the effective
 * throughput is workerCount checks per POLL_MS + check duration.
 */

import {
  getNextQueued,
  updateJob,
  countRunning,
  trimOldJobs,
} from "./jobQueue.js";
import type { HealthJob } from "./jobQueue.js";
import { getPlugin } from "../checkers/index.js";
import type { CheckResult } from "../checkers/index.js";
import { readJson, writeJson, now } from "../lib/dataUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const POLL_MS = 2_000;
const MAX_HISTORY = 50;

// ── State ─────────────────────────────────────────────────────────────────────

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWorkerCount(): number {
  try {
    const h = readJson("account_health", { config: {} }) ?? { config: {} };
    const n = Number((h.config ?? {}).workerCount ?? 2);
    return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 10) : 2;
  } catch {
    return 2;
  }
}

function saveHealthEntry(
  accountId: string,
  entry: {
    checkedAt: string;
    status: string;
    message: string;
    responseTime: number | null;
    httpStatus: number | null;
    plugin: string;
  },
) {
  const h = readJson("account_health", { config: {}, checks: {} }) ?? {
    config: {},
    checks: {},
  };
  if (!h.checks) h.checks = {};
  if (!h.checks[accountId]) h.checks[accountId] = [];
  h.checks[accountId].push(entry);
  if (h.checks[accountId].length > MAX_HISTORY) {
    h.checks[accountId] = h.checks[accountId].slice(-MAX_HISTORY);
  }
  writeJson("account_health", h);
}

// ── Core job processor ────────────────────────────────────────────────────────

async function processJob(job: HealthJob): Promise<void> {
  let result: CheckResult;

  const plugin = getPlugin(job.type);

  if (!plugin) {
    result = {
      status: "no_plugin",
      message: `Chưa có plugin kiểm tra cho loại tài khoản "${job.type || "không xác định"}". Plugin hiện có: ${
        ["grok"].join(", ")
      }`,
      responseTime: null,
    };
  } else {
    // Read current password from accounts (may have changed since enqueue)
    const accounts: any[] = readJson("accounts", []) ?? [];
    const acc = accounts.find((a: any) => a.id === job.accountId);
    const password: string = acc?.password ?? "";

    // Read timeout from health config
    const h = readJson("account_health", { config: {} }) ?? { config: {} };
    const timeoutMs = Number((h.config ?? {}).timeoutMs ?? 60_000);

    try {
      result = await plugin.check(job.email, password, { timeoutMs });
    } catch (err: any) {
      result = {
        status: "error",
        message: `Plugin error: ${err?.message?.slice(0, 200) ?? String(err)}`,
        responseTime: null,
      };
    }
  }

  // Map "no_plugin" → "error" for the health history (UI only knows healthy/unhealthy/error/manual)
  const historyStatus =
    result.status === "no_plugin" ? "error" : result.status;

  saveHealthEntry(job.accountId, {
    checkedAt: now(),
    status: historyStatus,
    message: result.message,
    responseTime: result.responseTime,
    httpStatus: null,
    plugin: plugin?.id ?? "none",
  });

  const finalStatus =
    result.status === "healthy" || result.status === "unhealthy"
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
  const workerCount = getWorkerCount();
  const alreadyRunning = countRunning();
  const slots = workerCount - alreadyRunning;

  if (slots <= 0) return;

  // Pick up to `slots` queued jobs and mark them running atomically before
  // launching async work, so the next iteration won't double-pick them.
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
            status: "error",
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
