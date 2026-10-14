import { env } from "cloudflare:workers";
import { z } from "zod";

import { sha256Hex } from "./sha256";

const RECIPIENT_CAP = 3;
export const RECIPIENT_CAPPED = "That address has had several emails from us today. Try again tomorrow.";
const WINDOW_SECONDS = 86_400;

const usage = z.object({ count: z.number().int().nonnegative(), expiresAt: z.number().int() });

function unavailable(error: unknown): null {
  console.warn(JSON.stringify({ event: "recipient_cap.kv_unavailable", error: String(error) }));
  return null;
}

async function readUsage(key: string, nowSeconds: number) {
  const raw = await env.IDENTITY_CACHE.get(key, "json").catch(unavailable);
  const parsed = usage.safeParse(raw);
  return parsed.success && parsed.data.expiresAt > nowSeconds ? parsed.data : null;
}

export async function takeRecipientSlot(address: string, now = new Date()): Promise<boolean> {
  const key = `recipient-cap:${await sha256Hex(address)}`;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const current = await readUsage(key, nowSeconds);
  if (current !== null && current.count >= RECIPIENT_CAP) return false;
  const next = { count: (current?.count ?? 0) + 1, expiresAt: current?.expiresAt ?? nowSeconds + WINDOW_SECONDS };
  await env.IDENTITY_CACHE.put(key, JSON.stringify(next), { expiration: next.expiresAt }).catch(unavailable);
  return true;
}
