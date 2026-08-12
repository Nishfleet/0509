import { describe, expect, it, vi } from "vitest";

import { action, evaluateReleaseSoak } from "~/routes/api.release-soak";

const STARTED_AT = "2026-07-18T00:00:00.000Z";
const ENDED_AT = "2026-07-19T00:00:00.000Z";

type Observation = Parameters<typeof evaluateReleaseSoak>[0][number];
type ScheduledRunSlo = Parameters<typeof evaluateReleaseSoak>[2];
type DigestJobSlo = Parameters<typeof evaluateReleaseSoak>[3];

function healthyRunSlo(overrides: Partial<ScheduledRunSlo> = {}): ScheduledRunSlo {
  return {
    totalRuns: 1,
    succeededRuns: 1,
    failedRuns: 0,
    pendingRuns: 0,
    runningRuns: 0,
    skippedRuns: 0,
    degradedRuns: 0,
    maxCompletionMs: 60_000,
    ...overrides,
  };
}

function healthyDigestJobSlo(overrides: Partial<DigestJobSlo> = {}): DigestJobSlo {
  return {
    totalJobs: 1,
    completedJobs: 1,
    failedJobs: 0,
    pendingJobs: 0,
    runningJobs: 0,
    exhaustedJobs: 0,
    retriedJobs: 0,
    deliveryAttempts: 1,
    sentDeliveryAttempts: 1,
    unresolvedDeliveryAttempts: 0,
    maxCompletionMs: 60_000,
    ...overrides,
  };
}

function row(cron: string, taskName: string, scheduledAt: string): Observation {
  return {
    cron,
    task_name: taskName,
    scheduled_at: scheduledAt,
    started_at: new Date(Date.parse(scheduledAt) + 1_000).toISOString(),
    completed_at: new Date(Date.parse(scheduledAt) + 2_000).toISOString(),
    duration_ms: 1_000,
    outcome: "no_work",
    failure_category: null,
    metrics_json: "{}",
  } as Observation;
}

function completeWindow(): Observation[] {
  const rows: Observation[] = [];
  const warmupTasks = [
    "billing_lifecycle_email_recovery",
    "digest_schedule_exhaustion_recovery",
    "digest_schedule_recovery",
    "discovery_warmup",
    "monitoring_fanout_reconciliation",
    "instant_alert_flush",
    "retention_sweep",
    "presence_polling_batch",
  ];
  const monitoringTasks = ["billing_lifecycle_email_recovery", "scheduled_monitoring"];
  for (const hour of [0, 3, 6, 9, 12, 15, 18, 21]) {
    const scheduledAt = `2026-07-18T${String(hour).padStart(2, "0")}:00:00.000Z`;
    for (const task of monitoringTasks) rows.push(row("0 */3 * * *", task, scheduledAt));
  }
  for (const hour of [0, 6, 12, 18]) {
    const scheduledAt = `2026-07-18T${String(hour).padStart(2, "0")}:17:00.000Z`;
    for (const task of warmupTasks) rows.push(row("17 */6 * * *", task, scheduledAt));
  }
  for (const task of monitoringTasks) {
    rows.push(row("0 4 * * *", task, "2026-07-18T04:00:00.000Z"));
  }
  rows.push(row("0 4 * * *", "customer_at_risk_alert", "2026-07-18T04:00:00.000Z"));
  const regular = rows.find((entry) =>
    entry.cron === "0 */3 * * *" && entry.task_name === "scheduled_monitoring"
  )!;
  regular.outcome = "completed";
  regular.metrics_json = JSON.stringify({ queued: 1, inlineRuns: 0 });
  const daily = rows.find((entry) =>
    entry.cron === "0 4 * * *" && entry.task_name === "scheduled_monitoring"
  )!;
  daily.outcome = "completed";
  daily.metrics_json = JSON.stringify({ digests: 1 });
  return rows;
}

function windowInput() {
  return { startedAtMs: Date.parse(STARTED_AT), endedAtMs: Date.parse(ENDED_AT) };
}

