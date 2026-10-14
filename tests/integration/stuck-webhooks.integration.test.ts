import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { checkStuckWebhooks } from "../../app/lib/billing/stuck-webhooks.server";

const NOW = new Date("2026-10-14T12:00:00Z");

async function store(id: string, receivedAt: string, processedAt: string | null): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO dodo_webhook_event (id, event_type, payload_json, received_at, processed_at) VALUES (?, 'subscription.active', '{}', ?, ?)",
  )
    .bind(id, receivedAt, processedAt)
    .run();
}

describe("checkStuckWebhooks", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM dodo_webhook_event").run();
  });

  it("stays quiet when every event is processed or still inside Dodo's retry window", async () => {
    await store("evt_done", "2026-10-12T12:00:00Z", "2026-10-12T12:00:01Z");
    await store("evt_fresh", "2026-10-14T06:00:00Z", null);

    await expect(checkStuckWebhooks(NOW)).resolves.toBeUndefined();
  });

  it("raises when an event is still unprocessed a day after it arrived", async () => {
    await store("evt_stuck", "2026-10-13T06:00:00Z", null);

    await expect(checkStuckWebhooks(NOW)).rejects.toThrow("Dodo webhook events still unprocessed after 24 hours");
  });

  it("stops raising once the event is older than the alert window", async () => {
    await store("evt_old", "2026-10-09T06:00:00Z", null);

    await expect(checkStuckWebhooks(NOW)).resolves.toBeUndefined();
  });
});
