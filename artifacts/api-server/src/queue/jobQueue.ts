/**
 * In-memory job queue for account health checks.
 *
 * Jobs are persisted to data/health_jobs.json on every mutation so they
 * survive a server restart. On boot, any job left in "running" state is
 * reset to "failed" (the worker process was killed mid-check).
 *
 * The module is a singleton — the first import initialises the queue from
 * disk and subsequent imports share the same state.
 */

import crypto from "crypto";
import { readJson, writeJson, now } from "../lib/dataUtils.js";
import type { CheckResult } from "../checkers/index.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface HealthJob {
  id: string;
  accountId: string;
  email: string;
  /** account.type — used to look up the correct checker plugin */
  type: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: CheckResult | null;
}

// ── Internal state ────────────────────────────────────────────────────────────

/** Source of truth — always sync to disk on mutations */
let jobs: HealthJob[] = [];
let initialised = false;

/** Keep at most this many finished jobs in memory/on disk */
const MAX_DONE_JOBS = 300;

function _persist() {
  writeJson("health_jobs", jobs);
}

function _ensureInit() {
  if (initialised) return;
  initialised = true;

  const persisted: HealthJob[] = readJson("health_jobs", []) ?? [];

  // Any job that was "running" when the server last stopped didn't finish.
  jobs = persisted.map((j) =>
    j.status === "running"
      ? {
          ...j,
          status: "failed",
          finishedAt: now(),
          result: {
            status: "error",
            message: "Server khởi động lại trong khi đang kiểm tra",
            responseTime: null,
          },
        }
      : j,
  );

  if (persisted.some((j) => j.status === "running")) {
    _persist();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueue an account for health checking.
 * If there is already a queued or running job for this account, return it
 * instead of creating a duplicate.
 */
export function enqueue(account: {
  id: string;
  email: string;
  type: string;
}): HealthJob {
  _ensureInit();

  // Dedup: don't pile up jobs for the same account
  const existing = jobs.find(
    (j) =>
      j.accountId === account.id &&
      (j.status === "queued" || j.status === "running"),
  );
  if (existing) return existing;

  const job: HealthJob = {
    id: crypto.randomUUID().slice(0, 12),
    accountId: account.id,
    email: account.email,
    type: account.type ?? "",
    status: "queued",
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
    result: null,
  };

  jobs.push(job);
  _persist();
  return job;
}

/** Get the next job that is still queued, or null if the queue is empty. */
export function getNextQueued(): HealthJob | null {
  _ensureInit();
  return jobs.find((j) => j.status === "queued") ?? null;
}

/** Number of jobs currently being processed by workers. */
export function countRunning(): number {
  _ensureInit();
  return jobs.filter((j) => j.status === "running").length;
}

/** Update a subset of a job's fields. */
export function updateJob(id: string, patch: Partial<HealthJob>) {
  _ensureInit();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  jobs[idx] = { ...jobs[idx], ...patch };
  _persist();
}

/**
 * Return jobs, newest first.
 * Optionally filter by status and/or accountId.
 */
export function getJobs(filter?: {
  status?: string | string[];
  accountId?: string;
}): HealthJob[] {
  _ensureInit();
  let result = [...jobs];

  if (filter?.accountId) {
    result = result.filter((j) => j.accountId === filter.accountId);
  }
  if (filter?.status) {
    const statuses = Array.isArray(filter.status)
      ? filter.status
      : [filter.status];
    result = result.filter((j) => statuses.includes(j.status));
  }

  return result.reverse(); // newest first
}

/** True if any job is still queued or running. */
export function hasActiveJobs(): boolean {
  _ensureInit();
  return jobs.some((j) => j.status === "queued" || j.status === "running");
}

/** Remove finished jobs from the queue (optionally scoped to one account). */
export function clearDoneJobs(accountId?: string) {
  _ensureInit();
  if (accountId) {
    jobs = jobs.filter(
      (j) =>
        !(
          j.accountId === accountId &&
          (j.status === "done" || j.status === "failed")
        ),
    );
  } else {
    jobs = jobs.filter(
      (j) => j.status === "queued" || j.status === "running",
    );
  }
  _persist();
}

/** Trim old completed jobs to stay within MAX_DONE_JOBS. */
export function trimOldJobs() {
  _ensureInit();
  const active = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const done = jobs.filter(
    (j) => j.status === "done" || j.status === "failed",
  );
  if (done.length <= MAX_DONE_JOBS) return;

  jobs = [...active, ...done.slice(-MAX_DONE_JOBS)];
  _persist();
}
