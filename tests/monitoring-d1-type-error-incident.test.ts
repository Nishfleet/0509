import { readdirSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScheduledMonitoringWorkflowParams } from "~/lib/monitoring-fanout.server";
import { createSqliteD1, applyMigration } from "./helpers/sqlite-d1";

const browserDiscoveryMocks = vi.hoisted(() => ({
  searchMetaLibraryByBrowser: vi.fn(),
}));
const deliveryMocks = vi.hoisted(() => ({
  sendOperatorAlertEmail: vi.fn(),
}));

vi.mock("~/lib/meta-library-browser.server", () => ({
  CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
    failureClass = "browser_launch_failed" as const;
  },
  getInteractiveMetaApiExtraPages: vi.fn(() => 0),
  searchMetaLibraryByBrowser:
    browserDiscoveryMocks.searchMetaLibraryByBrowser,
}));

vi.mock("~/lib/analysis.server", () => ({
  buildAnalysisFields: vi.fn(() => []),
}));

vi.mock("~/lib/creative-text.server", () => ({
  captureCreativeText: vi.fn(),
}));

vi.mock("~/lib/delivery.server", () => ({
  deliverWatchlistAlerts: vi.fn().mockResolvedValue({
    attempts: 0,
    channels: [],
    details: [],
  }),
  sendOperatorAlertEmail: deliveryMocks.sendOperatorAlertEmail,
}));

vi.mock("~/lib/landing-pages.server", () => ({
  captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
}));

const WATCHLIST_ID = "5d21674e-2d23-4bd2-ab5c-5818abb5d699";
const USER_ID = "incident-starter-user";
const FIRST_FAILURE_AT = "2026-07-19T12:00:55.000Z";
const SCHEDULED_AT = "2026-07-30T03:00:55.000Z";

function applyAllMigrations(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
  for (const migration of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    applyMigration(sqlite, `migrations/${migration}`);
  }
}

function seedIncidentState(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
  applyAllMigrations(sqlite);
  sqlite
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Starter customer', 'starter@example.test', 1, ?, ?)`,
    )
    .run(USER_ID, SCHEDULED_AT, SCHEDULED_AT);
  sqlite
    .prepare(
      `INSERT INTO user_plan (
         user_id,
         plan,
         dodo_status,
         dodo_product_id,
         dodo_subscription_id,
         plan_updated_at
       )
       VALUES (?, 'starter', 'active', 'prod-starter', 'sub-starter', ?)`,
    )
    .run(USER_ID, "2026-07-01T00:00:00.000Z");
  sqlite
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
         last_scanned_at,
         created_at,
         updated_at
       )
       VALUES (?, ?, 'adspy watch', 'advertiser', 'adspy', 'fp-adspy', 'adspy', NULL, 1, NULL, ?, ?)`,
    )
    .run(WATCHLIST_ID, USER_ID, SCHEDULED_AT, SCHEDULED_AT);
  const firstFailureMs = Date.parse(FIRST_FAILURE_AT);
  for (let index = 0; index < 85; index += 1) {
    const failedAt = new Date(
      firstFailureMs + index * 3 * 60 * 60 * 1000,
    ).toISOString();
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
           updated_at,
           idempotency_key,
           workflow_instance_id,
           queued_at,
           attempt_count,
           queue_priority
         )
         VALUES (?, ?, 'scheduled', 'failed', 2, 0, NULL, '{"adsSeen":0,"events":0}', ?, ?, 'monitoring_failed', ?, ?, ?, ?, ?, ?, 1, 1)`,
      )
      .run(
        `historical-failure-${index + 1}`,
        WATCHLIST_ID,
        failedAt,
        failedAt,
        "D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'",
        failedAt,
        failedAt,
        `incident-historical-${index + 1}`,
        `monitor-v1-historical-${index + 1}`,
        failedAt,
      );
  }
}

