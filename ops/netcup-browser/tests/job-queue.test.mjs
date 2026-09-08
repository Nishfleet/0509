// Focused tests for the bounded job queue: concurrency 1, atomic deadlines,
// idempotency keys, queue bounds, and cleanup on timeout/crash.

import { test } from "node:test";
import assert from "node:assert/strict";

import { JobQueue, QueueFullError, JobDeadlineError } from "../src/job-queue.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("concurrency is 1 and queue is bounded", async () => {
  let running = 0;
  let maxRunning = 0;
  const events = [];
  const queue = new JobQueue({
    concurrency: 1,
    maxQueued: 2,
    onJob: async (job) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      events.push(`start:${job.jobId}`);
      await sleep(30);
      running--;
      events.push(`end:${job.jobId}`);
      return { finalUrl: job.jobId };
    },
  });

  // Submit 3 synchronously (1 running + 2 queued); the 4th must be rejected
  // while the queue is still busy.
  const [j1, j2, j3] = [1, 2, 3].map((n) =>
    queue.submit({ kind: "landing_snapshot", jobId: `j${n}`, idempotencyKey: `k${n}`, enqueuedAt: Date.now() }),
  );
  assert.throws(
    () => queue.submit({ kind: "landing_snapshot", jobId: "j4", idempotencyKey: "k4", enqueuedAt: Date.now() }),
    QueueFullError,
  );
  const results = await Promise.all([j1, j2, j3].map((j) => j.promise));
  assert.equal(maxRunning, 1);
  assert.equal(results.every((r) => r.status === "completed"), true);
  assert.equal(results[0].finalUrl, "j1");
});

test("atomic deadline fails a slow job", async () => {
  const queue = new JobQueue({
    concurrency: 1,
    maxQueued: 1,
    onJob: async (job, { signal }) => {
      await sleep(200);
      if (signal.aborted) throw new Error("aborted");
      return { ok: true };
    },
  });
  const start = Date.now();
  const submitted = queue.submit({
    kind: "landing_snapshot",
    jobId: "slow",
    enqueuedAt: Date.now(),
    deadlineMs: Date.now() + 50,
    defaultDeadlineMs: 90_000,
  });
  const envelope = await submitted.promise;
  assert.equal(envelope.status, "failed");
  assert.equal(envelope.error.code, "deadline_exceeded");
  assert.ok(Date.now() - start < 500);
});

test("idempotency key replays the cached result without re-running", async () => {
  let executions = 0;
  const queue = new JobQueue({
    concurrency: 1,
    maxQueued: 4,
    onJob: async () => {
      executions++;
      return { finalUrl: "https://0509.io/share/x" };
    },
  });
  const first = queue.submit({ kind: "report_pdf", jobId: "a", idempotencyKey: "same", enqueuedAt: Date.now() });
  const envelope = await first.promise;
  assert.equal(envelope.status, "completed");

  const second = queue.submit({ kind: "report_pdf", jobId: "b", idempotencyKey: "same", enqueuedAt: Date.now() });
  assert.equal(second.cached, true);
  const replay = await second.promise;
  assert.equal(replay.jobId, "a");
  assert.equal(executions, 1);
});

test("failed jobs are not replayed as success and cleanup runs", async () => {
  let cleanup = 0;
  let executions = 0;
  const queue = new JobQueue({
    concurrency: 1,
    maxQueued: 4,
    onJob: async (job) => {
      executions++;
      try {
        throw new Error("boom");
      } finally {
        cleanup++;
      }
    },
  });
  const submitted = queue.submit({ kind: "landing_snapshot", jobId: "f", enqueuedAt: Date.now() });
  const envelope = await submitted.promise;
  assert.equal(envelope.status, "failed");
  assert.equal(envelope.error.code, "job_failed");
  assert.equal(cleanup, 1);

  // Re-submission with the same idempotency key replays the FAILED envelope
  // (client decides retry policy; no silent double execution).
  const again = queue.submit({ kind: "landing_snapshot", jobId: "f2", idempotencyKey: "f", enqueuedAt: Date.now() });
  const replayed = await again.promise;
  assert.equal(replayed.status, "failed");
  assert.equal(executions, 1);
});

test("queue stats stay consistent after work", async () => {
  const queue = new JobQueue({
    concurrency: 1,
    maxQueued: 2,
    onJob: async () => ({ ok: true }),
  });
  const s = queue.submit({ kind: "meta_discovery", jobId: "s1", enqueuedAt: Date.now() });
  await s.promise;
  const stats = queue.stats();
  assert.equal(stats.running, 0);
  assert.equal(stats.queued, 0);
  assert.equal(stats.completed, 1);
  assert.equal(stats.totalAccepted, 1);
});