function createContext(rows: Observation[] = completeWindow()) {
  const all = vi.fn().mockResolvedValue({ results: rows });
  const scheduledRunFirst = vi.fn().mockResolvedValue({
    total_runs: 1,
    succeeded_runs: 1,
    failed_runs: 0,
    pending_runs: 0,
    running_runs: 0,
    skipped_runs: 0,
    degraded_runs: 0,
    max_completion_ms: 60_000,
  });
  const digestJobFirst = vi.fn().mockResolvedValue({
    total_jobs: 1,
    completed_jobs: 1,
    failed_jobs: 0,
    pending_jobs: 0,
    running_jobs: 0,
    exhausted_jobs: 0,
    retried_jobs: 0,
    delivery_attempts: 1,
    sent_delivery_attempts: 1,
    unresolved_delivery_attempts: 0,
    max_completion_ms: 60_000,
  });
  const bind = vi.fn().mockImplementation(() => ({ all, first: scheduledRunFirst }));
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: (...args: unknown[]) => {
      bind(...args);
      return {
        all,
        first: sql.includes("FROM digest_schedule_job") ? digestJobFirst : scheduledRunFirst,
      };
    },
  }));
  return {
    context: {
      cloudflare: {
        env: {
          CANARY_BYPASS_TOKEN: "secret-token",
          SEARCH_ROLLOUT_MODE: "v2",
          CF_VERSION_METADATA: { id: "worker-v1" },
          DB: { prepare },
        },
      },
    },
    prepare,
    bind,
  };
}

function request(headers: Record<string, string> = {}) {
  return new Request("https://0509.io/api/release-soak", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-0509-canary-token": "secret-token",
      "x-0509-expected-worker-version": "worker-v1",
      ...headers,
    },
    body: JSON.stringify({ startedAt: STARTED_AT, endedAt: ENDED_AT }),
  });
}

