// 0509 Netcup renderer — bounded job queue.
//
// One atomic deadline per job (absolute, enforced with a timer raced against
// the job promise), initial concurrency of 1, bounded FIFO queue, idempotency
// keys with result reuse, and completed-result retention for later pulls.

export class QueueFullError extends Error {
  constructor(message, status = 429) {
    super(message);
    this.name = "QueueFullError";
    this.status = status;
  }
}

export class QueueError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "QueueError";
    this.code = code;
    this.status = status;
  }
}

export class JobDeadlineError extends Error {
  constructor(message = "job deadline exceeded") {
    super(message);
    this.name = "JobDeadlineError";
    this.code = "deadline_exceeded";
    this.status = 408;
  }
}

/**
 * concurrency: how many jobs run at once (foundation pins this to 1).
 * maxQueued:   how many jobs may wait in the FIFO (bounded queue).
 * retentionMs: how long completed results are kept for idempotent replay.
 */
export class JobQueue {
  constructor({ concurrency = 1, maxQueued = 4, retentionMs = 24 * 60 * 60 * 1000, now = Date.now, onJob }) {
    if (concurrency < 1) throw new Error("concurrency must be >= 1");
    this.concurrency = concurrency;
    this.maxQueued = maxQueued;
    this.retentionMs = retentionMs;
    this.now = now;
    this.onJob = onJob;
    this.running = 0;
    this.queue = []; // waiting entries: { job, idemKey, resolve }
    this.completed = new Map(); // idempotencyKey -> result envelope
    this.totalAccepted = 0;
    this.totalRejected = 0;
  }

  /**
   * Submit a job. If a job with the same idempotencyKey completed within the
   * retention window, its result envelope is returned immediately (idempotent
   * replay, no re-execution). Returns { accepted, cached, promise } — the
   * promise always resolves with the job's result envelope.
   */
  submit(job) {
    if (!job || typeof job.kind !== "string") {
      throw new QueueError("invalid_job", "job.kind is required");
    }
    if (!job.jobId || typeof job.jobId !== "string") {
      throw new QueueError("invalid_job", "job.jobId is required");
    }
    const idemKey = job.idempotencyKey || job.jobId;
    const cached = this.completed.get(idemKey);
    if (cached) {
      return { accepted: true, cached: true, promise: Promise.resolve(cached), idempotencyKey: idemKey };
    }

    const now = this.now();
    if (job.deadlineMs !== undefined) {
      if (!Number.isFinite(job.deadlineMs) || job.deadlineMs <= now) {
        throw new QueueError("deadline_past", "job deadline must be in the future");
      }
      const budgetMs = job.maxDeadlineBudgetMs;
      if (budgetMs !== undefined && job.deadlineMs - now > budgetMs) {
        throw new QueueError("deadline_too_far", "job deadline exceeds the per-kind budget");
      }
    }

    if (this.running >= this.concurrency && this.queue.length >= this.maxQueued) {
      this.totalRejected++;
      throw new QueueFullError("queue full — retry later");
    }

    this.totalAccepted++;
    let resolveJob;
    const promise = new Promise((resolve) => {
      resolveJob = resolve;
    });
    this.queue.push({ job, idemKey, resolve: resolveJob });
    this.#pump();
    return { accepted: true, cached: false, promise, idempotencyKey: idemKey };
  }

  #pump() {
    if (this.running >= this.concurrency) return;
    this.running++;
    void (async () => {
      try {
        while (this.queue.length > 0) {
          const entry = this.queue.shift();
          const envelope = await this.#execute(entry.job);
          this.completed.set(entry.idemKey, envelope);
          entry.resolve(envelope);
          this.#sweepCompleted();
        }
      } finally {
        this.running--;
      }
    })();
  }

  async #execute(job) {
    const startedAt = this.now();
    const now = this.now();
    const deadlineMs = job.deadlineMs ?? startedAt + (job.defaultDeadlineMs ?? 90_000);
    const remainingMs = Math.max(0, deadlineMs - now);
    let deadlineTimer;
    const deadline = new Promise((_, reject) => {
      deadlineTimer = setTimeout(() => reject(new JobDeadlineError()), remainingMs);
    });
    try {
      // Race the job against its atomic deadline. The job's own finally must
      // still release engine resources when the deadline wins (the signal is
      // pre-aborted at deadline time).
      const signal = AbortSignal.timeout(remainingMs);
      const outcome = await Promise.race([Promise.resolve(this.onJob(job, { signal })), deadline]);
      return normalizeEnvelope(job, outcome, startedAt, this.now(), "completed");
    } catch (error) {
      const timedOut = error?.name === "JobDeadlineError" || error?.name === "TimeoutError";
      return normalizeEnvelope(job, error, startedAt, this.now(), "failed", timedOut);
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  #sweepCompleted() {
    const cutoff = this.now() - this.retentionMs;
    for (const [key, envelope] of this.completed) {
      if (envelope.finishedAt < cutoff) this.completed.delete(key);
    }
  }

  stats() {
    return {
      running: this.running,
      queued: this.queue.length,
      completed: this.completed.size,
      totalAccepted: this.totalAccepted,
      totalRejected: this.totalRejected,
    };
  }
}

function normalizeEnvelope(job, outcome, startedAt, finishedAt, status, timedOut = false) {
  const base = {
    jobId: job.jobId,
    kind: job.kind,
    idempotencyKey: job.idempotencyKey || job.jobId,
    status,
    startedAt,
    finishedAt,
    timingsMs: {
      queuedMs: startedAt - (job.enqueuedAt ?? startedAt),
      engineMs: finishedAt - startedAt,
    },
  };
  if (status === "completed") {
    const detail = outcome && typeof outcome === "object" ? outcome : {};
    return { ...base, ...detail, status: "completed", finishedAt };
  }
  const error = outcome instanceof Error ? outcome : new Error(String(outcome ?? "unknown error"));
  return {
    ...base,
    status: "failed",
    error: {
      code: error?.code || (timedOut ? "deadline_exceeded" : "job_failed"),
      message: error?.message || String(error),
    },
  };
}
