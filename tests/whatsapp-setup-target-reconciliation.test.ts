import { afterEach, describe, expect, it } from "vitest";

import { reconcileWhatsAppSetupTargetFromAttempt } from "~/lib/data/delivery-records-targets.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

const harnesses: Array<ReturnType<typeof createSqliteD1>> = [];

function openHarness() {
  const harness = createSqliteD1();
  harnesses.push(harness);
  harness.sqlite.exec(`
    CREATE TABLE delivery_target (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      channel TEXT NOT NULL,
      target_value TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      is_validated INTEGER NOT NULL,
      is_opted_in INTEGER NOT NULL,
      opt_in_source TEXT,
      opted_in_at TEXT,
      is_paused INTEGER NOT NULL,
      paused_at TEXT,
      opted_out_at TEXT,
      template_eligible INTEGER NOT NULL,
      last_successful_delivery_at TEXT,
      last_successful_attempt_id TEXT,
      provider_identifier TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO delivery_target VALUES (
      'target-1', 'user-1', NULL, 'whatsapp', '919876543210',
      'pending', 0, 1, 'manual_whatsapp_setup', '2026-07-16T09:00:00.000Z',
      0, NULL, NULL, 0, NULL, NULL, NULL,
      '{"validationGeneration":"initial","validationWebhookStatus":"pending"}',
      '2026-07-16T09:00:00.000Z', '2026-07-16T09:00:00.000Z'
    );
  `);
  return harness;
}

function snapshot(harness: ReturnType<typeof createSqliteD1>) {
  const row = harness.sqlite
    .prepare("SELECT * FROM delivery_target WHERE id = 'target-1'")
    .get() as Record<string, unknown>;
  return {
    ...row,
    metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
  };
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("WhatsApp setup target reconciliation", () => {
  it("recovers a lost acceptance link and validates from the signed terminal attempt", async () => {
    const harness = openHarness();
    const env = { DB: harness.db } as never;
    const base = {
      userId: "user-1",
      targetId: "target-1",
      attemptId: "attempt-1",
      providerMessageId: "wamid.accepted-1",
      validationGeneration: "initial",
      providerStatusLastSeenAt: "2026-07-16T09:01:00.000Z",
      errorMessage: null,
    };

    await expect(
      reconcileWhatsAppSetupTargetFromAttempt(env, {
        ...base,
        webhookStatus: "pending",
      }),
    ).resolves.toMatchObject({
      providerIdentifier: "wamid.accepted-1",
      metadata: expect.objectContaining({
        validationProviderMessageId: "wamid.accepted-1",
      }),
    });

    // Simulate an overlapping stale pending writer dropping the local link after
    // the provider accepted the message but before the signed webhook arrives.
    harness.sqlite
      .prepare(
        `
      UPDATE delivery_target
      SET provider_identifier = NULL,
          metadata_json = '{"validationGeneration":"initial","validationWebhookStatus":"pending"}',
          updated_at = '2026-07-16T09:01:30.000Z'
      WHERE id = 'target-1'
    `,
      )
      .run();

    await expect(
      reconcileWhatsAppSetupTargetFromAttempt(env, {
        ...base,
        webhookStatus: "delivered",
        providerStatusLastSeenAt: "2026-07-16T09:02:00.000Z",
      }),
    ).resolves.toMatchObject({
      validationStatus: "validated",
      isValidated: true,
      templateEligible: true,
      providerIdentifier: "wamid.accepted-1",
      metadata: expect.objectContaining({
        validationAttemptId: "attempt-1",
        validationProviderMessageId: "wamid.accepted-1",
        validationWebhookStatus: "delivered",
      }),
    });

    expect(snapshot(harness)).toMatchObject({
      validation_status: "validated",
      is_validated: 1,
      template_eligible: 1,
      provider_identifier: "wamid.accepted-1",
      last_successful_attempt_id: "attempt-1",
    });
  });

  it("refuses an older validation generation and an incompatible provider id", async () => {
    const harness = openHarness();
    const env = { DB: harness.db } as never;
    harness.sqlite
      .prepare(
        `
      UPDATE delivery_target
      SET provider_identifier = 'wamid.current',
          metadata_json = '{"validationGeneration":"reconnect:2026-07-16","validationProviderMessageId":"wamid.current","validationWebhookStatus":"pending"}'
      WHERE id = 'target-1'
    `,
      )
      .run();

    await reconcileWhatsAppSetupTargetFromAttempt(env, {
      userId: "user-1",
      targetId: "target-1",
      attemptId: "attempt-old",
      providerMessageId: "wamid.old",
      validationGeneration: "initial",
      webhookStatus: "delivered",
      providerStatusLastSeenAt: "2026-07-16T09:02:00.000Z",
      errorMessage: null,
    });

    expect(snapshot(harness)).toMatchObject({
      validation_status: "pending",
      provider_identifier: "wamid.current",
      metadata: {
        validationGeneration: "reconnect:2026-07-16",
        validationProviderMessageId: "wamid.current",
        validationWebhookStatus: "pending",
      },
    });
  });

  it("binds a provider-accepted retry after the prior setup message failed", async () => {
    const harness = openHarness();
    const env = { DB: harness.db } as never;
    harness.sqlite
      .prepare(
        `
      UPDATE delivery_target
      SET validation_status = 'invalid',
          is_validated = 0,
          template_eligible = 0,
          provider_identifier = 'wamid.failed-1',
          metadata_json = '{"validationGeneration":"initial","validationAttemptId":"attempt-1","validationProviderMessageId":"wamid.failed-1","validationWebhookStatus":"failed","validationStatusLastSeenAt":"2026-07-16T09:02:00.000Z"}',
          updated_at = '2026-07-16T09:02:00.000Z'
      WHERE id = 'target-1'
    `,
      )
      .run();

    await expect(
      reconcileWhatsAppSetupTargetFromAttempt(env, {
        userId: "user-1",
        targetId: "target-1",
        attemptId: "attempt-1",
        providerMessageId: "wamid.retry-2",
        validationGeneration: "initial",
        webhookStatus: "pending",
        providerStatusLastSeenAt: "2026-07-16T09:03:00.000Z",
        errorMessage: null,
      }),
    ).resolves.toMatchObject({
      validationStatus: "pending",
      providerIdentifier: "wamid.retry-2",
      metadata: expect.objectContaining({
        validationAttemptId: "attempt-1",
        validationProviderMessageId: "wamid.retry-2",
        validationWebhookStatus: "pending",
      }),
    });

    await expect(
      reconcileWhatsAppSetupTargetFromAttempt(env, {
        userId: "user-1",
        targetId: "target-1",
        attemptId: "attempt-1",
        providerMessageId: "wamid.retry-2",
        validationGeneration: "initial",
        webhookStatus: "delivered",
        providerStatusLastSeenAt: "2026-07-16T09:04:00.000Z",
        errorMessage: null,
      }),
    ).resolves.toMatchObject({
      validationStatus: "validated",
      isValidated: true,
      providerIdentifier: "wamid.retry-2",
    });
  });
});
