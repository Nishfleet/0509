import { env } from "cloudflare:workers";
import { z } from "zod";

import { sha256Hex } from "../sha256";
import type { ReadUrlResult } from "./transport.server";

type SharedRead = Extract<ReadUrlResult, { ok: true }>;

const SHARED_READ_PREFIX = "shared-read:";

const SHARED_READ_SECONDS = 36 * 60 * 60;

const sharedRead = z.object({
  ok: z.literal(true),
  html: z.string(),
  transport: z.enum(["fetch", "browser"]),
  status: z.number(),
  ms: z.number(),
});

async function keyFor(url: string, day: string): Promise<string> {
  return `${SHARED_READ_PREFIX}${day}:${await sha256Hex(url)}`;
}

export async function readSharedPage(url: string, day: string): Promise<SharedRead | null> {
  const stored = await env.IDENTITY_CACHE.get(await keyFor(url, day));
  if (stored === null) return null;
  const parsed = sharedRead.safeParse(JSON.parse(stored));
  return parsed.success ? { ...parsed.data, escalated: false } : null;
}

export async function keepSharedPage(url: string, day: string, read: SharedRead): Promise<void> {
  const { html, transport, status, ms } = read;
  await env.IDENTITY_CACHE.put(await keyFor(url, day), JSON.stringify({ ok: true, html, transport, status, ms }), {
    expirationTtl: SHARED_READ_SECONDS,
  });
}
