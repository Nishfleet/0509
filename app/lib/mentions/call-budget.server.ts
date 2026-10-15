import { env } from "cloudflare:workers";

import { JevUnavailableError } from "../jev/client.server";

const MENTION_CALLS_PER_BRAND_PER_DAY = 72;

export async function withMentionCall<T>(entityId: string, ask: () => Promise<T>): Promise<T> {
  const day = new Date().toISOString().slice(0, 10);
  const id = env.BROWSER_BUDGET.idFromName(`mention-calls:${entityId}:${day}`);
  const allowed = await env.BROWSER_BUDGET.get(id).take(MENTION_CALLS_PER_BRAND_PER_DAY);
  if (!allowed) {
    console.error(JSON.stringify({ event: "mentions.allowance_used", entityId, day }));
    throw new JevUnavailableError("the daily mention allowance for this brand is used");
  }
  return ask();
}
