import { fetchOutbound } from "./fetch/outbound.server";

export async function postToSlack(webhookUrl: string, text: string): Promise<boolean> {
  const response = await fetchOutbound(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    schemes: ["https:"],
  });
  await response.body?.cancel();
  return response.ok;
}
