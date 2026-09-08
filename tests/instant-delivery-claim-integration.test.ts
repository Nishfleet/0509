import { afterEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1 } from "./helpers/sqlite-d1";

const target = {
  id: "email-target-1",
  userId: "user-1",
  watchlistId: null,
  channel: "email" as const,
  targetValue: "owner@example.com",
  validationStatus: "validated" as const,
  isValidated: true,
  isOptedIn: true,
  optInSource: "account_email" as const,
  optedInAt: "2026-07-14T00:00:00.000Z",
  isPaused: false,
  pausedAt: null,
  optedOutAt: null,
  templateEligible: false,
  lastSuccessfulDeliveryAt: null,
  lastSuccessfulAttemptId: null,
  providerIdentifier: null,
  metadata: {},
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

const event = {
  id: "event-1",
  watchlistId: "watch-1",
  runId: "run-1",
  eventType: "landing_page_url_changed",
  status: "confirmed" as const,
  importanceScore: 90,
  adId: "meta-1",
  baselineFromRunId: null,
  candidateId: "candidate-1",
  proofCaptureId: "proof-1",
  title: "Landing page URL changed",
  summary: "The landing page URL changed.",
  metadata: { advertiser: "Nykaa" },
  confirmedAt: "2026-07-14T00:00:00.000Z",
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: "2026-07-14T00:00:00.000Z",
  createdAt: "2026-07-14T00:00:00.000Z",
};

function createAttemptTable(harness: ReturnType<typeof createSqliteD1>) {
  harness.sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      emailVerified INTEGER NOT NULL
    );
    INSERT INTO user (id, email, name, emailVerified)
    VALUES ('user-1', 'owner@example.com', 'Owner', 1);
    CREATE TABLE delivery_target (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      target_value TEXT NOT NULL,
      opt_in_source TEXT,
      validation_status TEXT NOT NULL,
      is_validated INTEGER NOT NULL,
      is_opted_in INTEGER NOT NULL,
      is_paused INTEGER NOT NULL,
      template_eligible INTEGER NOT NULL DEFAULT 0,
      paused_at TEXT,
      opted_out_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO delivery_target (
      id, user_id, channel, target_value, opt_in_source, validation_status,
      is_validated, is_opted_in, is_paused, paused_at, opted_out_at, updated_at
    ) VALUES (
      'email-target-1', 'user-1', 'email', 'owner@example.com', 'account_email',
      'validated', 1, 1, 0, NULL, NULL, '2026-07-15T00:00:00.000Z'
    );
    CREATE TABLE delivery_attempt (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      digest_run_id TEXT,
      delivery_target_id TEXT,
      lane TEXT NOT NULL,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      webhook_status TEXT NOT NULL,
      target_value TEXT NOT NULL,
      provider_message_id TEXT,
      provider_status_last_seen_at TEXT,
      template_name TEXT,
      event_ids_json TEXT NOT NULL DEFAULT '[]',
      payload_snapshot_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT UNIQUE,
      error_message TEXT,
      sent_at TEXT,
      failed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function input() {
  return {
    userId: "user-1",
    userName: "Owner",
    accountEmail: "owner@example.com",
    watchlist: { id: "watch-1", userId: "user-1", name: "Nykaa watch" },
    events: [event],
  };
}

async function loadDelivery(
  harness: ReturnType<typeof createSqliteD1>,
  send: ReturnType<typeof vi.fn>,
  upsertDeliveryTarget = vi.fn().mockResolvedValue(target),
) {
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue("starter"),
  }));
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
  }));
  vi.doMock("~/lib/data.server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/data.server")>();
    return {
      ...actual,
      listAdsByIds: vi.fn().mockResolvedValue([]),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: true,
        digestEnabled: true,
  digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      }),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      provisionVerifiedAccountEmailTargetIfUnsuppressed: upsertDeliveryTarget,
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    };
  });

  const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
  const env = {
    DB: harness.db,
    EMAIL: { send },
    EMAIL_FROM_EMAIL: "alerts@0509.io",
    BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
    BETTER_AUTH_URL: "https://0509.io",
  } as never;
  return (request = input()) => deliverWatchlistAlerts(env, request as never);
}

