import { afterEach, describe, expect, it } from "vitest";

import {
  claimDigestScheduleJob,
  claimDigestScheduleJobExhaustionAlert,
  enqueueDigestScheduleJobs,
  exhaustStaleMaxAttemptDigestScheduleJobs,
  failDigestScheduleJob,
  listDigestScheduleJobsAwaitingAlert,
  listExhaustedDigestScheduleJobs,
  listRetryableDigestScheduleJobs,
  settleDigestScheduleJobExhaustionAlert,
} from "~/lib/data/digests.server";
import {
  createDigestScheduleJobRequeueKey,
  requeueExhaustedDigestScheduleJobWithAudit,
} from "~/lib/data/digest-schedule-recovery.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const harnesses: Array<ReturnType<typeof createSqliteD1>> = [];

function setupHarness() {
  const harness = createSqliteD1();
  harnesses.push(harness);
  harness.sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE customer_api_key (id TEXT PRIMARY KEY NOT NULL);
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
    INSERT INTO user VALUES ('owner-1', 'owner@example.com', 'Owner');
    INSERT INTO user VALUES ('operator-1', 'ops@example.com', 'Operator');
    INSERT INTO watchlist VALUES ('watch-1', 'owner-1', 1);
  `);
  applyMigration(harness.sqlite, "migrations/0035_agent_action_audit.sql");
  applyMigration(
    harness.sqlite,
    "migrations/0067_delivery_recovery_and_digest_jobs.sql",
  );
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("digest schedule exhaustion recovery", () => {
  it("makes a killed fifth claim visible instead of stranding a running job", async () => {
    const harness = setupHarness();
    const env = { DB: harness.db } as never;
    await enqueueDigestScheduleJobs(env, {
      cadence: "weekly",
      periodStart: "2026-07-06T05:00:00.000Z",
      periodEnd: "2026-07-13T05:00:00.000Z",
    });

    let jobId = "";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const [candidate] = await listRetryableDigestScheduleJobs(env, {
        staleRunningBefore: "2026-07-13T04:45:00.000Z",
        maxAttempts: 5,
        limit: 1,
      });
      expect(candidate).toBeDefined();
      jobId = candidate!.id;
      const claimed = await claimDigestScheduleJob(env, {
        jobId,
        processingToken: `killed-token-${attempt}`,
        now: `2026-07-13T05:0${attempt}:00.000Z`,
        staleRunningBefore: "2026-07-13T04:45:00.000Z",
        maxAttempts: 5,
      });
      expect(claimed?.attemptCount).toBe(attempt);
      if (attempt < 5) {
        await failDigestScheduleJob(env, {
          jobId,
          processingToken: `killed-token-${attempt}`,
          now: `2026-07-13T05:0${attempt}:30.000Z`,
          errorCode: "injected_failure",
        });
      }
    }

    await expect(
      exhaustStaleMaxAttemptDigestScheduleJobs(env, {
        staleRunningBefore: "2026-07-13T05:20:00.000Z",
        maxAttempts: 5,
        now: "2026-07-13T05:21:00.000Z",
      }),
    ).resolves.toBe(1);

    const [awaitingAlert] = await listDigestScheduleJobsAwaitingAlert(env, {
      staleAlertBefore: "2026-07-13T05:20:00.000Z",
      limit: 10,
    });
    expect(awaitingAlert).toMatchObject({
      id: jobId,
      status: "exhausted",
      attemptCount: 5,
      lastErrorCode: "digest_schedule_job_lease_exhausted",
    });
    const [alertA, alertB] = await Promise.all([
      claimDigestScheduleJobExhaustionAlert(env, {
        jobId,
        alertToken: "killed-alert-a",
        now: "2026-07-13T05:22:00.000Z",
        staleAlertBefore: "2026-07-13T05:20:00.000Z",
      }),
      claimDigestScheduleJobExhaustionAlert(env, {
        jobId,
        alertToken: "killed-alert-b",
        now: "2026-07-13T05:22:00.000Z",
        staleAlertBefore: "2026-07-13T05:20:00.000Z",
      }),
    ]);
    expect([alertA, alertB].filter(Boolean)).toHaveLength(1);
    await expect(
      listRetryableDigestScheduleJobs(env, {
        staleRunningBefore: "2026-07-13T06:00:00.000Z",
        maxAttempts: 5,
        limit: 10,
      }),
    ).resolves.toEqual([]);
  });

  it("makes the fifth failure visible, alerts once, and safely requeues with one audit", async () => {
    const harness = setupHarness();
    const env = { DB: harness.db } as never;
    await enqueueDigestScheduleJobs(env, {
      cadence: "weekly",
      periodStart: "2026-07-06T05:00:00.000Z",
      periodEnd: "2026-07-13T05:00:00.000Z",
    });

    let jobId = "";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const [candidate] = await listRetryableDigestScheduleJobs(env, {
        staleRunningBefore: "2026-07-13T04:45:00.000Z",
        maxAttempts: 5,
        limit: 1,
      });
      expect(candidate).toBeDefined();
      jobId = candidate!.id;
      const claimed = await claimDigestScheduleJob(env, {
        jobId,
        processingToken: `token-${attempt}`,
        now: `2026-07-13T05:0${attempt}:00.000Z`,
        staleRunningBefore: "2026-07-13T04:45:00.000Z",
        maxAttempts: 5,
      });
      expect(claimed?.attemptCount).toBe(attempt);
      await expect(
        failDigestScheduleJob(env, {
          jobId,
          processingToken: `token-${attempt}`,
          now: `2026-07-13T05:0${attempt}:30.000Z`,
          errorCode: "injected_failure",
          exhausted: attempt === 5,
        }),
      ).resolves.toBe(true);
    }

    await expect(
      listRetryableDigestScheduleJobs(env, {
        staleRunningBefore: "2026-07-13T06:00:00.000Z",
        maxAttempts: 5,
        limit: 10,
      }),
    ).resolves.toEqual([]);
    const [awaitingAlert] = await listDigestScheduleJobsAwaitingAlert(env, {
      staleAlertBefore: "2026-07-13T05:00:00.000Z",
      limit: 10,
    });
    expect(awaitingAlert).toMatchObject({
      id: jobId,
      status: "exhausted",
      attemptCount: 5,
      lastErrorCode: "injected_failure",
    });

    const [firstAlertClaim, secondAlertClaim] = await Promise.all([
      claimDigestScheduleJobExhaustionAlert(env, {
        jobId,
        alertToken: "alert-a",
        now: "2026-07-13T05:06:00.000Z",
        staleAlertBefore: "2026-07-13T05:00:00.000Z",
      }),
      claimDigestScheduleJobExhaustionAlert(env, {
        jobId,
        alertToken: "alert-b",
        now: "2026-07-13T05:06:00.000Z",
        staleAlertBefore: "2026-07-13T05:00:00.000Z",
      }),
    ]);
    const alertOwner = firstAlertClaim ? "alert-a" : "alert-b";
    expect([firstAlertClaim, secondAlertClaim].filter(Boolean)).toHaveLength(1);
    await expect(
      settleDigestScheduleJobExhaustionAlert(env, {
        jobId,
        alertToken: alertOwner,
        now: "2026-07-13T05:06:30.000Z",
        alerted: true,
      }),
    ).resolves.toBe(true);
    await expect(
      listDigestScheduleJobsAwaitingAlert(env, {
        staleAlertBefore: "2026-07-13T06:00:00.000Z",
        limit: 10,
      }),
    ).resolves.toEqual([]);

    const [exhausted] = await listExhaustedDigestScheduleJobs(env, {
      limit: 10,
    });
    const idempotencyKey = createDigestScheduleJobRequeueKey();
    const requeueInput = {
      operatorUserId: "operator-1",
      jobId,
      expectedUpdatedAt: exhausted!.updatedAt,
      idempotencyKey,
    };
    await expect(
      requeueExhaustedDigestScheduleJobWithAudit(env, requeueInput),
    ).resolves.toMatchObject({ ok: true, replayed: false, jobId });
    await expect(
      requeueExhaustedDigestScheduleJobWithAudit(env, requeueInput),
    ).resolves.toMatchObject({ ok: true, replayed: true, jobId });

    expect(
      harness.sqlite
        .prepare("SELECT COUNT(*) AS count FROM agent_action_audit")
        .get(),
    ).toMatchObject({ count: 1 });
    expect(
      harness.sqlite
        .prepare(
          "SELECT status, attempt_count FROM digest_schedule_job WHERE id = ?",
        )
        .get(jobId),
    ).toMatchObject({ status: "pending", attempt_count: 0 });

    const [recovered] = await Promise.all([
      claimDigestScheduleJob(env, {
        jobId,
        processingToken: "recovery-a",
        now: "2026-07-13T05:07:00.000Z",
        staleRunningBefore: "2026-07-13T05:00:00.000Z",
        maxAttempts: 5,
      }),
      claimDigestScheduleJob(env, {
        jobId,
        processingToken: "recovery-b",
        now: "2026-07-13T05:07:00.000Z",
        staleRunningBefore: "2026-07-13T05:00:00.000Z",
        maxAttempts: 5,
      }),
    ]).then((claims) => [claims.filter(Boolean)]);
    expect(recovered).toHaveLength(1);
  });
});