function sparseDiscoveryAd(overrides: Record<string, unknown> = {}) {
  return {
    metaAdId: "incident-ad-1",
    advertiser: "adspy",
    body: "Find winning ads",
    previewHeadline: "Ad intelligence",
    previewSubhead: "",
    hook: "Ad intelligence",
    offer: "",
    cta: "Learn more",
    format: "image",
    languageLabel: "English",
    destinationType: "unknown",
    // Legacy/sparse discovery payloads can omit a nullable URL instead
    // of spelling the absence as null.
    landingPageUrl: undefined,
    adSnapshotUrl: null,
    countries: ["India"],
    platforms: ["Facebook"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Captured from commercial discovery.",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

function healthyDiscoveryResponse(ads: Array<Record<string, unknown>>) {
  return {
    ads,
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    discoveryStatus: "healthy",
    discoverySummary: null,
    discoveryFailureClass: null,
  };
}

function workflowEnv(db: ReturnType<typeof createSqliteD1>["db"]) {
  const createBatch = vi.fn(
    async (
      batch: Array<{
        id: string;
        params: ScheduledMonitoringWorkflowParams;
      }>,
    ) => batch.map(({ id }) => ({ id })),
  );
  const env = {
    DB: db,
    BROWSER: { fetch: vi.fn() },
    MONITORING_WORKFLOW: {
      create: vi.fn(),
      createBatch,
    },
    MONITORING_FANOUT_MODE: "fanout",
    MONITORING_FANOUT_GLOBAL: "1",
    MONITORING_SCHEDULED_BROWSER_MODE: "all",
  };
  return { env, createBatch };
}

async function queueNextScheduledRun(
  harness: ReturnType<typeof createSqliteD1>,
  setup: ReturnType<typeof workflowEnv>,
) {
  const { scheduleWatchlistFanout } = await import(
    "~/lib/monitoring-fanout.server"
  );
  const result = await scheduleWatchlistFanout(setup.env as never, {
    watchlists: [
      {
        id: WATCHLIST_ID,
        userId: USER_ID,
        name: "adspy watch",
        targetType: "advertiser",
        targetId: "adspy",
        targetFingerprint: "fp-adspy",
        targetLabel: "adspy",
        targetCountry: null,
        isActive: true,
        lastScannedAt: null,
        createdAt: SCHEDULED_AT,
        updatedAt: SCHEDULED_AT,
      },
    ],
    scheduledTime: Date.parse(SCHEDULED_AT),
    cron: "0 */3 * * *",
    mode: "fanout",
  });
  expect(result).toMatchObject({
    eligible: 1,
    queued: 1,
    duplicates: 0,
    dispatchFailures: 0,
  });
  const dispatched = setup.createBatch.mock.calls[0]?.[0]?.[0];
  expect(dispatched).toBeDefined();
  const params = dispatched!.params;
  expect(
    harness.sqlite
      .prepare(
        `SELECT
           status,
           pages_scanned,
           baseline_from_run_id,
           attempt_count,
           workflow_instance_id
         FROM watchlist_run
         WHERE id = ?`,
      )
      .get(params.runId),
  ).toEqual({
    status: "pending",
    pages_scanned: 0,
    baseline_from_run_id: null,
    attempt_count: 0,
    workflow_instance_id: dispatched!.id,
  });
  return params;
}

describe("scheduled monitoring D1_TYPE_ERROR incident", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("completes a null-baseline Starter Workflow run with a sparse discovery ad", async () => {
    const harness = createSqliteD1();
    seedIncidentState(harness.sqlite);
    deliveryMocks.sendOperatorAlertEmail.mockResolvedValue(true);
    browserDiscoveryMocks.searchMetaLibraryByBrowser.mockResolvedValue(
      healthyDiscoveryResponse([sparseDiscoveryAd()]),
    );
    const setup = workflowEnv(harness.db);

    try {
      const params = await queueNextScheduledRun(harness, setup);
      const { runWatchlistWorkflowJob } = await import(
        "~/lib/monitoring.server"
      );
      const result = await runWatchlistWorkflowJob(
        setup.env as never,
        params as never,
      );

      expect(result).toMatchObject({
        status: "completed",
        runId: params.runId,
        events: 1,
      });
      expect(
        harness.sqlite
          .prepare(
            `SELECT status, pages_scanned, baseline_from_run_id, error_code, error_message
             FROM watchlist_run
             WHERE id = ?`,
          )
          .get(params.runId),
      ).toEqual({
        status: "succeeded",
        pages_scanned: 1,
        baseline_from_run_id: null,
        error_code: null,
        error_message: null,
      });
      expect(
        harness.sqlite
          .prepare(
            `SELECT COUNT(*) AS failures
             FROM watchlist_run
             WHERE watchlist_id = ? AND status = 'failed'`,
          )
          .get(WATCHLIST_ID),
      ).toEqual({ failures: 85 });
      expect(
        harness.sqlite
          .prepare(
            `SELECT
               landing_page_url,
               json_extract(raw_json, '$.landingPageUrl') AS raw_landing_page_url,
               json_type(raw_json, '$.landingPageUrl') AS raw_landing_page_url_type
             FROM ad
             WHERE id = 'incident-ad-1'`,
          )
          .get(),
      ).toEqual({
        landing_page_url: null,
        raw_landing_page_url: null,
        raw_landing_page_url_type: "null",
      });
      expect(
        harness.sqlite
          .prepare(
            `SELECT landing_page_url
             FROM ad_observation
             WHERE watchlist_run_id = ?`,
          )
          .get(params.runId),
      ).toEqual({ landing_page_url: null });
      expect(
        harness.sqlite
          .prepare(
            `SELECT last_scanned_at
             FROM watchlist
             WHERE id = ?`,
          )
          .get(WATCHLIST_ID),
      ).toMatchObject({
        last_scanned_at: expect.any(String),
      });
      expect(deliveryMocks.sendOperatorAlertEmail).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("sends a throttled operator alert when the next scheduled run still fails", async () => {
    const harness = createSqliteD1();
    seedIncidentState(harness.sqlite);
    deliveryMocks.sendOperatorAlertEmail.mockResolvedValue(true);
    browserDiscoveryMocks.searchMetaLibraryByBrowser.mockResolvedValue(
      healthyDiscoveryResponse([
        sparseDiscoveryAd({ researchSummary: undefined }),
      ]),
    );
    const setup = workflowEnv(harness.db);

    try {
      const params = await queueNextScheduledRun(harness, setup);
      const { runWatchlistWorkflowJob } = await import(
        "~/lib/monitoring.server"
      );
      await expect(
        runWatchlistWorkflowJob(
          setup.env as never,
          params as never,
        ),
      ).rejects.toThrow('D1 binding "ad.researchSummary" is undefined');

      expect(
        harness.sqlite
          .prepare(
            `SELECT
               status,
               pages_scanned,
               baseline_from_run_id,
               summary_json,
               attempt_count,
               error_code,
               error_message
             FROM watchlist_run
             WHERE id = ?`,
          )
          .get(params.runId),
      ).toEqual({
        status: "failed",
        pages_scanned: 0,
        baseline_from_run_id: null,
        summary_json: '{"adsSeen":0,"events":0}',
        attempt_count: 1,
        error_code: "monitoring_failed",
        error_message:
          'D1 binding "ad.researchSummary" is undefined; pass a supported value or opt in to SQL NULL.',
      });
      expect(deliveryMocks.sendOperatorAlertEmail).toHaveBeenCalledWith(
        setup.env,
        expect.objectContaining({
          subject: "0509 watchlist monitoring failure: adspy watch",
          lines: expect.arrayContaining([
            expect.stringContaining(
              "has failed 86 consecutive scheduled runs",
            ),
          ]),
        }),
      );
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
});