describe("release scheduled soak evaluator", () => {
  it("requires every exact scheduled task slot across a 24-hour half-open window", () => {
    const result = evaluateReleaseSoak(completeWindow(), windowInput(), healthyRunSlo(), healthyDigestJobSlo());
    expect(result).toMatchObject({
      passed: true,
      blockers: [],
      expectedObservations: 51,
      observedObservations: 51,
      maxTaskDurationMs: 1_000,
      regularScanSuccesses: 1,
      dailyDigestSuccesses: 1,
    });
  });

  it("fails closed on missing, duplicate, degraded, stale, unsafe, and unexpected observations", () => {
    const cases: Array<[string, (rows: Observation[]) => void, string]> = [
      ["missing", (rows) => { rows.pop(); }, "scheduled_task_observation_missing"],
      ["duplicate", (rows) => { rows.push({ ...rows[0] }); }, "scheduled_task_duplicate_attempt"],
      ["degraded", (rows) => { rows[0].outcome = "degraded"; }, "task_outcome_slo_failed"],
      ["stale", (rows) => { rows[0].completed_at = new Date(Date.parse(rows[0].scheduled_at) + 900_001).toISOString(); }, "task_freshness_slo_failed"],
      ["unsafe metrics", (rows) => { rows[0].metrics_json = JSON.stringify({ email: "customer@example.com" }); }, "unsafe_task_metrics"],
      ["unexpected", (rows) => { rows.push(row("0 */3 * * *", "scheduled_monitoring", "2026-07-18T01:00:00.000Z")); }, "unexpected_scheduled_task_observation"],
      ["unexpected alert", (rows) => { rows.push(row("0 */3 * * *", "customer_at_risk_alert", "2026-07-18T01:00:00.000Z")); }, "unexpected_scheduled_task_observation"],
      ["unsafe cron", (rows) => { rows.push(row("1 * * * *", "scheduled_monitoring", "2026-07-18T01:01:00.000Z")); }, "unsafe_task_cron"],
    ];
    for (const [, mutate, blocker] of cases) {
      const rows = completeWindow();
      mutate(rows);
      const result = evaluateReleaseSoak(rows, windowInput(), healthyRunSlo(), healthyDigestJobSlo());
      expect(result.passed).toBe(false);
      expect(result.blockers).toContain(blocker);
    }
  });

  it("requires the daily alert and exposes duplicate platform attempts", () => {
    const rows = completeWindow();
    const alertIndex = rows.findIndex((entry) => entry.task_name === "customer_at_risk_alert");
    const [alert] = rows.splice(alertIndex, 1);
    expect(evaluateReleaseSoak(rows, windowInput(), healthyRunSlo(), healthyDigestJobSlo()).blockers)
      .toContain("scheduled_task_observation_missing");
    const duplicate = evaluateReleaseSoak([...rows, alert, { ...alert }], windowInput(), healthyRunSlo(), healthyDigestJobSlo());
    expect(duplicate.blockers).toContain("scheduled_task_duplicate_attempt");
  });

  it("requires real scheduled scan and digest successes rather than accepting all no-work rows", () => {
    const rows = completeWindow();
    for (const entry of rows) {
      if (entry.task_name === "scheduled_monitoring") {
        entry.outcome = "no_work";
        entry.metrics_json = "{}";
      }
    }
    const result = evaluateReleaseSoak(rows, windowInput(), healthyRunSlo(), healthyDigestJobSlo());
    expect(result.blockers).toEqual(expect.arrayContaining([
      "scheduled_scan_success_missing",
      "scheduled_digest_success_missing",
    ]));
  });

  it("models all three tasks on a Monday weekly cron without requiring a seven-day wait", () => {
    const startedAtMs = Date.parse("2026-07-20T00:00:00.000Z");
    const endedAtMs = Date.parse("2026-07-21T00:00:00.000Z");
    const shifted = completeWindow().map((entry) => ({
      ...entry,
      scheduled_at: entry.scheduled_at.replace("2026-07-18", "2026-07-20"),
      started_at: entry.started_at.replace("2026-07-18", "2026-07-20"),
      completed_at: entry.completed_at.replace("2026-07-18", "2026-07-20"),
    }));
    for (const task of ["billing_lifecycle_email_recovery", "weekly_business_numbers", "scheduled_monitoring"]) {
      shifted.push(row("0 5 * * MON", task, "2026-07-20T05:00:00.000Z"));
    }
    const result = evaluateReleaseSoak(shifted, { startedAtMs, endedAtMs }, healthyRunSlo(), healthyDigestJobSlo());
    expect(result.passed).toBe(true);
    expect(result.expectedObservations).toBe(54);
  });

  it("requires every scheduled scan to finish successfully without degradation or staleness", () => {
    const rows = completeWindow();
    const unhealthy = evaluateReleaseSoak(rows, windowInput(), healthyRunSlo({
      succeededRuns: 0,
      failedRuns: 1,
      maxCompletionMs: 2 * 60 * 60 * 1000 + 1,
    }), healthyDigestJobSlo());
    expect(unhealthy.blockers).toEqual(expect.arrayContaining([
      "scheduled_run_success_slo_failed",
      "scheduled_run_terminal_slo_failed",
      "scheduled_run_freshness_slo_failed",
    ]));
    expect(evaluateReleaseSoak(rows, windowInput(), healthyRunSlo({ totalRuns: 2, succeededRuns: 2 }), healthyDigestJobSlo()).blockers)
      .toContain("scheduled_run_count_mismatch");
  });

  it("fails closed when any scheduled digest job is failed, unfinished, exhausted, or stale", () => {
    const result = evaluateReleaseSoak(
      completeWindow(),
      windowInput(),
      healthyRunSlo(),
      healthyDigestJobSlo({
        totalJobs: 4,
        completedJobs: 1,
        failedJobs: 1,
        pendingJobs: 1,
        exhaustedJobs: 1,
        retriedJobs: 1,
        deliveryAttempts: 2,
        sentDeliveryAttempts: 1,
        unresolvedDeliveryAttempts: 1,
        maxCompletionMs: 2 * 60 * 60 * 1000 + 1,
      }),
    );
    expect(result.blockers).toEqual(expect.arrayContaining([
      "digest_job_success_slo_failed",
      "digest_job_terminal_slo_failed",
      "digest_job_freshness_slo_failed",
      "digest_delivery_acceptance_slo_failed",
    ]));
  });
});

describe("release soak action", () => {
  it("binds the query to the exact live Worker version and returns sanitized proof", async () => {
    const { context, prepare, bind } = createContext();
    const response = await action({ context, request: request() } as never);
    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("WHERE worker_version_id = ?"));
    expect(bind).toHaveBeenCalledWith("worker-v1", STARTED_AT, ENDED_AT);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({
      ok: true,
      passed: true,
      workerVersionId: "worker-v1",
      searchRolloutMode: "v2",
      evidenceClass: "exact_worker_scheduled_observation",
    });
    expect(JSON.stringify(payload)).not.toContain("secret-token");
  });

  it("fails closed before D1 for missing auth or a mismatched Worker version", async () => {
    const missing = createContext();
    await expect(action({
      context: missing.context,
      request: request({ "x-0509-canary-token": "wrong" }),
    } as never)).rejects.toMatchObject({ status: 404 });
    expect(missing.prepare).not.toHaveBeenCalled();

    const mismatch = createContext();
    const response = await action({
      context: mismatch.context,
      request: request({ "x-0509-expected-worker-version": "worker-v2" }),
    } as never);
    expect(response.status).toBe(409);
    expect(mismatch.prepare).not.toHaveBeenCalled();
  });
});
