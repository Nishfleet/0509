import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  alertScheduledTaskFailure,
  CRON_FAILURE_ALERT_COUNT_MAX,
  CRON_FAILURE_ALERT_THROTTLE_MS,
  reportScheduledTaskFailure,
} from "~/lib/cron-failure-alert.server";
import type { AppEnv } from "~/lib/env.server";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const sendOperatorAlertEmailDetailed = vi.fn();
const readOperatorAlertEmailOutcome = vi.fn();

vi.mock("~/lib/delivery.server", () => ({
  readOperatorAlertEmailOutcome: (...args: unknown[]) =>
    readOperatorAlertEmailOutcome(...args),
  sendOperatorAlertEmailDetailed: (...args: unknown[]) =>
    sendOperatorAlertEmailDetailed(...args),
}));

type ThrottleRow = {
  last_alerted_at: string;
  last_error: string | null;
  alert_count: number;
  last_failed_at?: string | null;
  failed_count?: number;
  last_alert_window?: number | null;
  last_pending_at?: string | null;
  pending_alert_window?: number | null;
};

function createThrottleDb(
  rows: Map<string, ThrottleRow> = new Map(),
  options: { failUpsert?: boolean } = {},
) {
  const acceptedWindows = new Map<string, Map<number, string>>();
  const acceptedCountBaselines = new Map<string, number>();
  for (const [taskKey, row] of rows) {
    if (row.last_error !== "operator_alert_sent") continue;
    const alertWindow = row.last_alert_window ?? Math.floor(
      Date.parse(row.last_alerted_at) / CRON_FAILURE_ALERT_THROTTLE_MS,
    );
    acceptedWindows.set(taskKey, new Map([[alertWindow, row.last_alerted_at]]));
    acceptedCountBaselines.set(taskKey, Math.max(row.alert_count - 1, 0));
    row.last_alert_window = alertWindow;
  }

  return {
    prepare(sql: string) {
      if (
        sql.trimStart().startsWith("SELECT") &&
        sql.includes("FROM cron_failure_alert_throttle")
      ) {
        return {
          bind(taskKey: string) {
            return {
              async first() {
                const row = rows.get(taskKey);
                return row ?? null;
              },
            };
          },
        };
      }

      if (sql.includes("INSERT OR IGNORE INTO cron_failure_alert_accepted_window")) {
        return {
          bind(taskKey: string, alertWindow: number, acceptedAt: string) {
            return {
              async run() {
                if (options.failUpsert) throw new Error("throttle write failed");
                const windows = acceptedWindows.get(taskKey) ?? new Map<number, string>();
                if (!windows.has(alertWindow)) windows.set(alertWindow, acceptedAt);
                acceptedWindows.set(taskKey, windows);
                return { success: true };
              },
            };
          },
        };
      }

      if (
        sql.includes("INSERT INTO cron_failure_alert_throttle") &&
        sql.includes("FROM cron_failure_alert_accepted_window")
      ) {
        return {
          bind(taskKey: string) {
            return {
              async run() {
                if (options.failUpsert) throw new Error("throttle write failed");
                const windows = acceptedWindows.get(taskKey) ?? new Map<number, string>();
                const latestWindow = Math.max(...windows.keys());
                const existing = rows.get(taskKey);
                rows.set(taskKey, {
                  last_alerted_at: windows.get(latestWindow)!,
                  last_error: "operator_alert_sent",
                  alert_count: Math.min(
                    (acceptedCountBaselines.get(taskKey) ?? 0) + windows.size,
                    CRON_FAILURE_ALERT_COUNT_MAX,
                  ),
                  last_failed_at: existing?.last_failed_at ?? null,
                  failed_count: existing?.failed_count ?? 0,
                  last_alert_window: latestWindow,
                  last_pending_at:
                    existing?.pending_alert_window === latestWindow
                      ? null
                      : existing?.last_pending_at ?? null,
                  pending_alert_window:
                    existing?.pending_alert_window === latestWindow
                      ? null
                      : existing?.pending_alert_window ?? null,
                });
                return { success: true };
              },
            };
          },
        };
      }

      if (sql.includes("INSERT INTO cron_failure_alert_throttle")) {
        return {
          bind(taskKey: string, lastAlertedAt: string, detail?: string | number, window?: number) {
            return {
              async run() {
                if (options.failUpsert) {
                  throw new Error("throttle write failed");
                }
                const existing = rows.get(taskKey);
                const failedAttempt = sql.includes("'operator_alert_not_sent'");
                const pendingAttempt = sql.includes("'operator_alert_pending'");
                const resolvedLastError = failedAttempt
                  ? "operator_alert_not_sent"
                  : pendingAttempt
                    ? "operator_alert_pending"
                  : "operator_alert_sent";
                const preserveAccepted = (failedAttempt || pendingAttempt) &&
                  existing?.last_error === "operator_alert_sent" &&
                  sql.includes("CASE");
                const alertWindow = !failedAttempt && !pendingAttempt && typeof detail === "number"
                  ? detail
                  : existing?.last_alert_window ?? null;
                const duplicateAcceptedWindow =
                  !failedAttempt &&
                  alertWindow !== null &&
                  existing?.last_alert_window === alertWindow;
                rows.set(taskKey, {
                  last_alerted_at: preserveAccepted
                    ? existing.last_alerted_at
                    : lastAlertedAt,
                  last_error: preserveAccepted
                    ? existing.last_error
                    : resolvedLastError,
                  alert_count:
                    (failedAttempt || pendingAttempt) && sql.includes("alert_count = CASE")
                      ? preserveAccepted
                        ? existing?.alert_count ?? 0
                        : 0
                      : sql.includes("alert_count + CASE")
                        ? (existing?.alert_count ?? 0) + (duplicateAcceptedWindow ? 0 : 1)
                        : sql.includes("alert_count + 1")
                          ? (existing?.alert_count ?? 0) + 1
                        : existing?.alert_count ??
                          (failedAttempt ? 0 : 1),
                  last_failed_at: failedAttempt && sql.includes("last_failed_at")
                    ? !existing?.last_failed_at || existing.last_failed_at < lastAlertedAt
                      ? lastAlertedAt
                      : existing.last_failed_at
                    : existing?.last_failed_at ?? null,
                  failed_count: failedAttempt && sql.includes("failed_count")
                    ? sql.includes("failed_count = MIN")
                      ? Math.min(
                          (existing?.failed_count ?? 0) +
                            (existing?.last_failed_at === lastAlertedAt ? 0 : 1),
                          CRON_FAILURE_ALERT_COUNT_MAX,
                        )
                      : (existing?.failed_count ?? 0) + 1
                    : existing?.failed_count ?? 0,
                  last_alert_window: alertWindow,
                  last_pending_at: pendingAttempt
                    ? typeof detail === "string" &&
                        (!existing?.last_pending_at || existing.last_pending_at < detail)
                      ? detail
                      : existing?.last_pending_at ?? null
                    : failedAttempt && existing?.pending_alert_window === window
                      ? null
                      : existing?.last_pending_at ?? null,
                  pending_alert_window: pendingAttempt
                    ? typeof detail === "string" &&
                        (!existing?.last_pending_at || existing.last_pending_at < detail)
                      ? window ?? null
                      : existing?.pending_alert_window ?? null
                    : failedAttempt && existing?.pending_alert_window === window
                      ? null
                      : existing?.pending_alert_window ?? null,
                });
                return { success: true };
              },
            };
          },
        };
      }

      throw new Error(`unexpected SQL: ${sql}`);
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

describe("cron failure alert throttle", () => {
  beforeEach(() => {
    sendOperatorAlertEmailDetailed.mockReset();
    sendOperatorAlertEmailDetailed.mockResolvedValue("accepted");
    readOperatorAlertEmailOutcome.mockReset();
    readOperatorAlertEmailOutcome.mockResolvedValue(null);
  });

  it("sends an operator alert and records the throttle row on first failure", async () => {
    const rows = new Map<string, ThrottleRow>();
    const now = new Date("2026-07-12T12:00:00.000Z");
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    const rawFailure = "secret@example.com https://private.example/reset?token=abc123 provider=mail";
    const result = await alertScheduledTaskFailure(env, "retention_sweep", new Error(rawFailure), {
      now,
    });

    expect(result).toEqual({ sent: true, reason: "sent" });
    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        subject: "0509 cron failure: retention_sweep",
        idempotencyKey: expect.stringMatching(/^cron-failure:retention_sweep:\d+$/),
        lines: expect.arrayContaining([
          "Failure category: runtime_error.",
          "Details: Review Worker logs for the internal failure details.",
        ]),
      }),
    );
    const senderInput = sendOperatorAlertEmailDetailed.mock.calls[0]?.[1];
    expect(JSON.stringify(senderInput)).not.toContain(rawFailure);
    expect(rows.get("retention_sweep")?.last_alerted_at).toBe(now.toISOString());
    expect(rows.get("retention_sweep")?.alert_count).toBe(1);
    expect(rows.get("retention_sweep")?.last_error).toBe("operator_alert_sent");
    expect(JSON.stringify(rows.get("retention_sweep"))).not.toContain(rawFailure);
  });

  it("throttles a second failure within the 6h window without emailing again", async () => {
    const firstAt = new Date("2026-07-12T12:00:00.000Z");
    const rows = new Map<string, ThrottleRow>([
      [
        "instant_alert_flush",
        {
          last_alerted_at: firstAt.toISOString(),
          last_error: "operator_alert_sent",
          alert_count: 1,
        },
      ],
    ]);
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    const result = await alertScheduledTaskFailure(
      env,
      "instant_alert_flush",
      new Error("again"),
      { now: new Date(firstAt.getTime() + CRON_FAILURE_ALERT_THROTTLE_MS - 1) },
    );

    expect(result).toEqual({ sent: false, reason: "throttled" });
    expect(sendOperatorAlertEmailDetailed).not.toHaveBeenCalled();
    expect(rows.get("instant_alert_flush")?.alert_count).toBe(1);
  });

  it("allows another alert after the 6h window elapses", async () => {
    const firstAt = new Date("2026-07-12T06:00:00.000Z");
    const rows = new Map<string, ThrottleRow>([
      [
        "scheduled_monitoring",
        {
          last_alerted_at: firstAt.toISOString(),
          last_error: "operator_alert_sent",
          alert_count: 1,
        },
      ],
    ]);
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;
    const later = new Date(firstAt.getTime() + CRON_FAILURE_ALERT_THROTTLE_MS);

    const result = await alertScheduledTaskFailure(
      env,
      "scheduled_monitoring",
      new Error("still broken"),
      { now: later },
    );

    expect(result).toEqual({ sent: true, reason: "sent" });
    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledTimes(1);
    expect(rows.get("scheduled_monitoring")?.alert_count).toBe(2);
    expect(rows.get("scheduled_monitoring")?.last_alerted_at).toBe(later.toISOString());
  });

  it("records a rejected page and bounds retries for six hours", async () => {
    sendOperatorAlertEmailDetailed.mockResolvedValue("rejected");
    const rows = new Map<string, ThrottleRow>();
    const now = new Date("2026-07-12T12:00:00.000Z");
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    await expect(
      alertScheduledTaskFailure(env, "scheduled_monitoring", new Error("provider response leaked"), { now }),
    ).resolves.toEqual({ sent: false, reason: "email_skipped" });
    await expect(
      alertScheduledTaskFailure(env, "scheduled_monitoring", new Error("second raw failure"), {
        now: new Date(now.getTime() + 1_000),
      }),
    ).resolves.toEqual({ sent: false, reason: "retry_throttled" });

    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledTimes(1);
    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_alerted_at: now.toISOString(),
      last_error: "operator_alert_not_sent",
      alert_count: 0,
    });
    expect(JSON.stringify(rows.get("scheduled_monitoring"))).not.toContain("provider response leaked");
  });

  it("allows one false-send retry in the next window", async () => {
    sendOperatorAlertEmailDetailed.mockResolvedValue("rejected");
    const rows = new Map<string, ThrottleRow>();
    const firstAt = new Date("2026-07-12T06:00:00.000Z");
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;
    const nextWindow = new Date(firstAt.getTime() + CRON_FAILURE_ALERT_THROTTLE_MS);

    await alertScheduledTaskFailure(env, "scheduled_monitoring", new Error("first"), { now: firstAt });
    await alertScheduledTaskFailure(env, "scheduled_monitoring", new Error("second"), {
      now: nextWindow,
    });

    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledTimes(2);
    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_alerted_at: nextWindow.toISOString(),
      last_error: "operator_alert_not_sent",
      alert_count: 0,
    });
  });

  it("preserves an accepted throttle row when a later page is rejected", async () => {
    const rows = new Map<string, ThrottleRow>();
    const firstAt = new Date("2026-07-12T06:00:00.000Z");
    const rejectedAt = new Date(
      firstAt.getTime() + CRON_FAILURE_ALERT_THROTTLE_MS,
    );
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    sendOperatorAlertEmailDetailed
      .mockResolvedValueOnce("accepted")
      .mockResolvedValueOnce("rejected");

    await alertScheduledTaskFailure(
      env,
      "scheduled_monitoring",
      new Error("first"),
      { now: firstAt },
    );
    await alertScheduledTaskFailure(
      env,
      "scheduled_monitoring",
      new Error("second"),
      { now: rejectedAt },
    );

    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_alerted_at: firstAt.toISOString(),
      last_error: "operator_alert_sent",
      alert_count: 1,
      last_failed_at: rejectedAt.toISOString(),
      failed_count: 1,
    });
  });

  it("does not preserve a legacy rejected-page count as accepted evidence", async () => {
    sendOperatorAlertEmailDetailed
      .mockResolvedValueOnce("rejected")
      .mockResolvedValueOnce("accepted");
    const rows = new Map<string, ThrottleRow>([
      [
        "scheduled_monitoring",
        {
          last_alerted_at: "2026-07-12T06:00:00.000Z",
          last_error: "operator_alert_not_sent",
          alert_count: 4,
          last_failed_at: null,
          failed_count: 0,
        },
      ],
    ]);
    const env = {
      DB: createThrottleDb(rows),
      EMAIL: {},
    } as never;

    await alertScheduledTaskFailure(
      env,
      "scheduled_monitoring",
      new Error("first retry"),
      { now: new Date("2026-07-12T12:00:00.000Z") },
    );
    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_error: "operator_alert_not_sent",
      alert_count: 0,
      failed_count: 1,
    });

    await alertScheduledTaskFailure(
      env,
      "scheduled_monitoring",
      new Error("accepted retry"),
      { now: new Date("2026-07-12T18:00:00.000Z") },
    );
    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_error: "operator_alert_sent",
      alert_count: 1,
      failed_count: 1,
    });
  });

  it("caps the durable rejected-page aggregate while continuing to retry", async () => {
    sendOperatorAlertEmailDetailed.mockResolvedValue("rejected");
    const rows = new Map<string, ThrottleRow>([
      [
        "scheduled_monitoring",
        {
          last_alerted_at: "2026-07-12T06:00:00.000Z",
          last_error: "operator_alert_not_sent",
          alert_count: 0,
          last_failed_at: "2026-07-12T06:00:00.000Z",
          failed_count: CRON_FAILURE_ALERT_COUNT_MAX,
        },
      ],
    ]);
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    await expect(
      alertScheduledTaskFailure(
        env,
        "scheduled_monitoring",
        new Error("email still unavailable"),
        { now: new Date("2026-07-12T12:00:00.000Z") },
      ),
    ).resolves.toEqual({ sent: false, reason: "email_skipped" });

    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledTimes(1);
    expect(rows.get("scheduled_monitoring")?.failed_count).toBe(
      CRON_FAILURE_ALERT_COUNT_MAX,
    );
  });

  it("counts an accepted delivery and its already-accepted repair once per window", async () => {
    const rows = new Map<string, ThrottleRow>();
    const now = new Date("2026-07-12T12:00:00.000Z");
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;
    sendOperatorAlertEmailDetailed
      .mockResolvedValueOnce("accepted")
      .mockResolvedValueOnce("already_accepted");
    const first = await alertScheduledTaskFailure(
      env,
      "scheduled_monitoring",
      new Error("first"),
      { now },
    );
    // Model the loser of the pre-send throttle race: delivery idempotency has
    // accepted the page, but this invocation did not observe accepted throttle
    // state before attempting its repair write.
    const row = rows.get("scheduled_monitoring")!;
    row.last_error = "operator_alert_not_sent";
    row.last_alert_window = null;
    const duplicate = await alertScheduledTaskFailure(
      env,
      "scheduled_monitoring",
      new Error("duplicate"),
      { now },
    );

    expect([first, duplicate]).toEqual([
      { sent: true, reason: "sent" },
      { sent: false, reason: "already_sent" },
    ]);
    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_error: "operator_alert_sent",
      alert_count: 1,
      failed_count: 0,
    });
  });

  it("keeps accepted throttle evidence monotonic when adjacent windows finish out of order", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0064_cron_failure_alert_throttle.sql");
    applyMigration(harness.sqlite, "migrations/0073_cron_failure_alert_attempt_evidence.sql");
    const olderAt = new Date("2026-07-12T11:59:59.999Z");
    const newerAt = new Date("2026-07-12T12:00:00.000Z");
    const resolutions: Array<(outcome: "accepted") => void> = [];
    sendOperatorAlertEmailDetailed.mockImplementation(
      () => new Promise<"accepted">((resolve) => resolutions.push(resolve)),
    );
    const env = {
      DB: harness.db,
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    try {
      const older = alertScheduledTaskFailure(
        env,
        "scheduled_monitoring",
        new Error("older window"),
        { now: olderAt },
      );
      await vi.waitFor(() => expect(resolutions).toHaveLength(1));
      const newer = alertScheduledTaskFailure(
        env,
        "scheduled_monitoring",
        new Error("newer window"),
        { now: newerAt },
      );
      await vi.waitFor(() => expect(resolutions).toHaveLength(2));

      resolutions[1]!("accepted");
      await newer;
      resolutions[0]!("accepted");
      await older;

      expect(harness.sqlite.prepare(`
        SELECT last_alerted_at, alert_count, last_alert_window
        FROM cron_failure_alert_throttle
        WHERE task_key = ?
      `).get("scheduled_monitoring")).toMatchObject({
        last_alerted_at: newerAt.toISOString(),
        alert_count: 2,
        last_alert_window: Math.floor(
          newerAt.getTime() / CRON_FAILURE_ALERT_THROTTLE_MS,
        ),
      });
    } finally {
      harness.close();
    }
  });

  it("counts same-window accepted repairs once across an out-of-order newer window", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0064_cron_failure_alert_throttle.sql");
    applyMigration(harness.sqlite, "migrations/0073_cron_failure_alert_attempt_evidence.sql");
    const olderAt = new Date("2026-07-12T11:59:59.999Z");
    const newerAt = new Date("2026-07-12T12:00:00.000Z");
    const resolutions: Array<(
      outcome: "accepted" | "already_accepted",
    ) => void> = [];
    sendOperatorAlertEmailDetailed.mockImplementation(
      () => new Promise((resolve) => resolutions.push(resolve)),
    );
    const env = {
      DB: harness.db,
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    try {
      const olderAccepted = alertScheduledTaskFailure(
        env,
        "scheduled_monitoring",
        new Error("older accepted"),
        { now: olderAt },
      );
      await vi.waitFor(() => expect(resolutions).toHaveLength(1));
      const olderRepair = alertScheduledTaskFailure(
        env,
        "scheduled_monitoring",
        new Error("older repair"),
        { now: olderAt },
      );
      await vi.waitFor(() => expect(resolutions).toHaveLength(2));
      const newerAccepted = alertScheduledTaskFailure(
        env,
        "scheduled_monitoring",
        new Error("newer accepted"),
        { now: newerAt },
      );
      await vi.waitFor(() => expect(resolutions).toHaveLength(3));

      resolutions[2]!("accepted");
      await newerAccepted;
      resolutions[0]!("accepted");
      await olderAccepted;
      resolutions[1]!("already_accepted");
      await olderRepair;

      expect(harness.sqlite.prepare(`
        SELECT last_alerted_at, alert_count, last_alert_window
        FROM cron_failure_alert_throttle
        WHERE task_key = ?
      `).get("scheduled_monitoring")).toMatchObject({
        last_alerted_at: newerAt.toISOString(),
        alert_count: 2,
        last_alert_window: Math.floor(
          newerAt.getTime() / CRON_FAILURE_ALERT_THROTTLE_MS,
        ),
      });
    } finally {
      harness.close();
    }
  });

  it("keeps rejected-attempt evidence monotonic across out-of-order windows", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0064_cron_failure_alert_throttle.sql");
    applyMigration(harness.sqlite, "migrations/0073_cron_failure_alert_attempt_evidence.sql");
    const olderAt = new Date("2026-07-12T11:59:59.999Z");
    const newerAt = new Date("2026-07-12T12:00:00.000Z");
    const resolutions: Array<(outcome: "rejected") => void> = [];
    sendOperatorAlertEmailDetailed.mockImplementation(
      () => new Promise<"rejected">((resolve) => resolutions.push(resolve)),
    );
    const env = {
      DB: harness.db,
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    try {
      const older = alertScheduledTaskFailure(
        env,
        "scheduled_monitoring",
        new Error("older rejected"),
        { now: olderAt },
      );
      await vi.waitFor(() => expect(resolutions).toHaveLength(1));
      const newer = alertScheduledTaskFailure(
        env,
        "scheduled_monitoring",
        new Error("newer rejected"),
        { now: newerAt },
      );
      await vi.waitFor(() => expect(resolutions).toHaveLength(2));

      resolutions[1]!("rejected");
      await newer;
      resolutions[0]!("rejected");
      await older;

      expect(harness.sqlite.prepare(`
        SELECT last_failed_at, failed_count
        FROM cron_failure_alert_throttle
        WHERE task_key = ?
      `).get("scheduled_monitoring")).toMatchObject({
        last_failed_at: newerAt.toISOString(),
        failed_count: 2,
      });
    } finally {
      harness.close();
    }
  });

  it("records an in-flight outcome as durable pending evidence", async () => {
    const rows = new Map<string, ThrottleRow>();
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;
    sendOperatorAlertEmailDetailed.mockResolvedValue("in_flight_or_unknown");

    await expect(
      alertScheduledTaskFailure(
        env,
        "scheduled_monitoring",
        new Error("concurrent"),
        { now: new Date("2026-07-12T12:00:00.000Z") },
      ),
    ).resolves.toEqual({ sent: false, reason: "email_pending" });
    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_error: "operator_alert_pending",
      last_pending_at: "2026-07-12T12:00:00.000Z",
      pending_alert_window: Math.floor(
        new Date("2026-07-12T12:00:00.000Z").getTime() /
          CRON_FAILURE_ALERT_THROTTLE_MS,
      ),
    });
  });

  it("reconciles a provider-unknown attempt after idempotency-window rotation", async () => {
    const rows = new Map<string, ThrottleRow>();
    const firstAt = new Date("2026-07-12T06:00:00.000Z");
    const firstWindow = Math.floor(
      firstAt.getTime() / CRON_FAILURE_ALERT_THROTTLE_MS,
    );
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;
    sendOperatorAlertEmailDetailed.mockResolvedValue("in_flight_or_unknown");

    await expect(
      alertScheduledTaskFailure(env, "scheduled_monitoring", new Error("first"), {
        now: firstAt,
      }),
    ).resolves.toEqual({ sent: false, reason: "email_pending" });

    readOperatorAlertEmailOutcome.mockImplementation(
      async (_env: AppEnv, idempotencyKey: string) =>
        idempotencyKey === `cron-failure:scheduled_monitoring:${firstWindow}`
          ? {
              outcome: "in_flight_or_unknown",
              observedAt: firstAt.toISOString(),
            }
          : null,
    );
    await expect(
      alertScheduledTaskFailure(env, "scheduled_monitoring", new Error("later"), {
        now: new Date(firstAt.getTime() + CRON_FAILURE_ALERT_THROTTLE_MS + 1),
      }),
    ).resolves.toEqual({ sent: false, reason: "email_pending" });

    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledTimes(1);
    expect(readOperatorAlertEmailOutcome).toHaveBeenLastCalledWith(
      env,
      `cron-failure:scheduled_monitoring:${firstWindow}`,
    );
  });

  it("repairs accepted evidence across a window boundary after the throttle write fails", async () => {
    const firstAt = new Date("2026-07-12T11:59:59.999Z");
    const firstWindow = Math.floor(
      firstAt.getTime() / CRON_FAILURE_ALERT_THROTTLE_MS,
    );
    const failedWriteEnv = {
      DB: createThrottleDb(new Map(), { failUpsert: true }),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;
    sendOperatorAlertEmailDetailed.mockResolvedValue("accepted");

    await expect(
      alertScheduledTaskFailure(
        failedWriteEnv,
        "scheduled_monitoring",
        new Error("first"),
        { now: firstAt },
      ),
    ).rejects.toThrow("throttle write failed");

    const rows = new Map<string, ThrottleRow>();
    const recoveryEnv = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;
    readOperatorAlertEmailOutcome.mockImplementation(
      async (_env: AppEnv, idempotencyKey: string) =>
        idempotencyKey === `cron-failure:scheduled_monitoring:${firstWindow}`
          ? { outcome: "already_accepted", observedAt: firstAt.toISOString() }
          : null,
    );

    await expect(
      alertScheduledTaskFailure(
        recoveryEnv,
        "scheduled_monitoring",
        new Error("boundary retry"),
        { now: new Date("2026-07-12T12:00:00.001Z") },
      ),
    ).resolves.toEqual({ sent: false, reason: "already_sent" });

    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledTimes(1);
    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_error: "operator_alert_sent",
      alert_count: 1,
      last_alert_window: firstWindow,
    });
  });

  it("does not resend a durably rejected attempt during its retry cooldown", async () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    const alertWindow = Math.floor(
      now.getTime() / CRON_FAILURE_ALERT_THROTTLE_MS,
    );
    const rows = new Map<string, ThrottleRow>();
    const env = {
      DB: createThrottleDb(rows),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;
    readOperatorAlertEmailOutcome.mockImplementation(
      async (_env: AppEnv, idempotencyKey: string) =>
        idempotencyKey === `cron-failure:scheduled_monitoring:${alertWindow}`
          ? { outcome: "rejected", observedAt: now.toISOString() }
          : null,
    );

    await expect(
      alertScheduledTaskFailure(env, "scheduled_monitoring", new Error("again"), {
        now: new Date(now.getTime() + 1_000),
      }),
    ).resolves.toEqual({ sent: false, reason: "retry_throttled" });
    await expect(
      alertScheduledTaskFailure(env, "scheduled_monitoring", new Error("again twice"), {
        now: new Date(now.getTime() + 2_000),
      }),
    ).resolves.toEqual({ sent: false, reason: "retry_throttled" });

    expect(sendOperatorAlertEmailDetailed).not.toHaveBeenCalled();
    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_error: "operator_alert_not_sent",
      last_failed_at: now.toISOString(),
      failed_count: 1,
    });
  });

  it("keeps reportScheduledTaskFailure non-throwing when a false-send throttle write fails", async () => {
    sendOperatorAlertEmailDetailed.mockResolvedValue("rejected");
    const env = {
      DB: createThrottleDb(new Map(), { failUpsert: true }),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    await expect(
      reportScheduledTaskFailure(env, "retention_sweep", new Error("db write details")),
    ).resolves.toEqual({ sent: false, reason: "email_failed" });
    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledTimes(1);
    const senderInput = sendOperatorAlertEmailDetailed.mock.calls[0]?.[1];
    expect(JSON.stringify(senderInput)).not.toContain("db write details");
  });

  it("reportScheduledTaskFailure never throws when the alert path fails", async () => {
    sendOperatorAlertEmailDetailed.mockRejectedValueOnce(new Error("email down"));
    const env = {
      DB: createThrottleDb(),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    await expect(
      reportScheduledTaskFailure(env, "presence_polling_batch", new Error("poll failed")),
    ).resolves.toEqual({ sent: false, reason: "email_failed" });
  });
});
