import { countUnprocessedWebhookEvents } from "../data/dodo_webhook_event.server";

const DODO_RETRY_WINDOW_MS = 36 * 60 * 60 * 1000;
const ALERT_WINDOW_MS = 72 * 60 * 60 * 1000;

export async function checkStuckWebhooks(now: Date): Promise<void> {
  const total = await countUnprocessedWebhookEvents({
    receivedBefore: new Date(now.getTime() - DODO_RETRY_WINDOW_MS).toISOString(),
    receivedSince: new Date(now.getTime() - ALERT_WINDOW_MS).toISOString(),
  });
  if (total > 0) throw new Error("billing: Dodo webhook events still unprocessed after 36 hours");
}
