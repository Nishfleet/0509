import { readdirSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  alertConsecutiveWatchlistFailures,
  reportConsecutiveWatchlistFailure,
  WATCHLIST_FAILURE_ALERT_THROTTLE_MS,
} from "~/lib/watchlist-failure-alert.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const deliveryMocks = vi.hoisted(() => ({
  sendOperatorAlertEmail: vi.fn(),
}));

vi.mock("~/lib/delivery.server", () => ({
  sendOperatorAlertEmail: deliveryMocks.sendOperatorAlertEmail,
}));

const WATCHLIST_ID = "5d21674e-2d23-4bd2-ab5c-5818abb5d699";
const USER_ID = "starter-alert-user";

function applyAllMigrations(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
  for (const migration of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    applyMigration(sqlite, `migrations/${migration}`);
  }
}

function createHarness() {
  const harness = createSqliteD1();
  applyAllMigrations(harness.sqlite);
  harness.sqlite
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Starter customer', 'starter-alert@example.test', 1, ?, ?)`,
    )
    .run(
      USER_ID,
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
  harness.sqlite
    .prepare(
      `INSERT INTO watchlist (
         id,
         user_id,
         name,
         target_type,
         target_id,
         target_fingerprint,
         target_label,
         target_country,
         is_active,
         created_at,
         updated_at
       )
       VALUES (?, ?, 'adspy watch', 'advertiser', 'adspy', 'fp-adspy', 'adspy', NULL, 1, ?, ?)`,
    )
    .run(
      WATCHLIST_ID,
      USER_ID,
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
  return harness;
}

function insertRun(
  sqlite: ReturnType<typeof createSqliteD1>["sqlite"],
  input: {
    id: string;
    status: "failed" | "succeeded";
    startedAt: string;
    triggerType?: "manual" | "scheduled";
    errorCode?: string | null;
  },
) {
  sqlite
    .prepare(
      `INSERT INTO watchlist_run (
         id,
         watchlist_id,
         trigger_type,
         status,
         page_budget,
         pages_scanned,
         baseline_from_run_id,
         summary_json,
         started_at,
         finished_at,
         error_code,
         error_message,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, 2, 0, NULL, '{"adsSeen":0,"events":0}', ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      input.id,
      WATCHLIST_ID,
      input.triggerType ?? "scheduled",
      input.status,
      input.startedAt,
      input.startedAt,
      input.errorCode ?? (input.status === "failed" ? "monitoring_failed" : null),
      input.startedAt,
      input.startedAt,
    );
}

function alertInput(runId: string, now: Date) {
  return {
    watchlistId: WATCHLIST_ID,
    watchlistName: "adspy watch",
    runId,
    triggerType: "scheduled" as const,
    now,
  };
}

describe("consecutive scheduled watchlist failure alerts", () => {
  beforeEach(() => {
    deliveryMocks.sendOperatorAlertEmail.mockReset();
    deliveryMocks.sendOperatorAlertEmail.mockResolvedValue(true);
  });

  it("does not email before three consecutive scheduled failures", async () => {
    const harness = createHarness();
    insertRun(harness.sqlite, {
      id: "failed-1",
      status: "failed",
      startedAt: "2026-07-19T06:00:00.000Z",
    });
    insertRun(harness.sqlite, {
      id: "failed-2",
      status: "failed",
      startedAt: "2026-07-19T09:00:00.000Z",
    });

    try {
      await expect(
        alertConsecutiveWatchlistFailures(
          { DB: harness.db } as never,
          alertInput(
            "failed-2",
            new Date("2026-07-19T09:00:01.000Z"),
          ),
        ),
      ).resolves.toEqual({
        sent: false,
        reason: "below_threshold",
        consecutiveFailures: 2,
      });
      expect(deliveryMocks.sendOperatorAlertEmail).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("emails on the third failure and throttles later failures per watchlist", async () => {
    const harness = createHarness();
    for (const [index, startedAt] of [
      "2026-07-19T06:00:00.000Z",
      "2026-07-19T09:00:00.000Z",
      "2026-07-19T12:00:00.000Z",
    ].entries()) {
      insertRun(harness.sqlite, {
        id: `failed-${index + 1}`,
        status: "failed",
        startedAt,
      });
    }
    const firstAlertAt = new Date("2026-07-19T12:00:01.000Z");

    try {
      await expect(
        alertConsecutiveWatchlistFailures(
          { DB: harness.db } as never,
          alertInput("failed-3", firstAlertAt),
        ),
      ).resolves.toEqual({
        sent: true,
        reason: "sent",
        consecutiveFailures: 3,
      });
      expect(deliveryMocks.sendOperatorAlertEmail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          subject: "0509 watchlist monitoring failure: adspy watch",
          idempotencyKey:
            expect.stringMatching(
              new RegExp(`^watchlist-failure:${WATCHLIST_ID}:\\d+$`),
            ),
          lines: expect.arrayContaining([
            expect.stringContaining(
              "has failed 3 consecutive scheduled runs",
            ),
            "Failure code: monitoring_failed.",
          ]),
        }),
      );

      insertRun(harness.sqlite, {
        id: "failed-4",
        status: "failed",
        startedAt: "2026-07-19T15:00:00.000Z",
      });
      await expect(
        alertConsecutiveWatchlistFailures(
          { DB: harness.db } as never,
          alertInput(
            "failed-4",
            new Date(
              firstAlertAt.getTime() +
                WATCHLIST_FAILURE_ALERT_THROTTLE_MS -
                1,
            ),
          ),
        ),
      ).resolves.toEqual({
        sent: false,
        reason: "throttled",
        consecutiveFailures: 4,
      });
      expect(deliveryMocks.sendOperatorAlertEmail).toHaveBeenCalledTimes(1);
      expect(
        harness.sqlite
          .prepare(
            `SELECT last_error, alert_count
             FROM cron_failure_alert_throttle
             WHERE task_key = ?`,
          )
          .get(`watchlist_failure_${WATCHLIST_ID}`),
      ).toEqual({
        last_error: "operator_alert_sent",
        alert_count: 1,
      });

      insertRun(harness.sqlite, {
        id: "failed-5",
        status: "failed",
        startedAt: "2026-07-19T18:00:00.000Z",
      });
      await expect(
        alertConsecutiveWatchlistFailures(
          { DB: harness.db } as never,
          alertInput(
            "failed-5",
            new Date(
              firstAlertAt.getTime() +
                WATCHLIST_FAILURE_ALERT_THROTTLE_MS +
                1,
            ),
          ),
        ),
      ).resolves.toEqual({
        sent: true,
        reason: "sent",
        consecutiveFailures: 5,
      });
      expect(deliveryMocks.sendOperatorAlertEmail).toHaveBeenCalledTimes(2);
      expect(
        harness.sqlite
          .prepare(
            `SELECT last_error, alert_count
             FROM cron_failure_alert_throttle
             WHERE task_key = ?`,
          )
          .get(`watchlist_failure_${WATCHLIST_ID}`),
      ).toEqual({
        last_error: "operator_alert_sent",
        alert_count: 2,
      });
      expect(
        deliveryMocks.sendOperatorAlertEmail.mock.calls[0]?.[1]
          .idempotencyKey,
      ).not.toBe(
        deliveryMocks.sendOperatorAlertEmail.mock.calls[1]?.[1]
          .idempotencyKey,
      );
    } finally {
      harness.close();
    }
  });

  it("resets the consecutive count after a successful scheduled run", async () => {
    const harness = createHarness();
    insertRun(harness.sqlite, {
      id: "old-failed-1",
      status: "failed",
      startedAt: "2026-07-19T03:00:00.000Z",
    });
    insertRun(harness.sqlite, {
      id: "recovered",
      status: "succeeded",
      startedAt: "2026-07-19T06:00:00.000Z",
    });
    insertRun(harness.sqlite, {
      id: "new-failed-1",
      status: "failed",
      startedAt: "2026-07-19T09:00:00.000Z",
    });

    try {
      await expect(
        alertConsecutiveWatchlistFailures(
          { DB: harness.db } as never,
          alertInput(
            "new-failed-1",
            new Date("2026-07-19T09:00:01.000Z"),
          ),
        ),
      ).resolves.toEqual({
        sent: false,
        reason: "below_threshold",
        consecutiveFailures: 1,
      });
    } finally {
      harness.close();
    }
  });

  it("retries an operator sender failure without burning the throttle window", async () => {
    deliveryMocks.sendOperatorAlertEmail.mockRejectedValue(
      new Error("email unavailable"),
    );
    const harness = createHarness();
    for (const [index, startedAt] of [
      "2026-07-19T06:00:00.000Z",
      "2026-07-19T09:00:00.000Z",
      "2026-07-19T12:00:00.000Z",
    ].entries()) {
      insertRun(harness.sqlite, {
        id: `failed-${index + 1}`,
        status: "failed",
        startedAt,
      });
    }
    const firstAlertAt = new Date("2026-07-19T12:00:01.000Z");

    try {
      await expect(
        alertConsecutiveWatchlistFailures(
          { DB: harness.db } as never,
          alertInput("failed-3", firstAlertAt),
        ),
      ).resolves.toEqual({
        sent: false,
        reason: "email_failed",
        consecutiveFailures: 3,
      });
      deliveryMocks.sendOperatorAlertEmail.mockResolvedValue(true);
      await expect(
        alertConsecutiveWatchlistFailures(
          { DB: harness.db } as never,
          alertInput(
            "failed-3",
            new Date(firstAlertAt.getTime() + 1_000),
          ),
        ),
      ).resolves.toEqual({
        sent: true,
        reason: "sent",
        consecutiveFailures: 3,
      });
      expect(deliveryMocks.sendOperatorAlertEmail).toHaveBeenCalledTimes(2);
      expect(
        harness.sqlite
          .prepare(
            `SELECT last_error, alert_count
             FROM cron_failure_alert_throttle
             WHERE task_key = ?`,
          )
          .get(`watchlist_failure_${WATCHLIST_ID}`),
      ).toEqual({
        last_error: "operator_alert_sent",
        alert_count: 1,
      });
    } finally {
      harness.close();
    }
  });

  it("logs and retries a false operator send without changing the failed run path", async () => {
    deliveryMocks.sendOperatorAlertEmail.mockResolvedValue(false);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const harness = createHarness();
    for (const [index, startedAt] of [
      "2026-07-19T06:00:00.000Z",
      "2026-07-19T09:00:00.000Z",
      "2026-07-19T12:00:00.000Z",
    ].entries()) {
      insertRun(harness.sqlite, {
        id: `failed-${index + 1}`,
        status: "failed",
        startedAt,
      });
    }

    try {
      await expect(
        reportConsecutiveWatchlistFailure(
          { DB: harness.db } as never,
          {
            watchlistId: WATCHLIST_ID,
            watchlistName: "adspy watch",
            runId: "failed-3",
            triggerType: "scheduled",
          },
        ),
      ).resolves.toMatchObject({
        sent: false,
        reason: "email_skipped",
        consecutiveFailures: 3,
      });
      expect(consoleError).toHaveBeenCalledWith(
        "watchlist failure operator alert was not sent",
        expect.objectContaining({
          watchlistId: WATCHLIST_ID,
          runId: "failed-3",
          reason: "email_skipped",
          consecutiveFailures: 3,
        }),
      );
      expect(
        harness.sqlite
          .prepare(
            `SELECT task_key
             FROM cron_failure_alert_throttle
             WHERE task_key = ?`,
          )
          .get(`watchlist_failure_${WATCHLIST_ID}`),
      ).toBeUndefined();

      deliveryMocks.sendOperatorAlertEmail.mockResolvedValue(true);
      await expect(
        reportConsecutiveWatchlistFailure(
          { DB: harness.db } as never,
          {
            watchlistId: WATCHLIST_ID,
            watchlistName: "adspy watch",
            runId: "failed-3",
            triggerType: "scheduled",
          },
        ),
      ).resolves.toMatchObject({
        sent: true,
        reason: "sent",
        consecutiveFailures: 3,
      });
      expect(deliveryMocks.sendOperatorAlertEmail).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
      harness.close();
    }
  });

  it("keeps throttle keys isolated for future non-UUID watchlist IDs", async () => {
    const harness = createHarness();
    const futureWatchlistId = "workspace/watchlist:future-format";
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist (
           id,
           user_id,
           name,
           target_type,
           target_id,
           target_fingerprint,
           target_label,
           target_country,
           is_active,
           created_at,
           updated_at
         )
         VALUES (?, ?, 'future watch', 'advertiser', 'future', 'fp-future', 'future', NULL, 1, ?, ?)`,
      )
      .run(
        futureWatchlistId,
        USER_ID,
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      );
    for (const [index, startedAt] of [
      "2026-07-19T06:00:00.000Z",
      "2026-07-19T09:00:00.000Z",
      "2026-07-19T12:00:00.000Z",
    ].entries()) {
      harness.sqlite
        .prepare(
          `INSERT INTO watchlist_run (
             id,
             watchlist_id,
             trigger_type,
             status,
             page_budget,
             pages_scanned,
             summary_json,
             started_at,
             finished_at,
             error_code,
             created_at,
             updated_at
           )
           VALUES (?, ?, 'scheduled', 'failed', 2, 0, '{}', ?, ?, 'monitoring_failed', ?, ?)`,
        )
        .run(
          `future-failed-${index + 1}`,
          futureWatchlistId,
          startedAt,
          startedAt,
          startedAt,
          startedAt,
        );
    }

    try {
      await expect(
        alertConsecutiveWatchlistFailures(
          { DB: harness.db } as never,
          {
            watchlistId: futureWatchlistId,
            watchlistName: "future watch",
            runId: "future-failed-3",
            triggerType: "scheduled",
            now: new Date("2026-07-19T12:00:01.000Z"),
          },
        ),
      ).resolves.toMatchObject({
        sent: true,
        reason: "sent",
        consecutiveFailures: 3,
      });
      expect(
        harness.sqlite
          .prepare(
            `SELECT task_key
             FROM cron_failure_alert_throttle
             WHERE task_key = ?`,
          )
          .get(`watchlist_failure_${futureWatchlistId}`),
      ).toEqual({
        task_key: `watchlist_failure_${futureWatchlistId}`,
      });
    } finally {
      harness.close();
    }
  });

  it("reports an unknown count when alert evaluation itself fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const db = {
      prepare: vi.fn(() => {
        throw new Error("D1 unavailable");
      }),
    };

    try {
      await expect(
        reportConsecutiveWatchlistFailure(
          { DB: db } as never,
          {
            watchlistId: WATCHLIST_ID,
            watchlistName: "adspy watch",
            runId: "failed-3",
            triggerType: "scheduled",
          },
        ),
      ).resolves.toEqual({
        sent: false,
        reason: "alert_failed",
        consecutiveFailures: null,
      });
      expect(consoleError).toHaveBeenCalledWith(
        "watchlist failure alert itself failed",
        expect.objectContaining({
          watchlistId: WATCHLIST_ID,
          runId: "failed-3",
          error: "D1 unavailable",
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
