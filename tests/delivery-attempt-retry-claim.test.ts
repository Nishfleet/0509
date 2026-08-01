import { afterEach, describe, expect, it } from "vitest";

import {
  claimInstantDeliveryAttempt,
  createDeliveryAttempt,
  markInstantDeliveryDispatchStarted,
  suppressEmailTargetsForUserAndAddress,
  updateDeliveryAttemptResult,
} from "~/lib/data.server";
import {
  DELIVERY_PRE_DISPATCH_LEASE_MS,
  isStalePreDispatchAttempt,
} from "~/lib/delivery-attempt-lease";
import { readOperatorAlertEmailOutcome } from "~/lib/delivery-account-emails.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

describe("delivery attempt retry claim (sqlite)", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) {
      fixtures.pop()?.close();
    }
  });

  it("lets only one concurrent instant dispatch claim the same key", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    harness.sqlite.exec(`
      CREATE TABLE user (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        emailVerified INTEGER NOT NULL
      );
      INSERT INTO user (id, email, emailVerified)
      VALUES ('user-1', 'owner@example.com', 1);
      CREATE TABLE delivery_target (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        target_value TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        is_validated INTEGER NOT NULL,
        is_opted_in INTEGER NOT NULL,
        is_paused INTEGER NOT NULL,
        template_eligible INTEGER NOT NULL DEFAULT 0,
        opted_out_at TEXT
      );
      INSERT INTO delivery_target (
        id, user_id, channel, target_value, validation_status,
        is_validated, is_opted_in, is_paused, opted_out_at
      ) VALUES (
        'target-1', 'user-1', 'email', 'owner@example.com',
        'validated', 1, 1, 0, NULL
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

    const input = {
      userId: "user-1",
      watchlistId: "watch-1",
      deliveryTargetId: "target-1",
      lane: "customer" as const,
      channel: "email" as const,
      provider: "cloudflare_email",
      targetValue: "owner@example.com",
      eventIds: ["event-1"],
      payloadSnapshot: { kind: "instant_alert" },
      idempotencyKey:
        "instant:watch-1:customer:email:owner@example.com:batch-1:send",
    };

    const claims = await Promise.all([
      claimInstantDeliveryAttempt({ DB: harness.db } as never, input),
      claimInstantDeliveryAttempt({ DB: harness.db } as never, input),
    ]);

    expect(claims.filter((claim) => claim.attemptId !== null)).toHaveLength(1);
    expect(
      harness.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM delivery_attempt WHERE idempotency_key = ?",
        )
        .get(input.idempotencyKey),
    ).toMatchObject({ count: 1 });
  });

  it("marks one digest claim through the real D1 dispatch CAS", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    harness.sqlite.exec(`
      CREATE TABLE user (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        emailVerified INTEGER NOT NULL
      );
      INSERT INTO user (id, email, emailVerified)
      VALUES ('user-1', 'owner@example.com', 1);
      CREATE TABLE delivery_target (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        target_value TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        is_validated INTEGER NOT NULL,
        is_opted_in INTEGER NOT NULL,
        is_paused INTEGER NOT NULL,
        template_eligible INTEGER NOT NULL DEFAULT 0,
        opted_out_at TEXT
      );
      INSERT INTO delivery_target (
        id, user_id, channel, target_value, validation_status,
        is_validated, is_opted_in, is_paused, opted_out_at
      ) VALUES (
        'target-1', 'user-1', 'slack', 'https://hooks.slack.test/1',
        'validated', 1, 1, 0, NULL
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
    const env = { DB: harness.db } as never;
    const claimUpdatedAt = "2026-07-19T05:00:00.000Z";
    const attemptId = await createDeliveryAttempt(env, {
      userId: "user-1",
      watchlistId: null,
      digestRunId: "digest-1",
      deliveryTargetId: "target-1",
      lane: "customer" as const,
      channel: "slack" as const,
      provider: "slack_incoming_webhook",
      status: "pending" as const,
      webhookStatus: "pending" as const,
      targetValue: "https://hooks.slack.test/1",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: null,
      eventIds: ["event-1"],
      payloadSnapshot: {
        kind: "weekly_digest",
        deliveryClaimProtocol: "digest_preclaim_v1",
      },
      idempotencyKey: "digest:digest-1:customer:slack:owner@example.com",
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      timestamp: claimUpdatedAt,
    });

    const starts = await Promise.all([
      markInstantDeliveryDispatchStarted(env, attemptId, claimUpdatedAt),
      markInstantDeliveryDispatchStarted(env, attemptId, claimUpdatedAt),
    ]);

    expect(starts.filter(Boolean)).toHaveLength(1);
    expect(
      harness.sqlite.prepare("SELECT status, webhook_status FROM delivery_attempt").get(),
    ).toMatchObject({ status: "pending", webhook_status: "provider_unknown" });

  });

  it("makes unsubscribe win before dispatch while preserving dispatch-first provider_unknown", async () => {
    const makeHarness = () => {
      const harness = createSqliteD1();
      harness.sqlite.exec(`
        CREATE TABLE user (
          id TEXT PRIMARY KEY NOT NULL,
          email TEXT NOT NULL,
          emailVerified INTEGER NOT NULL
        );
        INSERT INTO user (id, email, emailVerified)
        VALUES ('user-1', 'owner@example.com', 1);
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
          updated_at TEXT NOT NULL,
          metadata_json TEXT
        );
        INSERT INTO delivery_target (
          id, user_id, channel, target_value, opt_in_source, validation_status,
          is_validated, is_opted_in, is_paused, paused_at, opted_out_at, updated_at, metadata_json
        ) VALUES (
          'target-1', 'user-1', 'email', 'Owner@Example.com', 'account_email',
          'validated', 1, 1, 0, NULL, NULL, '2026-07-15T00:00:00.000Z', '{}'
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
      fixtures.push(harness);
      return harness;
    };
    const input = (key: string) => ({
      userId: "user-1",
      watchlistId: "watch-1",
      deliveryTargetId: "target-1",
      lane: "customer" as const,
      channel: "email" as const,
      provider: "cloudflare_email",
      targetValue: " Owner@Example.com ",
      eventIds: ["event-1"],
      payloadSnapshot: { kind: "instant_alert" },
      idempotencyKey: key,
    });

    const unsubscribeWins = makeHarness();
    const firstClaim = await claimInstantDeliveryAttempt(
      { DB: unsubscribeWins.db } as never,
      input("race-unsubscribe-wins"),
    );
    await suppressEmailTargetsForUserAndAddress(
      { DB: unsubscribeWins.db } as never,
      { userId: "user-1", targetValue: " owner@example.com " },
    );
    await expect(
      markInstantDeliveryDispatchStarted(
        { DB: unsubscribeWins.db } as never,
        firstClaim.attemptId!,
        firstClaim.claimUpdatedAt!,
      ),
    ).resolves.toBeNull();
    expect(unsubscribeWins.sqlite.prepare(
      "SELECT status, webhook_status, target_value FROM delivery_attempt",
    ).get()).toMatchObject({ status: "failed", webhook_status: "failed", target_value: "owner@example.com" });

    const dispatchWins = makeHarness();
    const secondClaim = await claimInstantDeliveryAttempt(
      { DB: dispatchWins.db } as never,
      input("race-dispatch-wins"),
    );
    await expect(
      markInstantDeliveryDispatchStarted(
        { DB: dispatchWins.db } as never,
        secondClaim.attemptId!,
        secondClaim.claimUpdatedAt!,
      ),
    ).resolves.toEqual(expect.any(String));
    await suppressEmailTargetsForUserAndAddress(
      { DB: dispatchWins.db } as never,
      { userId: "user-1", targetValue: "owner@example.com" },
    );
    expect(dispatchWins.sqlite.prepare(
      "SELECT status, webhook_status FROM delivery_attempt",
    ).get()).toMatchObject({ status: "pending", webhook_status: "provider_unknown" });

    const addressChangeWins = makeHarness();
    const thirdClaim = await claimInstantDeliveryAttempt(
      { DB: addressChangeWins.db } as never,
      input("race-address-change-wins"),
    );
    addressChangeWins.sqlite.exec(`
      UPDATE user SET email = 'new-owner@example.com' WHERE id = 'user-1';
      UPDATE delivery_target
      SET target_value = 'new-owner@example.com',
          updated_at = '2026-07-19T05:02:00.000Z'
      WHERE id = 'target-1';
    `);
    await expect(
      markInstantDeliveryDispatchStarted(
        { DB: addressChangeWins.db } as never,
        thirdClaim.attemptId!,
        thirdClaim.claimUpdatedAt!,
      ),
    ).resolves.toBeNull();
    expect(addressChangeWins.sqlite.prepare(
      "SELECT status, webhook_status, target_value FROM delivery_attempt",
    ).get()).toMatchObject({
      status: "pending",
      webhook_status: "pending",
      target_value: "owner@example.com",
    });
  });

  it("blocks customer Slack and WhatsApp dispatch when current target consent changes", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    harness.sqlite.exec(`
      CREATE TABLE user (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        emailVerified INTEGER NOT NULL
      );
      INSERT INTO user (id, email, emailVerified)
      VALUES ('user-1', 'owner@example.com', 1);
      CREATE TABLE delivery_target (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        target_value TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        is_validated INTEGER NOT NULL,
        is_opted_in INTEGER NOT NULL,
        is_paused INTEGER NOT NULL,
        template_eligible INTEGER NOT NULL DEFAULT 0,
        opted_out_at TEXT
      );
      INSERT INTO delivery_target (
        id, user_id, channel, target_value, validation_status,
        is_validated, is_opted_in, is_paused, template_eligible, opted_out_at
      ) VALUES
        ('slack-1', 'user-1', 'slack', 'https://hooks.slack.test/1',
         'validated', 1, 1, 0, 0, NULL),
        ('whatsapp-1', 'user-1', 'whatsapp', '+15555550100',
         'validated', 1, 1, 0, 1, NULL),
        ('whatsapp-control', 'user-1', 'whatsapp', '+15555550101',
         'validated', 1, 1, 0, 1, NULL);
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
    const env = { DB: harness.db } as never;
    const timestamp = "2026-07-19T05:00:00.000Z";
    const createAttempt = (
      channel: "slack" | "whatsapp",
      targetId: string,
      targetValue: string,
    ) =>
      createDeliveryAttempt(env, {
        userId: "user-1",
        watchlistId: "watch-1",
        digestRunId: null,
        deliveryTargetId: targetId,
        lane: "customer" as const,
        channel,
        provider: channel === "slack" ? "slack_incoming_webhook" : "whatsapp_cloud_api",
        status: "pending" as const,
        webhookStatus: "pending" as const,
        targetValue,
        providerMessageId: null,
        providerStatusLastSeenAt: null,
        templateName: channel === "whatsapp" ? "proof_digest_customer_v1" : null,
        eventIds: ["event-1"],
        payloadSnapshot: { kind: "instant_alert" },
        idempotencyKey: `consent-race:${channel}:${targetId}`,
        errorMessage: null,
        sentAt: null,
        failedAt: null,
        timestamp,
      });

    const slackAttempt = await createAttempt(
      "slack",
      "slack-1",
      "https://hooks.slack.test/1",
    );
    const whatsappAttempt = await createAttempt(
      "whatsapp",
      "whatsapp-1",
      "+15555550100",
    );
    const whatsappControl = await createAttempt(
      "whatsapp",
      "whatsapp-control",
      "+15555550101",
    );
    harness.sqlite.exec(`
      UPDATE delivery_target SET is_paused = 1 WHERE id = 'slack-1';
      UPDATE delivery_target
      SET is_opted_in = 0, opted_out_at = '2026-07-19T05:01:00.000Z'
      WHERE id = 'whatsapp-1';
    `);

    await expect(
      markInstantDeliveryDispatchStarted(env, slackAttempt, timestamp),
    ).resolves.toBeNull();
    await expect(
      markInstantDeliveryDispatchStarted(env, whatsappAttempt, timestamp),
    ).resolves.toBeNull();
    await expect(
      markInstantDeliveryDispatchStarted(env, whatsappControl, timestamp),
    ).resolves.toEqual(expect.any(String));
    expect(
      harness.sqlite
        .prepare(
          "SELECT id, status, webhook_status FROM delivery_attempt ORDER BY target_value",
        )
        .all(),
    ).toEqual([
      { id: whatsappAttempt, status: "pending", webhook_status: "pending" },
      { id: whatsappControl, status: "pending", webhook_status: "provider_unknown" },
      { id: slackAttempt, status: "pending", webhook_status: "pending" },
    ]);
  });

  it("claims one failed retry, reclaims stale pending, and skips active pending", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    harness.sqlite.exec(`
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

    const claimInput = (idempotencyKey: string) => ({
      userId: "user-1",
      watchlistId: "watch-1",
      deliveryTargetId: "target-1",
      lane: "customer" as const,
      channel: "email" as const,
      provider: "cloudflare_email",
      targetValue: "owner@example.com",
      eventIds: ["event-1"],
      payloadSnapshot: { kind: "instant_alert" },
      idempotencyKey,
    });
    const now = new Date().toISOString();
    harness.sqlite.exec(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, delivery_target_id, lane, channel, provider,
        status, webhook_status, target_value, idempotency_key, error_message,
        failed_at, created_at, updated_at
      ) VALUES
        ('failed', 'user-1', 'watch-1', 'target-1', 'customer', 'email',
         'cloudflare_email', 'failed', 'failed', 'owner@example.com',
         'failed-key', 'smtp down', '${now}', '${now}', '${now}'),
        ('stale', 'user-1', 'watch-1', 'target-1', 'customer', 'email',
         'cloudflare_email', 'pending', 'pending', 'owner@example.com',
         'stale-key', NULL, NULL, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
        ('active', 'user-1', 'watch-1', 'target-1', 'customer', 'email',
         'cloudflare_email', 'pending', 'pending', 'owner@example.com',
         'active-key', NULL, NULL, '${now}', '${now}')
    `);

    const failedClaims = await Promise.all([
      claimInstantDeliveryAttempt(
        { DB: harness.db } as never,
        claimInput("failed-key"),
      ),
      claimInstantDeliveryAttempt(
        { DB: harness.db } as never,
        claimInput("failed-key"),
      ),
    ]);
    expect(
      failedClaims.filter((claim) => claim.attemptId !== null),
    ).toHaveLength(1);

    const staleClaim = await claimInstantDeliveryAttempt(
      { DB: harness.db } as never,
      claimInput("stale-key"),
    );
    expect(staleClaim.attemptId).toBe("stale");
    expect(staleClaim.reclaimed).toBe(true);

    const activeClaim = await claimInstantDeliveryAttempt(
      { DB: harness.db } as never,
      claimInput("active-key"),
    );
    expect(activeClaim.attemptId).toBeNull();
    expect(activeClaim.duplicate?.id).toBe("active");
  });

  it("allows only one failed-to-pending retry claim", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    harness.sqlite.exec(`
      CREATE TABLE delivery_attempt (
        id TEXT PRIMARY KEY NOT NULL,
        delivery_target_id TEXT,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        webhook_status TEXT NOT NULL,
        provider_message_id TEXT,
        provider_status_last_seen_at TEXT,
        template_name TEXT,
        payload_snapshot_json TEXT NOT NULL DEFAULT '{}',
        target_value TEXT NOT NULL DEFAULT 'owner@example.com',
        error_message TEXT,
        sent_at TEXT,
        failed_at TEXT,
        updated_at TEXT NOT NULL
      );

      INSERT INTO delivery_attempt (
        id, provider, status, webhook_status, failed_at, updated_at
      ) VALUES (
        'attempt-1', 'cloudflare_email', 'failed', 'failed',
        '2026-07-13T09:00:00.000Z', '2026-07-13T09:00:00.000Z'
      );
    `);

    const claim = {
      provider: "cloudflare_email",
      status: "pending" as const,
      webhookStatus: "pending" as const,
      providerMessageId: null,
      providerStatusLastSeenAt: "2026-07-13T09:05:00.000Z",
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      expectedStatus: "failed" as const,
    };

    await expect(
      updateDeliveryAttemptResult(
        { DB: harness.db } as never,
        "attempt-1",
        claim,
      ),
    ).resolves.toBe(true);
    await expect(
      updateDeliveryAttemptResult(
        { DB: harness.db } as never,
        "attempt-1",
        claim,
      ),
    ).resolves.toBe(false);

    expect(
      harness.sqlite
        .prepare(
          "SELECT status, webhook_status, failed_at FROM delivery_attempt WHERE id = ?",
        )
        .get("attempt-1"),
    ).toMatchObject({
      status: "pending",
      webhook_status: "pending",
      failed_at: null,
    });
  });

  it("allows only one exact-version stale pre-dispatch lease reclaim", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    harness.sqlite.exec(`
      CREATE TABLE delivery_attempt (
        id TEXT PRIMARY KEY NOT NULL,
        delivery_target_id TEXT,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        webhook_status TEXT NOT NULL,
        provider_message_id TEXT,
        provider_status_last_seen_at TEXT,
        template_name TEXT,
        payload_snapshot_json TEXT NOT NULL DEFAULT '{}',
        target_value TEXT NOT NULL DEFAULT 'owner@example.com',
        error_message TEXT,
        sent_at TEXT,
        failed_at TEXT,
        updated_at TEXT NOT NULL
      );

      INSERT INTO delivery_attempt (
        id, provider, status, webhook_status, updated_at
      ) VALUES (
        'attempt-stale', 'cloudflare_email', 'pending', 'pending',
        '2026-07-13T09:00:00.000Z'
      );
    `);

    const claim = {
      provider: "cloudflare_email",
      status: "pending" as const,
      webhookStatus: "pending" as const,
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      updatedAt: "2026-07-13T09:02:00.000Z",
      expectedStatus: "pending" as const,
      expectedWebhookStatus: "pending" as const,
      expectedUpdatedAt: "2026-07-13T09:00:00.000Z",
    };

    await expect(
      updateDeliveryAttemptResult(
        { DB: harness.db } as never,
        "attempt-stale",
        claim,
      ),
    ).resolves.toBe(true);
    await expect(
      updateDeliveryAttemptResult(
        { DB: harness.db } as never,
        "attempt-stale",
        claim,
      ),
    ).resolves.toBe(false);

    expect(
      harness.sqlite
        .prepare(
          "SELECT status, webhook_status, updated_at FROM delivery_attempt WHERE id = ?",
        )
        .get("attempt-stale"),
    ).toMatchObject({
      status: "pending",
      webhook_status: "pending",
      updated_at: "2026-07-13T09:02:00.000Z",
    });
  });

  it("reads persisted operator delivery outcomes without treating provider-unknown as rejected", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    harness.sqlite.exec(`
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
      INSERT INTO delivery_attempt (
        id, user_id, lane, channel, provider, status, webhook_status,
        target_value, idempotency_key, created_at, updated_at
      ) VALUES (
        'attempt-operator', 'user-1', 'internal', 'email', 'cloudflare_email',
        'pending', 'provider_unknown', 'owner@example.com',
        'cron-failure:scheduled_monitoring:1',
        '2026-07-12T06:00:00.000Z', '2026-07-12T06:00:01.000Z'
      );
    `);
    const env = { DB: harness.db } as never;
    const key = "cron-failure:scheduled_monitoring:1";

    await expect(readOperatorAlertEmailOutcome(env, key)).resolves.toEqual({
      outcome: "in_flight_or_unknown",
      observedAt: "2026-07-12T06:00:01.000Z",
    });

    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'failed', webhook_status = 'failed',
          failed_at = '2026-07-12T06:00:02.000Z',
          updated_at = '2026-07-12T06:00:02.000Z'
      WHERE id = 'attempt-operator'
    `).run();
    await expect(readOperatorAlertEmailOutcome(env, key)).resolves.toEqual({
      outcome: "rejected",
      observedAt: "2026-07-12T06:00:02.000Z",
    });

    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'sent', webhook_status = 'provider_unknown',
          sent_at = '2026-07-12T06:00:03.000Z',
          updated_at = '2026-07-12T06:00:03.000Z'
      WHERE id = 'attempt-operator'
    `).run();
    await expect(readOperatorAlertEmailOutcome(env, key)).resolves.toEqual({
      outcome: "already_accepted",
      observedAt: "2026-07-12T06:00:03.000Z",
    });
  });
});

describe("delivery pre-dispatch lease", () => {
  const now = Date.parse("2026-07-13T09:02:00.000Z");
  const attempt = {
    status: "pending" as const,
    webhookStatus: "pending" as const,
    updatedAt: new Date(now - DELIVERY_PRE_DISPATCH_LEASE_MS).toISOString(),
  };

  it("treats the exact lease boundary as stale", () => {
    expect(isStalePreDispatchAttempt(attempt, now)).toBe(true);
  });

  it("does not reclaim fresh, provider-unknown, terminal, or malformed attempts", () => {
    expect(
      isStalePreDispatchAttempt(
        {
          ...attempt,
          updatedAt: new Date(
            now - DELIVERY_PRE_DISPATCH_LEASE_MS + 1,
          ).toISOString(),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isStalePreDispatchAttempt(
        { ...attempt, webhookStatus: "provider_unknown" },
        now,
      ),
    ).toBe(false);
    expect(isStalePreDispatchAttempt({ ...attempt, status: "sent" }, now)).toBe(
      false,
    );
    expect(
      isStalePreDispatchAttempt({ ...attempt, updatedAt: "not-a-date" }, now),
    ).toBe(false);
  });
});
