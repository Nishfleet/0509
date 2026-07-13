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
};

function createThrottleDb(rows: Map<string, ThrottleRow> = new Map()) {
  return {
    prepare(sql: string) {
      if (sql.includes("SELECT last_alerted_at")) {
        return {
          bind(taskKey: string) {
            return {
              async first() {
                const row = rows.get(taskKey);
                return row ? { last_alerted_at: row.last_alerted_at } : null;
              },
            };
          },
        };
      }

      if (sql.includes("INSERT INTO cron_failure_alert_throttle")) {
        return {
          bind(taskKey: string, lastAlertedAt: string, lastError: string) {
            return {
              async run() {
                const existing = rows.get(taskKey);
                rows.set(taskKey, {
                  last_alerted_at: lastAlertedAt,
                  last_error: lastError,
                  alert_count: (existing?.alert_count ?? 0) + 1,
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

    const result = await alertScheduledTaskFailure(env, "retention_sweep", new Error("boom"), {
      now,
    });

    expect(result).toEqual({ sent: true, reason: "sent" });
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        subject: "0509 cron failure: retention_sweep",
        idempotencyKey: expect.stringMatching(/^cron-failure:retention_sweep:\d+$/),
      }),
    );
    expect(rows.get("retention_sweep")?.last_alerted_at).toBe(now.toISOString());
    expect(rows.get("retention_sweep")?.alert_count).toBe(1);
  });

  it("throttles a second failure within the 6h window without emailing again", async () => {
    const firstAt = new Date("2026-07-12T12:00:00.000Z");
    const rows = new Map<string, ThrottleRow>([
      [
        "instant_alert_flush",
        {
          last_alerted_at: firstAt.toISOString(),
          last_error: "first",
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
          last_error: "first",
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
