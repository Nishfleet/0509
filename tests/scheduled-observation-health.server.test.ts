import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatScheduledObservationHealthLines,
  listScheduledObservationHealth,
  SCHEDULED_OBSERVATION_DEADLINES,
  SCHEDULED_OBSERVATION_HEARTBEAT_CRON,
  sendScheduledObservationHeartbeat,
} from "~/lib/scheduled-observation-health.server";

const sendOperatorAlertEmail = vi.fn();

vi.mock("~/lib/delivery.server", () => ({
  sendOperatorAlertEmail: (...args: unknown[]) =>
    sendOperatorAlertEmail(...args),
}));

function healthDb(initialRows: Array<{ cron: string; last_scheduled_at: string | null }>) {
  let rows = initialRows;
  const state = new Map<string, {
    cron: string;
    baseline_at: string;
    had_observation: number;
  }>();

  return {
    setRows(nextRows: typeof rows) {
      rows = nextRows;
    },
    prepare: vi.fn((sql: string) => {
      const statement = {
        sql,
        bindings: [] as unknown[],
        bind(...bindings: unknown[]) {
          statement.bindings = bindings;
          return statement;
        },
        all: vi.fn(async () => ({
          results: sql.includes("FROM release_scheduled_observation")
            ? rows
            : [...state.values()],
        })),
      };
      return statement;
    }),
    batch: vi.fn(async (statements: Array<{
      bindings: [string, string, number, string];
    }>) => {
      for (const statement of statements) {
        const [cron, baselineAt, hadObservation] = statement.bindings;
        const current = state.get(cron);
        state.set(cron, {
          cron,
          baseline_at: current?.baseline_at ?? baselineAt,
          had_observation: hadObservation,
        });
      }
      return [];
    }),
  };
}

describe("scheduled observation heartbeat", () => {
  beforeEach(() => {
    sendOperatorAlertEmail.mockReset();
    sendOperatorAlertEmail.mockResolvedValue(true);
  });

  it("covers every configured workload cron except the heartbeat itself", () => {
    const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");
    const cronBlock = wranglerConfig.match(/"crons"\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    const configuredCrons = [...cronBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(configuredCrons).toContain(SCHEDULED_OBSERVATION_HEARTBEAT_CRON);

    const workloadCrons = configuredCrons.filter(
      (cron) => cron !== SCHEDULED_OBSERVATION_HEARTBEAT_CRON,
    );

    expect(workloadCrons.sort()).toEqual(
      SCHEDULED_OBSERVATION_DEADLINES.map((entry) => entry.cron).sort(),
    );
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

  it("gives newly activated schedules one cadence before paging", async () => {
    const now = new Date("2026-07-30T12:13:00.000Z");
    const db = healthDb([]);
    const env = {
      DB: db,
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    };

    const initial = await sendScheduledObservationHeartbeat(env as never, { now });
    expect(initial).toMatchObject({ sent: false, reason: "healthy" });
    expect(initial.health.filter((entry) => entry.overdue)).toHaveLength(0);
    expect(sendOperatorAlertEmail).not.toHaveBeenCalled();

    const afterGrace = await sendScheduledObservationHeartbeat(env as never, {
      now: new Date("2026-08-08T12:13:00.001Z"),
    });

    expect(afterGrace).toMatchObject({ sent: true, reason: "sent" });
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        subject: "0509 scheduler heartbeat: 4 overdue",
        idempotencyKey: expect.stringMatching(/^scheduled-observation-heartbeat:\d+$/),
      }),
    );
  });

  it("does not renew grace when retained observation evidence disappears", async () => {
    const first = new Date("2026-07-20T12:13:00.000Z");
    const db = healthDb([
      { cron: "0 */3 * * *", last_scheduled_at: "2026-07-20T12:00:00.000Z" },
    ]);
    const env = { DB: db };

    await listScheduledObservationHealth(env as never, { now: first });
    db.setRows([]);
    const afterRetention = await listScheduledObservationHealth(env as never, {
      now: new Date("2026-07-30T12:13:00.000Z"),
    });

    expect(afterRetention.find((entry) => entry.cron === "0 */3 * * *")).toMatchObject({
      lastScheduledAt: null,
      overdue: true,
    });
  });
});
