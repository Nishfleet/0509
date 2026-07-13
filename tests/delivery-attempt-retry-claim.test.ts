import { afterEach, describe, expect, it } from "vitest";

import { updateDeliveryAttemptResult } from "~/lib/data.server";
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
      updateDeliveryAttemptResult({ DB: harness.db } as never, "attempt-1", claim),
    ).resolves.toBe(true);
    await expect(
      updateDeliveryAttemptResult({ DB: harness.db } as never, "attempt-1", claim),
    ).resolves.toBe(false);

    expect(
      harness.sqlite
        .prepare("SELECT status, webhook_status, failed_at FROM delivery_attempt WHERE id = ?")
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
      updateDeliveryAttemptResult({ DB: harness.db } as never, "attempt-stale", claim),
    ).resolves.toBe(true);
    await expect(
      updateDeliveryAttemptResult({ DB: harness.db } as never, "attempt-stale", claim),
    ).resolves.toBe(false);

    expect(
      harness.sqlite
        .prepare("SELECT status, webhook_status, updated_at FROM delivery_attempt WHERE id = ?")
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
        { ...attempt, updatedAt: new Date(now - DELIVERY_PRE_DISPATCH_LEASE_MS + 1).toISOString() },
        now,
      ),
    ).toBe(false);
    expect(
      isStalePreDispatchAttempt({ ...attempt, webhookStatus: "provider_unknown" }, now),
    ).toBe(false);
    expect(isStalePreDispatchAttempt({ ...attempt, status: "sent" }, now)).toBe(false);
    expect(isStalePreDispatchAttempt({ ...attempt, updatedAt: "not-a-date" }, now)).toBe(false);
  });
});
