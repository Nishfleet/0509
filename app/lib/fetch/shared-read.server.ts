import { env } from "cloudflare:workers";
import { z } from "zod";

import { noteSharedOutcome } from "../shared-checks.server";
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

export interface SharedReadKey {
  url: string;
  sweep: string;
  startWith: "fetch" | "browser";
}

async function keyFor({ url, sweep, startWith }: SharedReadKey): Promise<string> {
  return `${SHARED_READ_PREFIX}${sweep}:${startWith}:${await sha256Hex(url)}`;
}

export async function readSharedPage(key: SharedReadKey): Promise<SharedRead | null> {
  try {
    const stored = await env.IDENTITY_CACHE.get(await keyFor(key));
    const parsed = stored === null ? null : sharedRead.safeParse(JSON.parse(stored));
    noteSharedOutcome("page", parsed?.success === true ? "hit" : "no_copy");
    return parsed?.success === true ? { ...parsed.data, escalated: false } : null;
  } catch (error) {
    console.error(JSON.stringify({ event: "site.shared_read_failed", error: String(error) }));
    noteSharedOutcome("page", "read_failed");
    return null;
  }
}

export async function keepSharedPage(key: SharedReadKey, read: SharedRead): Promise<void> {
  const { html, transport, status, ms } = read;
  await env.IDENTITY_CACHE.put(await keyFor(key), JSON.stringify({ ok: true, html, transport, status, ms }), {
    expirationTtl: SHARED_READ_SECONDS,
  });
}
