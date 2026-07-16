import { afterEach, describe, expect, it } from "vitest";

import {
  claimDigestScheduleJob,
  completeDigestScheduleJob,
  enqueueDigestScheduleJobs,
  failDigestScheduleJob,
  listRetryableDigestScheduleJobs,
} from "~/lib/data/digests.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const openHarnesses: Array<ReturnType<typeof createSqliteD1>> = [];

function setupHarness() {
  const harness = createSqliteD1();
  openHarnesses.push(harness);
  harness.sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE delivery_attempt (
      id TEXT PRIMARY KEY NOT NULL,
      lane TEXT NOT NULL,
      channel TEXT NOT NULL,
      watchlist_id TEXT,
      digest_run_id TEXT,
      delivery_target_id TEXT,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL,
      webhook_status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO user (id, email, name) VALUES
      ('user-b', 'b@example.com', 'Owner B'),
      ('user-a', 'a@example.com', 'Owner A');
    INSERT INTO watchlist (id, user_id, is_active) VALUES
      ('watch-b', 'user-b', 1),
      ('watch-a', 'user-a', 1),
      ('watch-a-duplicate', 'user-a', 1);
  `);
  applyMigration(harness.sqlite, "migrations/0067_delivery_recovery_and_digest_jobs.sql");
  return harness;
}

afterEach(() => {
  for (const harness of openHarnesses.splice(0)) harness.close();
});

describe("digest schedule jobs", () => {
  it("enqueues one durable ordered job per active workspace and period", async () => {
    const harness = setupHarness();
    const input = {
      cadence: "weekly" as const,
      periodStart: "2026-07-06T05:00:00.000Z",
      periodEnd: "2026-07-13T05:00:00.000Z",
    };

    await expect(enqueueDigestScheduleJobs({ DB: harness.db } as never, input)).resolves.toBe(2);
    await expect(enqueueDigestScheduleJobs({ DB: harness.db } as never, input)).resolves.toBe(0);

    const jobs = await listRetryableDigestScheduleJobs(
      { DB: harness.db } as never,
      {
        staleRunningBefore: "2026-07-13T04:45:00.000Z",
        maxAttempts: 5,
        limit: 50,
      },
    );
    expect(jobs.map((job) => job.userId)).toEqual(["user-a", "user-b"]);
  });

  it("allows one concurrent owner and reclaims only an expired running lease", async () => {
    const harness = setupHarness();
    await enqueueDigestScheduleJobs(
      { DB: harness.db } as never,
      {
        cadence: "weekly",
        periodStart: "2026-07-06T05:00:00.000Z",
        periodEnd: "2026-07-13T05:00:00.000Z",
      },
    );
    const [candidate] = await listRetryableDigestScheduleJobs(
      { DB: harness.db } as never,
      {
        staleRunningBefore: "2026-07-13T04:45:00.000Z",
        maxAttempts: 5,
        limit: 1,
      },
    );
    expect(candidate).toBeDefined();

    const claimInput = {
      jobId: candidate!.id,
      now: "2026-07-13T05:00:00.000Z",
      staleRunningBefore: "2026-07-13T04:45:00.000Z",
      maxAttempts: 5,
    };
    const [first, second] = await Promise.all([
      claimDigestScheduleJob(
        { DB: harness.db } as never,
        { ...claimInput, processingToken: "token-a" },
      ),
      claimDigestScheduleJob(
        { DB: harness.db } as never,
        { ...claimInput, processingToken: "token-b" },
      ),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);

    await expect(
      claimDigestScheduleJob(
        { DB: harness.db } as never,
        {
          ...claimInput,
          processingToken: "token-c",
          now: "2026-07-13T05:14:59.000Z",
          staleRunningBefore: "2026-07-13T04:59:59.000Z",
        },
      ),
    ).resolves.toBeNull();

    const reclaimed = await claimDigestScheduleJob(
      { DB: harness.db } as never,
      {
        ...claimInput,
        processingToken: "token-c",
        now: "2026-07-13T05:15:01.000Z",
        staleRunningBefore: "2026-07-13T05:00:01.000Z",
      },
    );
    expect(reclaimed?.attemptCount).toBe(2);
    await expect(
      completeDigestScheduleJob(
        { DB: harness.db } as never,
        {
          jobId: candidate!.id,
          processingToken: "token-a",
          now: "2026-07-13T05:15:02.000Z",
        },
      ),
    ).resolves.toBe(false);
    await expect(
      completeDigestScheduleJob(
        { DB: harness.db } as never,
        {
          jobId: candidate!.id,
          processingToken: "token-c",
          now: "2026-07-13T05:15:02.000Z",
        },
      ),
    ).resolves.toBe(true);
  });

  it("keeps definite local failures retryable without exposing raw errors", async () => {
    const harness = setupHarness();
    await enqueueDigestScheduleJobs(
      { DB: harness.db } as never,
      {
        cadence: "daily",
        periodStart: "2026-07-12T04:00:00.000Z",
        periodEnd: "2026-07-13T04:00:00.000Z",
      },
    );
    const [candidate] = await listRetryableDigestScheduleJobs(
      { DB: harness.db } as never,
      {
        staleRunningBefore: "2026-07-13T03:45:00.000Z",
        maxAttempts: 5,
        limit: 1,
      },
    );
    const claimed = await claimDigestScheduleJob(
      { DB: harness.db } as never,
      {
        jobId: candidate!.id,
        processingToken: "token-a",
        now: "2026-07-13T04:00:00.000Z",
        staleRunningBefore: "2026-07-13T03:45:00.000Z",
        maxAttempts: 5,
      },
    );
    expect(claimed).not.toBeNull();
    await expect(
      failDigestScheduleJob(
        { DB: harness.db } as never,
        {
          jobId: candidate!.id,
          processingToken: "token-a",
          now: "2026-07-13T04:00:01.000Z",
          errorCode: "digest_schedule_job_failed",
        },
      ),
    ).resolves.toBe(true);

    const retryable = await listRetryableDigestScheduleJobs(
      { DB: harness.db } as never,
      {
        staleRunningBefore: "2026-07-13T04:00:01.000Z",
        maxAttempts: 5,
        limit: 1,
      },
    );
    expect(retryable[0]).toEqual(expect.objectContaining({ id: candidate!.id, attemptCount: 1 }));
    const stored = harness.sqlite
      .prepare("SELECT last_error_code FROM digest_schedule_job WHERE id = ?")
      .get(candidate!.id) as { last_error_code: string };
    expect(stored.last_error_code).toBe("digest_schedule_job_failed");
  });
});
