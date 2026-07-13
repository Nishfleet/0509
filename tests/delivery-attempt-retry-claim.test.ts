import { afterEach, describe, expect, it } from "vitest";

import { updateDeliveryAttemptResult } from "~/lib/data.server";
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
      webhookStatus: "provider_unknown" as const,
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
      webhook_status: "provider_unknown",
      failed_at: null,
    });
  });
});