describe("instant delivery durable claim wiring", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.close();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("sends a concurrent initial email dispatch once and persists one attempt", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createAttemptTable(harness);
    const send = vi.fn().mockResolvedValue({ messageId: "msg-1" });
    const deliver = await loadDelivery(harness, send);

    const results = await Promise.all([deliver(), deliver()]);

    expect(results).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      harness.sqlite
        .prepare("SELECT COUNT(*) AS count, status FROM delivery_attempt")
        .get(),
    ).toMatchObject({ count: 1, status: "sent" });
  });

  it("sends a concurrent failed retry once and updates the failed row in place", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createAttemptTable(harness);
    harness.sqlite.exec(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, delivery_target_id, lane, channel, provider,
        status, webhook_status, target_value, idempotency_key, error_message,
        failed_at, created_at, updated_at
      ) VALUES (
        'attempt-failed', 'user-1', 'watch-1', 'email-target-1', 'customer', 'email',
        'cloudflare_email', 'failed', 'failed', 'owner@example.com',
        'instant:watch-1:customer:email:owner@example.com:watch-1:nykaa:1982208:send',
        'smtp down', '2026-07-14T00:00:00.000Z',
        '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z'
      );
    `);
    const send = vi.fn().mockResolvedValue({ messageId: "msg-retry" });
    const deliver = await loadDelivery(harness, send);

    await Promise.all([deliver(), deliver()]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(
      harness.sqlite
        .prepare("SELECT COUNT(*) AS count, id, status FROM delivery_attempt")
        .get(),
    ).toMatchObject({ count: 1, id: "attempt-failed", status: "sent" });
  });

  it("attaches the current target when reclaiming a legacy failed customer attempt", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createAttemptTable(harness);
    harness.sqlite.exec(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, delivery_target_id, lane, channel, provider,
        status, webhook_status, target_value, template_name, idempotency_key,
        error_message, failed_at, created_at, updated_at
      ) VALUES (
        'attempt-legacy-activation', 'user-1', 'watch-1', NULL, 'customer',
        'email', 'cloudflare_email', 'failed', 'failed', 'owner@example.com',
        'activation_result', 'activation-result:user-1:watch-1', 'smtp down',
        '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z',
        '2026-07-14T00:00:00.000Z'
      );
    `);

    const {
      claimInstantDeliveryAttempt,
      markInstantDeliveryDispatchStarted,
    } = await import("~/lib/data/delivery-records-attempts.server");
    const env = { DB: harness.db } as never;
    const claim = await claimInstantDeliveryAttempt(env, {
      userId: "user-1",
      watchlistId: "watch-1",
      deliveryTargetId: "email-target-1",
      lane: "customer",
      channel: "email",
      provider: "cloudflare_email",
      targetValue: "owner@example.com",
      templateName: "activation_result",
      eventIds: [],
      payloadSnapshot: {
        kind: "activation_result",
        watchlistId: "watch-1",
        adsFound: 1,
      },
      idempotencyKey: "activation-result:user-1:watch-1",
    });

    expect(claim).toMatchObject({
      attemptId: "attempt-legacy-activation",
      reclaimed: true,
    });
    expect(
      harness.sqlite
        .prepare(`
          SELECT delivery_target_id
          FROM delivery_attempt
          WHERE id = 'attempt-legacy-activation'
        `)
        .get(),
    ).toEqual({ delivery_target_id: "email-target-1" });
    await expect(
      markInstantDeliveryDispatchStarted(
        env,
        "attempt-legacy-activation",
        claim.claimUpdatedAt!,
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it("fails closed when the durable claim disappears during provider I/O", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createAttemptTable(harness);
    const upsertDeliveryTarget = vi.fn().mockResolvedValue(target);
    let callsBeforeProvider = 0;
    const send = vi.fn().mockImplementation(async () => {
      callsBeforeProvider = upsertDeliveryTarget.mock.calls.length;
      harness.sqlite.exec("DELETE FROM delivery_attempt");
      return { messageId: "msg-orphaned" };
    });
    const deliver = await loadDelivery(harness, send, upsertDeliveryTarget);

    await expect(deliver()).rejects.toThrow(
      "Instant delivery attempt disappeared during finalization.",
    );
    expect(upsertDeliveryTarget).toHaveBeenCalledTimes(callsBeforeProvider);
  });
});
