import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  alertScheduledTaskFailure,
  CRON_FAILURE_ALERT_THROTTLE_MS,
  reportScheduledTaskFailure,
} from "~/lib/cron-failure-alert.server";
import type { AppEnv } from "~/lib/env.server";

const sendOperatorAlertEmail = vi.fn();

vi.mock("~/lib/delivery.server", () => ({
  sendOperatorAlertEmail: (...args: unknown[]) => sendOperatorAlertEmail(...args),
}));

type ThrottleRow = {
  last_alerted_at: string;
  last_error: string | null;
  alert_count: number;
  last_failed_at?: string | null;
  failed_count?: number;
};

function createThrottleDb(
  rows: Map<string, ThrottleRow> = new Map(),
  options: { failUpsert?: boolean } = {},
) {
  return {
    prepare(sql: string) {
      if (sql.includes("SELECT last_alerted_at")) {
        return {
          bind(taskKey: string) {
            return {
              async first() {
                const row = rows.get(taskKey);
                if (
                  sql.includes("last_error = 'operator_alert_sent'") &&
                  row?.last_error !== "operator_alert_sent"
                ) {
                  return null;
                }
                return row ? { last_alerted_at: row.last_alerted_at } : null;
              },
            };
          },
        };
      }

      if (sql.includes("INSERT INTO cron_failure_alert_throttle")) {
        return {
          bind(taskKey: string, lastAlertedAt: string, detail?: string) {
            return {
              async run() {
                if (options.failUpsert) {
                  throw new Error("throttle write failed");
                }
                const existing = rows.get(taskKey);
                const failedAttempt = sql.includes("'operator_alert_not_sent'");
                const resolvedLastError =
                  failedAttempt ? "operator_alert_not_sent" : detail ?? null;
                const preserveAccepted = failedAttempt &&
                  existing?.last_error === "operator_alert_sent" &&
                  sql.includes("last_failed_at") &&
                  sql.includes("CASE");
                rows.set(taskKey, {
                  last_alerted_at: preserveAccepted
                    ? existing.last_alerted_at
                    : lastAlertedAt,
                  last_error: preserveAccepted
                    ? existing.last_error
                    : resolvedLastError,
                  alert_count: sql.includes("alert_count + 1")
                    ? (existing?.alert_count ?? 0) + 1
                    : existing?.alert_count ??
                      (failedAttempt ? 0 : 1),
                  last_failed_at: failedAttempt && sql.includes("last_failed_at")
                    ? detail ?? lastAlertedAt
                    : existing?.last_failed_at ?? null,
                  failed_count: failedAttempt && sql.includes("failed_count")
                    ? (existing?.failed_count ?? 0) + 1
                    : existing?.failed_count ?? 0,
                });
                return { success: true };
              },
            };
          },
        };
      }

      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

describe("cron failure alert throttle", () => {
  beforeEach(() => {
    sendOperatorAlertEmail.mockReset();
    sendOperatorAlertEmail.mockResolvedValue(true);
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
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith(
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
    const senderInput = sendOperatorAlertEmail.mock.calls[0]?.[1];
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
    expect(sendOperatorAlertEmail).not.toHaveBeenCalled();
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
    expect(sendOperatorAlertEmail).toHaveBeenCalledTimes(1);
    expect(rows.get("scheduled_monitoring")?.alert_count).toBe(2);
    expect(rows.get("scheduled_monitoring")?.last_alerted_at).toBe(later.toISOString());
  });

  it("records but does not throttle a page that the email channel did not accept", async () => {
    sendOperatorAlertEmail.mockResolvedValue(false);
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
    ).resolves.toEqual({ sent: false, reason: "email_skipped" });

    expect(sendOperatorAlertEmail).toHaveBeenCalledTimes(2);
    expect(rows.get("scheduled_monitoring")).toMatchObject({
      last_alerted_at: new Date(now.getTime() + 1_000).toISOString(),
      last_error: "operator_alert_not_sent",
      alert_count: 0,
    });
    expect(JSON.stringify(rows.get("scheduled_monitoring"))).not.toContain("provider response leaked");
  });

  it("allows one false-send retry in the next window", async () => {
    sendOperatorAlertEmail.mockResolvedValue(false);
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

    expect(sendOperatorAlertEmail).toHaveBeenCalledTimes(2);
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

    sendOperatorAlertEmail
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

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

  it("keeps reportScheduledTaskFailure non-throwing when a false-send throttle write fails", async () => {
    sendOperatorAlertEmail.mockResolvedValue(false);
    const env = {
      DB: createThrottleDb(new Map(), { failUpsert: true }),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    await expect(
      reportScheduledTaskFailure(env, "retention_sweep", new Error("db write details")),
    ).resolves.toEqual({ sent: false, reason: "email_failed" });
    expect(sendOperatorAlertEmail).toHaveBeenCalledTimes(1);
    const senderInput = sendOperatorAlertEmail.mock.calls[0]?.[1];
    expect(JSON.stringify(senderInput)).not.toContain("db write details");
  });

  it("reportScheduledTaskFailure never throws when the alert path fails", async () => {
    sendOperatorAlertEmail.mockRejectedValueOnce(new Error("email down"));
    const env = {
      DB: createThrottleDb(),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    } as unknown as AppEnv;

    await expect(
      reportScheduledTaskFailure(env, "presence_polling_batch", new Error("poll failed")),
    ).resolves.toEqual({ sent: false, reason: "email_failed" });
  });
});
