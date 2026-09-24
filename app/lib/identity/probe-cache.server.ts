import { env } from "cloudflare:workers";
import type { z } from "zod";

import type { Subject } from "./normalise";

export const PROBE_TTL_SECONDS = 86_400;

export type ProbeName =
  | "homepage"
  | "manifest"
  | "icon"
  | "wikidata-search"
  | "wikidata-claims"
  | "browser";

export function probeKey(subject: Subject, probe: ProbeName): string {
  return `identity:${subject.registrable}:${probe}`;
}

export async function readThrough<T>(
  key: string,
  schema: z.ZodType<T>,
  ttlSeconds: number,
  run: () => Promise<T>,
): Promise<T> {
  const hit = await env.IDENTITY_CACHE.get(key, "json");
  const parsed = hit === null ? null : schema.safeParse(hit);
  if (parsed?.success) {
    return parsed.data;
  }

  const value = await run();
  await env.IDENTITY_CACHE.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  return value;
}

export async function cachedProbe<T>(
  subject: Subject,
  probe: ProbeName,
  schema: z.ZodType<T>,
  run: () => Promise<T>,
): Promise<T> {
  return readThrough(probeKey(subject, probe), schema, PROBE_TTL_SECONDS, run);
}
