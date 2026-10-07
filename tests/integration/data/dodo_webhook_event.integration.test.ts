import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { markWebhookEventProcessed, recordWebhookEvent } from "../../../app/lib/data/dodo_webhook_event.server";

const NOW = "2026-09-25T00:00:00Z";
const PROCESSED_AT = "2026-09-25T00:05:00Z";
const EVENT_ID = "evt-send-target-row";

const stored = async () =>
  (await env.DB.prepare(
    `SELECT id, event_type, payload_json, received_at, processed_at FROM dodo_webhook_event WHERE id = ?`,
  )
    .bind(EVENT_ID)
    .first<{
      id: string;
      event_type: string;
      payload_json: string;
      received_at: string;
      processed_at: string | null;
    }>()) ?? null;

describe("dodo_webhook_event row readers (0509#7146)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM dodo_webhook_event");
  });

  it("recordWebhookEvent stores the event and reports it pending", async () => {
    expect(
      await recordWebhookEvent({ id: EVENT_ID, eventType: "payment.succeeded", payloadJson: "{}", receivedAt: NOW }),
    ).toBe("pending");

    expect(await stored()).toEqual({
      id: EVENT_ID,
      event_type: "payment.succeeded",
      payload_json: "{}",
      received_at: NOW,
      processed_at: null,
    });
  });

  it("recordWebhookEvent reports processed once the event is marked processed", async () => {
    await recordWebhookEvent({ id: EVENT_ID, eventType: "payment.succeeded", payloadJson: "{}", receivedAt: NOW });
    await markWebhookEventProcessed(EVENT_ID, PROCESSED_AT);

    expect(
      await recordWebhookEvent({ id: EVENT_ID, eventType: "payment.succeeded", payloadJson: "{}", receivedAt: NOW }),
    ).toBe("processed");
    expect((await stored())?.processed_at).toBe(PROCESSED_AT);
  });

  it("recordWebhookEvent keeps the first payload on a duplicate id", async () => {
    await recordWebhookEvent({ id: EVENT_ID, eventType: "payment.succeeded", payloadJson: "{}", receivedAt: NOW });
    await recordWebhookEvent({ id: EVENT_ID, eventType: "payment.failed", payloadJson: '{"x":1}', receivedAt: NOW });

    expect((await stored())?.event_type).toBe("payment.succeeded");
  });
});
