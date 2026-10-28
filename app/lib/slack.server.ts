import { fetchOutbound } from "./fetch/outbound.server";

export type SlackPost = "sent" | "retry" | "revoked" | "unconfirmed";

const REVOKED_STATUSES = new Set([403, 404, 410]);

export async function postToSlackOutcome(webhookUrl: string, text: string): Promise<SlackPost> {
  try {
    const response = await fetchOutbound(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      schemes: ["https:"],
    });
    await response.body?.cancel();
    if (response.ok) return "sent";
    return REVOKED_STATUSES.has(response.status) ? "revoked" : "retry";
  } catch (failure) {
    const kind = failure instanceof Error ? failure.constructor.name : "unknown";
    console.error(JSON.stringify({ event: "slack.post_failed", kind }));
    return "unconfirmed";
  }
}

export async function postToSlack(webhookUrl: string, text: string): Promise<boolean> {
  return (await postToSlackOutcome(webhookUrl, text)) === "sent";
}
