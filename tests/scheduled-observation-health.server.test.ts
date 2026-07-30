import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatScheduledObservationHealthLines,
  listScheduledObservationHealth,
  sendScheduledObservationHeartbeat,
} from "~/lib/scheduled-observation-health.server";

const sendOperatorAlertEmail = vi.fn();

vi.mock("~/lib/delivery.server", () => ({
  sendOperatorAlertEmail: (...args: unknown[]) =>
    sendOperatorAlertEmail(...args),
}));

function healthDb(rows: Array<{ cron: string; last_scheduled_at: string | null }>) {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn().mockResolvedValue({ results: rows }),
    })),
  };
}

describe("scheduled observation heartbeat", () => {
  beforeEach(() => {
    sendOperatorAlertEmail.mockReset();
    sendOperatorAlertEmail.mockResolvedValue(true);
  });

  it("detects a missed production schedule from observation freshness", async () => {
    const now = new Date("2026-07-30T12:13:00.000Z");
    const health = await listScheduledObservationHealth(
      {
        DB: healthDb([
          { cron: "0 */3 * * *", last_scheduled_at: "2026-07-30T06:00:00.000Z" },
          { cron: "17 */6 * * *", last_scheduled_at: "2026-07-30T06:17:00.000Z" },
          { cron: "0 4 * * *", last_scheduled_at: "2026-07-30T04:00:00.000Z" },
          { cron: "0 5 * * MON", last_scheduled_at: "2026-07-27T05:00:00.000Z" },
        ]),
      } as never,
      { now },
    );

    expect(health.find((entry) => entry.cron === "0 */3 * * *")?.overdue).toBe(true);
    expect(health.filter((entry) => entry.overdue)).toHaveLength(1);
    expect(formatScheduledObservationHealthLines(health)).toEqual([
      "Scheduled-work heartbeat OVERDUE for 0 */3 * * *; last observed: 2026-07-30T06:00:00.000Z.",
    ]);
  });

  it("pages through the existing operator alert when a schedule is overdue", async () => {
    const now = new Date("2026-07-30T12:13:00.000Z");
    const env = {
      DB: healthDb([]),
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    };

    const result = await sendScheduledObservationHeartbeat(env as never, { now });

    expect(result).toMatchObject({ sent: true, reason: "sent" });
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        subject: "0509 scheduler heartbeat: 4 overdue",
        idempotencyKey: expect.stringMatching(/^scheduled-observation-heartbeat:\d+$/),
      }),
    );
  });
});
