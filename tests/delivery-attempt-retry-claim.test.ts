import { afterEach, describe, expect, it } from "vitest";

import {
  claimInstantDeliveryAttempt,
  markInstantDeliveryDispatchStarted,
  suppressEmailTargetsForUserAndAddress,
  updateDeliveryAttemptResult,
} from "~/lib/data.server";
import {
  DELIVERY_PRE_DISPATCH_LEASE_MS,
  isStalePreDispatchAttempt,
} from "~/lib/delivery-attempt-lease";
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

  it("marks one claim as dispatch-started and never reclaims that ambiguous state", async () => {
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
    const env = { DB: harness.db } as never;
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
      idempotencyKey: "instant:watch-1:customer:email:owner@example.com:batch-2:send",
    };
    const claim = await claimInstantDeliveryAttempt(env, input);

    const starts = await Promise.all([
      markInstantDeliveryDispatchStarted(env, claim.attemptId!, claim.claimUpdatedAt!),
      markInstantDeliveryDispatchStarted(env, claim.attemptId!, claim.claimUpdatedAt!),
    ]);

    expect(starts.filter(Boolean)).toHaveLength(1);
    expect(
      harness.sqlite.prepare("SELECT status, webhook_status FROM delivery_attempt").get(),
    ).toMatchObject({ status: "pending", webhook_status: "provider_unknown" });

    harness.sqlite
      .prepare("UPDATE delivery_attempt SET updated_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", claim.attemptId);
    const retry = await claimInstantDeliveryAttempt(env, input);
    expect(retry.attemptId).toBeNull();
    expect(retry.duplicate?.webhookStatus).toBe("provider_unknown");
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
