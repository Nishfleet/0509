import { env } from "cloudflare:test";

export async function clearRecipientCap(): Promise<void> {
  const { keys } = await env.IDENTITY_CACHE.list({ prefix: "recipient-cap:" });
  await Promise.all(keys.map((key) => env.IDENTITY_CACHE.delete(key.name)));
}
