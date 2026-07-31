import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatScheduledObservationHealthLines,
  listScheduledObservationHealth,
  SCHEDULED_OBSERVATION_DEADLINES,
  SCHEDULED_OBSERVATION_GAP_CHECK_CRON,
  sendScheduledObservationGapAlert,
} from "~/lib/scheduled-observation-health.server";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const sendOperatorAlertEmailDetailed = vi.fn();

vi.mock("~/lib/delivery.server", () => ({
  sendOperatorAlertEmailDetailed: (...args: unknown[]) =>
    sendOperatorAlertEmailDetailed(...args),
}));

function healthDb(
  initialRows: Array<{
    cron: string;
    last_scheduled_at: string | null;
    future_observation_count?: number;
  }>,
  baselineAt = "2026-07-30T12:13:00.000Z",
) {
  let rows = initialRows;
  let alertState: {
    last_alerted_at: string | null;
    unhealthy_mask: number;
    last_attempted_at: string;
    last_attempt_outcome: "accepted" | "rejected" | "provider_unknown";
  } | null = null;
  const state = new Map(
    SCHEDULED_OBSERVATION_DEADLINES.map(({ cron }) => [
      cron,
      { cron, baseline_at: baselineAt },
    ]),
  );

  return {
    setRows(nextRows: typeof rows) {
      rows = nextRows;
    },
    prepare: vi.fn((sql: string) => {
      if (sql.includes("FROM scheduled_observation_alert_state")) {
        return {
          first: vi.fn(async () => alertState),
        };
      }
      if (sql.includes("INSERT INTO scheduled_observation_alert_state")) {
        return {
          bind(
            lastAlertedAt: string | null,
            unhealthyMask: number,
            lastAttemptedAt: string,
            lastAttemptOutcome: "accepted" | "rejected" | "provider_unknown",
          ) {
            return {
              async run() {
                if (!alertState) {
                  alertState = {
                    last_alerted_at: lastAlertedAt,
                    unhealthy_mask: unhealthyMask,
                    last_attempted_at: lastAttemptedAt,
                    last_attempt_outcome: lastAttemptOutcome,
                  };
                } else if (alertState.last_attempted_at < lastAttemptedAt) {
                  alertState = {
                    last_alerted_at:
                      lastAlertedAt !== null &&
                        (alertState.last_alerted_at === null ||
                          alertState.last_alerted_at < lastAlertedAt)
                        ? lastAlertedAt
                        : alertState.last_alerted_at,
                    unhealthy_mask: unhealthyMask,
                    last_attempted_at: lastAttemptedAt,
                    last_attempt_outcome: lastAttemptOutcome,
                  };
                }
                return { success: true };
              },
            };
          },
        };
      }
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
  };
}

describe("scheduled observation gap check", () => {
  beforeEach(() => {
    sendOperatorAlertEmailDetailed.mockReset();
    sendOperatorAlertEmailDetailed.mockResolvedValue("accepted");
  });

  it("covers every configured workload cron except the gap check itself", () => {
    const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");
    const cronBlock = wranglerConfig.match(/"crons"\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    const configuredCrons = [...cronBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(configuredCrons).toContain(SCHEDULED_OBSERVATION_GAP_CHECK_CRON);

    const workloadCrons = configuredCrons.filter(
      (cron) => cron !== SCHEDULED_OBSERVATION_GAP_CHECK_CRON,
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
      "Scheduled-work gap check OVERDUE for 0 */3 * * *; last observed: 2026-07-30T06:00:00.000Z.",
    ]);
  });

  it("gives newly activated schedules one cadence before paging", async () => {
    const now = new Date("2026-07-30T12:13:00.000Z");
    const db = healthDb([]);
    const env = {
      DB: db,
      LAUNCH_CANARY_EMAIL: "ops@0509.io",
    };

    const initial = await sendScheduledObservationGapAlert(env as never, { now });
    expect(initial).toMatchObject({ sent: false, reason: "healthy" });
    expect(initial.health.filter((entry) => entry.overdue)).toHaveLength(0);
    expect(sendOperatorAlertEmailDetailed).not.toHaveBeenCalled();

    const afterGrace = await sendScheduledObservationGapAlert(env as never, {
      now: new Date("2026-08-08T12:13:00.001Z"),
    });

    expect(afterGrace).toMatchObject({ sent: true, reason: "sent" });
    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        subject: "0509 scheduled-work gap: 4 unhealthy",
        idempotencyKey: "scheduled-observation-gap:15:initial",
      }),
    );
  });

  it("uses a rolling throttle while paging a newly unhealthy schedule immediately", async () => {
    const firstAt = new Date("2026-07-30T11:59:59.999Z");
    const db = healthDb(
      [{ cron: "0 */3 * * *", last_scheduled_at: "2026-07-30T06:00:00.000Z" }],
      firstAt.toISOString(),
    );
    const env = { DB: db, LAUNCH_CANARY_EMAIL: "ops@0509.io" };

    await expect(sendScheduledObservationGapAlert(env as never, { now: firstAt }))
      .resolves.toMatchObject({ sent: true, reason: "sent" });
    await expect(sendScheduledObservationGapAlert(env as never, {
      now: new Date("2026-07-30T12:00:00.001Z"),
    })).resolves.toMatchObject({ sent: false, reason: "throttled" });

    db.setRows([
      { cron: "0 */3 * * *", last_scheduled_at: "2026-07-30T06:00:00.000Z" },
      { cron: "17 */6 * * *", last_scheduled_at: "2026-07-30T04:17:00.000Z" },
    ]);
    await expect(sendScheduledObservationGapAlert(env as never, {
      now: new Date("2026-07-30T12:00:00.002Z"),
    })).resolves.toMatchObject({ sent: true, reason: "sent" });
    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledTimes(2);
  });

  it("keeps provider-unknown retries on one durable key across six-hour rotation", async () => {
    const firstAt = new Date("2026-07-30T06:00:00.000Z");
    const db = healthDb([
      { cron: "0 */3 * * *", last_scheduled_at: "2026-07-30T00:00:00.000Z" },
      { cron: "17 */6 * * *", last_scheduled_at: firstAt.toISOString() },
      { cron: "0 4 * * *", last_scheduled_at: firstAt.toISOString() },
      { cron: "0 5 * * MON", last_scheduled_at: firstAt.toISOString() },
    ], firstAt.toISOString());
    const env = { DB: db, LAUNCH_CANARY_EMAIL: "ops@0509.io" };
    sendOperatorAlertEmailDetailed
      .mockResolvedValueOnce("in_flight_or_unknown")
      .mockResolvedValueOnce("in_flight_or_unknown");

    await expect(sendScheduledObservationGapAlert(env as never, { now: firstAt }))
      .resolves.toMatchObject({ sent: false, reason: "alert_pending" });
    await expect(sendScheduledObservationGapAlert(env as never, {
      now: new Date(firstAt.getTime() + 7 * 60 * 60 * 1000),
    })).resolves.toMatchObject({ sent: false, reason: "alert_pending" });

    const keys = sendOperatorAlertEmailDetailed.mock.calls.map(
      (call) => call[1].idempotencyKey,
    );
    expect(keys).toEqual([
      "scheduled-observation-gap:1:initial",
      "scheduled-observation-gap:1:initial",
    ]);
  });

  it("bounds retries after a definitive gap-alert rejection", async () => {
    const firstAt = new Date("2026-07-30T06:00:00.000Z");
    const db = healthDb([
      { cron: "0 */3 * * *", last_scheduled_at: "2026-07-30T00:00:00.000Z" },
      { cron: "17 */6 * * *", last_scheduled_at: firstAt.toISOString() },
      { cron: "0 4 * * *", last_scheduled_at: firstAt.toISOString() },
      { cron: "0 5 * * MON", last_scheduled_at: firstAt.toISOString() },
    ], firstAt.toISOString());
    const env = { DB: db, LAUNCH_CANARY_EMAIL: "ops@0509.io" };
    sendOperatorAlertEmailDetailed.mockResolvedValue("rejected");

    await expect(sendScheduledObservationGapAlert(env as never, { now: firstAt }))
      .resolves.toMatchObject({ sent: false, reason: "alert_not_sent" });
    await expect(sendScheduledObservationGapAlert(env as never, {
      now: new Date(firstAt.getTime() + 60 * 60 * 1000),
    })).resolves.toMatchObject({ sent: false, reason: "retry_throttled" });
    expect(sendOperatorAlertEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it("does not renew grace when retained observation evidence disappears", async () => {
    const first = new Date("2026-07-20T12:13:00.000Z");
    const db = healthDb([
      { cron: "0 */3 * * *", last_scheduled_at: "2026-07-20T12:00:00.000Z" },
    ], first.toISOString());
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

  it("quarantines future evidence instead of letting it suppress an overdue gap", async () => {
    const now = new Date("2026-07-30T12:13:00.000Z");
    const health = await listScheduledObservationHealth(
      {
        DB: healthDb(
          [
            {
              cron: "0 */3 * * *",
              last_scheduled_at: null,
              future_observation_count: 1,
            },
          ],
          "2026-07-30T06:00:00.000Z",
        ),
      } as never,
      { now },
    );

    expect(health.find((entry) => entry.cron === "0 */3 * * *")).toMatchObject({
      lastScheduledAt: null,
      overdue: true,
      futureEvidence: true,
    });
    expect(formatScheduledObservationHealthLines(health)).toContain(
      "Scheduled-work gap check found quarantined future evidence for 0 */3 * * *.",
    );
  });

  it("quarantines future evidence through the real SQLite freshness query", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0070_release_scheduled_observations.sql");
    applyMigration(harness.sqlite, "migrations/0072_scheduled_observation_health_state.sql");
    harness.sqlite.prepare(`
      UPDATE scheduled_observation_health_state
      SET baseline_at = ?, updated_at = ?
      WHERE cron = ?
    `).run(
      "2026-07-30T06:00:00.000Z",
      "2026-07-30T06:00:00.000Z",
      "0 */3 * * *",
    );
    harness.sqlite.prepare(`
      INSERT INTO release_scheduled_observation (
        id, worker_version_id, cron, task_name, scheduled_at, started_at,
        completed_at, duration_ms, outcome, failure_category, metrics_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "12345678-1234-1234-1234-123456789abc",
      "worker-v1",
      "0 */3 * * *",
      "scheduled_monitoring",
      "2026-07-31T12:13:00.001Z",
      "2026-07-30T12:13:00.000Z",
      "2026-07-30T12:13:01.000Z",
      1_000,
      "no_work",
      null,
      "{}",
      "2026-07-30T12:13:01.000Z",
    );

    try {
      const db = {
        prepare(sql: string) {
          const statement = harness.db.prepare(sql);
          return {
            ...statement,
            all: <T>() => statement.bind().all<T>(),
          };
        },
      };
      const health = await listScheduledObservationHealth(
        { DB: db } as never,
        { now: new Date("2026-07-30T12:13:00.000Z") },
      );
      expect(health.find((entry) => entry.cron === "0 */3 * * *")).toMatchObject({
        lastScheduledAt: null,
        overdue: true,
        futureEvidence: true,
      });
    } finally {
      harness.close();
    }
  });
});
