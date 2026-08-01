import { afterEach, describe, expect, it } from "vitest";

import {
  reconcileInstantChannelAttemptWithAudit,
  reconcileInstantEmailAttemptWithAudit,
} from "~/lib/data/operator-delivery-reconciliation.server";
import {
  listOutstandingInstantProviderUnknownAttempts,
  listRetryableInstantAttempts,
} from "~/lib/data/delivery-records-attempts.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

describe("operator instant-alert email reconciliation", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.close();
  });

  function setup() {
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
        idempotency_key TEXT,
        error_message TEXT,
        sent_at TEXT,
        failed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_action_audit (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        api_key_id TEXT,
        action_name TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        idempotency_key TEXT,
        status TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_test_instant_audit_idempotency
        ON agent_action_audit(user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
    harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane,
        channel, provider, status, webhook_status, target_value,
        provider_status_last_seen_at, event_ids_json, payload_snapshot_json,
        idempotency_key, error_message, failed_at, created_at, updated_at
      ) VALUES (
        'instant-attempt-1', 'customer-1', 'watch-1', NULL, 'email-target-1',
        'customer', 'email', 'cloudflare_email', 'failed', 'provider_unknown',
        'owner@example.com', '2026-07-15T18:00:30.000Z', '["event-1"]',
        '{"kind":"instant_alert"}',
        'instant:watch-1:customer:email:owner@example.com:batch-1',
        'Cloudflare Email send outcome is unknown after provider exception.',
        '2026-07-15T18:00:30.000Z',
        '2026-07-15T18:00:00.000Z', '2026-07-15T18:00:30.000Z'
      )
    `).run();
    return harness;
  }

  function input(overrides: Record<string, unknown> = {}) {
    return {
      operatorUserId: "operator-1",
      attemptId: "instant-attempt-1",
      idempotencyKey: "ops-instant-email-reconcile:11111111-1111-4111-8111-111111111111",
      expectedUpdatedAt: "2026-07-15T18:00:30.000Z",
      outcome: "sent" as const,
      classification: "controlled_inbox_receipt" as const,
      evidenceReference: "instant_inbox_receipt_12345",
      observedAt: "2026-07-15T18:01:00.000Z",
      ...overrides,
    };
  }

  it("atomically records provider truth and an audit without sending", async () => {
    const harness = setup();

    const first = await reconcileInstantEmailAttemptWithAudit(
      { DB: harness.db } as never,
      input(),
    );
    const replay = await reconcileInstantEmailAttemptWithAudit(
      { DB: harness.db } as never,
      input(),
    );

    expect(first).toMatchObject({ ok: true, replayed: false, outcome: "sent" });
    expect(replay).toMatchObject({ ok: true, replayed: true, outcome: "sent" });
    expect(
      harness.sqlite.prepare(`
        SELECT status, webhook_status, sent_at, payload_snapshot_json
        FROM delivery_attempt WHERE id = 'instant-attempt-1'
      `).get(),
    ).toMatchObject({
      status: "sent",
      webhook_status: "delivered",
      sent_at: "2026-07-15T18:01:00.000Z",
    });
    const payload = harness.sqlite
      .prepare("SELECT payload_snapshot_json FROM delivery_attempt WHERE id = 'instant-attempt-1'")
      .get() as { payload_snapshot_json: string };
    expect(JSON.parse(payload.payload_snapshot_json)).toMatchObject({
      instantAlertProviderEvidence: {
        reference: "instant_inbox_receipt_12345",
        classification: "controlled_inbox_receipt",
        outcome: "sent",
      },
    });
    expect(
      harness.sqlite.prepare("SELECT action_name, status FROM agent_action_audit").get(),
    ).toMatchObject({ action_name: "ops.instant_email.reconcile", status: "succeeded" });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 1 });
  });

  it("rejects a reused reconciliation key when the evidence reference changes", async () => {
    const harness = setup();
    await reconcileInstantEmailAttemptWithAudit({ DB: harness.db } as never, input());

    await expect(
      reconcileInstantEmailAttemptWithAudit(
        { DB: harness.db } as never,
        input({ evidenceReference: "different_instant_receipt_67890" }),
      ),
    ).resolves.toEqual({ ok: false, reason: "idempotency_conflict" });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 1 });
  });

  it("makes a provider-confirmed rejection retryable and rejects stale competing evidence", async () => {
    const harness = setup();
    const failed = await reconcileInstantEmailAttemptWithAudit(
      { DB: harness.db } as never,
      input({
        outcome: "failed",
        classification: "provider_rejection_log",
        evidenceReference: "instant_provider_reject_12345",
      }),
    );
    const stale = await reconcileInstantEmailAttemptWithAudit(
      { DB: harness.db } as never,
      input({
        idempotencyKey: "ops-instant-email-reconcile:22222222-2222-4222-8222-222222222222",
        outcome: "sent",
      }),
    );

    expect(failed).toMatchObject({ ok: true, outcome: "failed" });
    expect(stale).toEqual({ ok: false, reason: "stale" });
    expect(
      harness.sqlite.prepare(`
        SELECT status, webhook_status FROM delivery_attempt WHERE id = 'instant-attempt-1'
      `).get(),
    ).toMatchObject({ status: "failed", webhook_status: "failed" });
    await expect(
      listRetryableInstantAttempts(
        { DB: harness.db } as never,
        {
          since: "2026-07-14T00:00:00.000Z",
          stalePreDispatchBefore: "2026-07-15T17:59:00.000Z",
          limit: 10,
        },
      ),
    ).resolves.toMatchObject([{ id: "instant-attempt-1" }]);
  });

  it("lists provider-unknown instant email attempts for explicit reconciliation", async () => {
    const harness = setup();
    await expect(
      listOutstandingInstantProviderUnknownAttempts({ DB: harness.db } as never, { limit: 10 }),
    ).resolves.toMatchObject([{ id: "instant-attempt-1" }]);
  });

  it("prioritizes ambiguous pending attempts ahead of accepted sends", async () => {
    const harness = setup();
    harness.sqlite.prepare("DELETE FROM delivery_attempt").run();
    const insert = harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane,
        channel, provider, status, webhook_status, target_value,
        event_ids_json, payload_snapshot_json, idempotency_key, sent_at,
        created_at, updated_at
      ) VALUES (
        ?, 'customer-1', 'watch-1', NULL, 'email-target-1', 'customer',
        'email', 'cloudflare_email', ?, 'provider_unknown',
        'owner@example.com', '["event-1"]', '{"kind":"instant_alert"}',
        ?, ?, ?, ?
      )
    `);
    for (let index = 0; index < 100; index += 1) {
      const timestamp = `2026-07-15T17:00:${String(index % 60).padStart(2, "0")}.000Z`;
      insert.run(
        `accepted-${index}`,
        "sent",
        `instant:watch-1:customer:email:owner@example.com:accepted-${index}`,
        timestamp,
        timestamp,
        timestamp,
      );
    }
    insert.run(
      "pending-needs-attention",
      "pending",
      "instant:watch-1:customer:email:owner@example.com:pending",
      null,
      "2026-07-15T18:00:00.000Z",
      "2026-07-15T18:00:00.000Z",
    );

    const attempts = await listOutstandingInstantProviderUnknownAttempts(
      { DB: harness.db } as never,
      { limit: 100 },
    );

    expect(attempts).toHaveLength(100);
    expect(attempts[0]).toMatchObject({
      id: "pending-needs-attention",
      status: "pending",
    });
    expect(attempts.filter((attempt) => attempt.status === "sent")).toHaveLength(99);
  });

  it("lists and settles a provider-accepted instant email whose delivery is unconfirmed", async () => {
    const harness = setup();
    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'sent',
          error_message = NULL,
          sent_at = '2026-07-15T18:00:30.000Z',
          failed_at = NULL
      WHERE id = 'instant-attempt-1'
    `).run();

    await expect(
      listOutstandingInstantProviderUnknownAttempts({ DB: harness.db } as never, { limit: 10 }),
    ).resolves.toMatchObject([{ id: "instant-attempt-1", status: "sent" }]);
    await expect(
      reconcileInstantEmailAttemptWithAudit({ DB: harness.db } as never, input()),
    ).resolves.toMatchObject({ ok: true, replayed: false, outcome: "sent" });
    expect(
      harness.sqlite.prepare(`
        SELECT status, webhook_status, sent_at
        FROM delivery_attempt WHERE id = 'instant-attempt-1'
      `).get(),
    ).toMatchObject({
      status: "sent",
      webhook_status: "delivered",
      sent_at: "2026-07-15T18:00:30.000Z",
    });
  });

  it("selects only quiet-hours, definite failures, and stale pre-dispatch email work", async () => {
    const harness = setup();
    harness.sqlite.prepare("DELETE FROM delivery_attempt").run();
    const insert = harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane,
        channel, provider, status, webhook_status, target_value, event_ids_json,
        payload_snapshot_json, idempotency_key, created_at, updated_at
      ) VALUES (?, 'customer-1', 'watch-1', NULL, 'email-target-1', 'customer',
        'email', 'cloudflare_email', ?, ?, 'owner@example.com', '["event-1"]',
        '{"kind":"instant_alert"}', ?, '2026-07-15T17:00:00.000Z', ?)
    `);
    insert.run("quiet", "skipped_due_to_quiet_hours", "provider_unknown", "instant:quiet", "2026-07-15T18:00:00.000Z");
    insert.run("definite", "failed", "failed", "instant:definite", "2026-07-15T18:00:00.000Z");
    insert.run("stale", "pending", "pending", "instant:stale", "2026-07-15T17:58:00.000Z");
    insert.run("fresh", "pending", "pending", "instant:fresh", "2026-07-15T18:01:00.000Z");
    insert.run("failed-unknown", "failed", "provider_unknown", "instant:failed-unknown", "2026-07-15T17:00:00.000Z");
    insert.run("pending-unknown", "pending", "provider_unknown", "instant:pending-unknown", "2026-07-15T17:00:00.000Z");

    const retryable = await listRetryableInstantAttempts(
      { DB: harness.db } as never,
      {
        since: "2026-07-14T00:00:00.000Z",
        stalePreDispatchBefore: "2026-07-15T18:00:00.000Z",
        limit: 20,
      },
    );
    expect(retryable.map((attempt) => attempt.id)).toEqual(["quiet", "definite", "stale"]);
  });

  it("does not let completed quiet-hours rows starve the next deferred alert", async () => {
    const harness = setup();
    harness.sqlite.prepare("DELETE FROM delivery_attempt").run();
    const insert = harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane,
        channel, provider, status, webhook_status, target_value, event_ids_json,
        payload_snapshot_json, idempotency_key, created_at, updated_at
      ) VALUES (?, 'customer-1', 'watch-1', NULL, 'email-target-1', 'customer',
        'email', 'cloudflare_email', ?, ?, 'owner@example.com', '["event-1"]',
        '{"kind":"instant_alert"}', ?, '2026-07-15T17:00:00.000Z',
        '2026-07-15T17:00:00.000Z')
    `);
    for (let index = 0; index < 51; index += 1) {
      const prefix = `instant:watch-1:customer:email:owner@example.com:batch-${index}`;
      insert.run(
        `quiet-${index}`,
        "skipped_due_to_quiet_hours",
        "provider_unknown",
        `${prefix}:quiet-hours`,
      );
      if (index < 50) {
        insert.run(`send-${index}`, "sent", "provider_unknown", `${prefix}:send`);
      }
    }

    const retryable = await listRetryableInstantAttempts(
      { DB: harness.db } as never,
      {
        since: "2026-07-14T00:00:00.000Z",
        stalePreDispatchBefore: "2026-07-15T18:00:00.000Z",
        limit: 50,
      },
    );
    expect(retryable.map((attempt) => attempt.id)).toEqual(["quiet-50"]);
  });
});

describe.each([
  {
    channel: "whatsapp" as const,
    provider: "whatsapp_cloud_api",
    targetValue: "919876543210",
    sentClassification: "meta_whatsapp_message_log" as const,
    failedClassification: "provider_rejection_log" as const,
    actionName: "ops.instant_whatsapp.reconcile",
  },
  {
    channel: "slack" as const,
    provider: "slack_incoming_webhook",
    targetValue: "slack:workspace/channel",
    sentClassification: "controlled_channel_observation" as const,
    failedClassification: "provider_rejection_log" as const,
    actionName: "ops.instant_slack.reconcile",
  },
])("operator instant-alert $channel reconciliation", (fixture) => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.close();
  });

  function setup() {
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
        idempotency_key TEXT,
        error_message TEXT,
        sent_at TEXT,
        failed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_action_audit (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        api_key_id TEXT,
        action_name TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        idempotency_key TEXT,
        status TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_test_instant_channel_audit_idempotency
        ON agent_action_audit(user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
    harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane,
        channel, provider, status, webhook_status, target_value,
        provider_status_last_seen_at, event_ids_json, payload_snapshot_json,
        idempotency_key, error_message, failed_at, created_at, updated_at
      ) VALUES (
        'instant-channel-attempt-1', 'customer-1', 'watch-1', NULL, ?,
        'customer', ?, ?, 'failed', 'provider_unknown', ?,
        '2026-07-15T18:00:30.000Z', '["event-1"]',
        '{"kind":"instant_alert"}', ?,
        'Provider outcome is unknown after transport ambiguity.',
        '2026-07-15T18:00:30.000Z',
        '2026-07-15T18:00:00.000Z', '2026-07-15T18:00:30.000Z'
      )
    `).run(
      `${fixture.channel}-target-1`,
      fixture.channel,
      fixture.provider,
      fixture.targetValue,
      `instant:watch-1:customer:${fixture.channel}:${fixture.targetValue}:batch-1:send`,
    );
    return harness;
  }

  function input(overrides: Record<string, unknown> = {}) {
    return {
      operatorUserId: "operator-1",
      attemptId: "instant-channel-attempt-1",
      idempotencyKey: `ops-instant-${fixture.channel}-reconcile:11111111-1111-4111-8111-111111111111`,
      expectedUpdatedAt: "2026-07-15T18:00:30.000Z",
      channel: fixture.channel,
      outcome: "sent" as const,
      classification: fixture.sentClassification,
      evidenceReference: `${fixture.channel}_provider_evidence_12345`,
      observedAt: "2026-07-15T18:01:00.000Z",
      ...overrides,
    };
  }

  it("atomically records provider truth and audit evidence without sending", async () => {
    const harness = setup();

    await expect(
      reconcileInstantChannelAttemptWithAudit({ DB: harness.db } as never, input()),
    ).resolves.toMatchObject({ ok: true, replayed: false, outcome: "sent" });
    expect(
      harness.sqlite.prepare(`
        SELECT status, webhook_status, sent_at, payload_snapshot_json
        FROM delivery_attempt WHERE id = 'instant-channel-attempt-1'
      `).get(),
    ).toMatchObject({
      status: "sent",
      webhook_status: "delivered",
      sent_at: "2026-07-15T18:01:00.000Z",
    });
    expect(
      harness.sqlite.prepare("SELECT action_name, status FROM agent_action_audit").get(),
    ).toMatchObject({ action_name: fixture.actionName, status: "succeeded" });
  });

  it("makes only provider-confirmed rejection retryable and rejects wrong-channel evidence", async () => {
    const harness = setup();

    await expect(
      reconcileInstantChannelAttemptWithAudit(
        { DB: harness.db } as never,
        input({
          outcome: "failed",
          classification: fixture.failedClassification,
        }),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "failed" });
    await expect(
      listRetryableInstantAttempts(
        { DB: harness.db } as never,
        {
          since: "2026-07-14T00:00:00.000Z",
          stalePreDispatchBefore: "2026-07-15T17:59:00.000Z",
          limit: 10,
        },
      ),
    ).resolves.toMatchObject([{ id: "instant-channel-attempt-1" }]);

    const wrongChannel = fixture.channel === "slack" ? "whatsapp" : "slack";
    await expect(
      reconcileInstantChannelAttemptWithAudit(
        { DB: harness.db } as never,
        input({
          channel: wrongChannel,
          idempotencyKey: `ops-instant-${wrongChannel}-reconcile:22222222-2222-4222-8222-222222222222`,
        }),
      ),
    ).resolves.toMatchObject({ ok: false });
  });

  it("lists ambiguous attempts but excludes them from automatic retry", async () => {
    const harness = setup();

    await expect(
      listOutstandingInstantProviderUnknownAttempts({ DB: harness.db } as never, { limit: 10 }),
    ).resolves.toMatchObject([{ id: "instant-channel-attempt-1", channel: fixture.channel }]);
    await expect(
      listRetryableInstantAttempts(
        { DB: harness.db } as never,
        {
          since: "2026-07-14T00:00:00.000Z",
          stalePreDispatchBefore: "2026-07-15T18:00:00.000Z",
          limit: 10,
        },
      ),
    ).resolves.toEqual([]);
  });

  it("rejects operator reconciliation while the provider dispatch window is still open", async () => {
    const harness = setup();
    const freshUpdatedAt = new Date().toISOString();
    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'pending',
          webhook_status = 'provider_unknown',
          provider_status_last_seen_at = NULL,
          updated_at = ?
      WHERE id = 'instant-channel-attempt-1'
    `).run(freshUpdatedAt);

    await expect(
      listOutstandingInstantProviderUnknownAttempts({ DB: harness.db } as never, { limit: 10 }),
    ).resolves.toEqual([]);
    await expect(
      reconcileInstantChannelAttemptWithAudit(
        { DB: harness.db } as never,
        input({ expectedUpdatedAt: freshUpdatedAt }),
      ),
    ).resolves.toMatchObject({ ok: false, reason: "stale" });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 0 });

    const settledUpdatedAt = new Date(Date.now() - 61_000).toISOString();
    harness.sqlite.prepare(`
      UPDATE delivery_attempt SET updated_at = ? WHERE id = 'instant-channel-attempt-1'
    `).run(settledUpdatedAt);

    await expect(
      listOutstandingInstantProviderUnknownAttempts({ DB: harness.db } as never, { limit: 10 }),
    ).resolves.toMatchObject([{ id: "instant-channel-attempt-1", channel: fixture.channel }]);
    await expect(
      reconcileInstantChannelAttemptWithAudit(
        { DB: harness.db } as never,
        input({ expectedUpdatedAt: settledUpdatedAt }),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "sent" });
  });

  it("fails closed on unmarked legacy failures until audited evidence makes retry safe", async () => {
    const harness = setup();
    harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane,
        channel, provider, status, webhook_status, target_value,
        provider_status_last_seen_at, event_ids_json, payload_snapshot_json,
        idempotency_key, error_message, failed_at, created_at, updated_at
      ) VALUES (
        'legacy-unclassified-1', 'customer-1', 'watch-1', NULL, ?,
        'customer', ?, ?, 'failed', 'failed', ?,
        '2026-07-14T18:00:30.000Z', '["event-1"]',
        '{"kind":"instant_alert"}', ?,
        'Legacy failure predates durable provider-boundary classification.',
        '2026-07-14T18:00:30.000Z',
        '2026-07-14T18:00:00.000Z', '2026-07-14T18:00:30.000Z'
      )
    `).run(
      `${fixture.channel}-target-legacy`,
      fixture.channel,
      fixture.provider,
      fixture.targetValue,
      `instant:watch-1:customer:${fixture.channel}:${fixture.targetValue}:batch-legacy`,
    );

    await expect(
      listOutstandingInstantProviderUnknownAttempts({ DB: harness.db } as never, { limit: 10 }),
    ).resolves.toMatchObject([
      { id: "legacy-unclassified-1", channel: fixture.channel },
      { id: "instant-channel-attempt-1", channel: fixture.channel },
    ]);
    await expect(
      listRetryableInstantAttempts(
        { DB: harness.db } as never,
        {
          since: "2026-07-14T00:00:00.000Z",
          stalePreDispatchBefore: "2026-07-15T18:00:00.000Z",
          limit: 10,
        },
      ),
    ).resolves.toEqual([]);

    await expect(
      reconcileInstantChannelAttemptWithAudit(
        { DB: harness.db } as never,
        input({
          attemptId: "legacy-unclassified-1",
          expectedUpdatedAt: "2026-07-14T18:00:30.000Z",
          outcome: "failed",
          classification: fixture.failedClassification,
          idempotencyKey: `ops-instant-${fixture.channel}-reconcile:44444444-4444-4444-8444-444444444444`,
        }),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "failed" });
    await expect(
      listRetryableInstantAttempts(
        { DB: harness.db } as never,
        {
          since: "2026-07-14T00:00:00.000Z",
          stalePreDispatchBefore: "2026-07-15T18:00:00.000Z",
          limit: 10,
        },
      ),
    ).resolves.toMatchObject([{ id: "legacy-unclassified-1" }]);
  });
});
