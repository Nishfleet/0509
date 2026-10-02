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
  | "browser"
  | "youtube-channel"
  | "youtube-profile"
  | "instagram-profile";

function cacheSubject(subject: Subject): string {
  if (subject.kind !== "domain" || subject.url === null) return subject.registrable;
  const host = new URL(subject.url).hostname;
  return host.startsWith("www.") ? host.slice("www.".length) : host;
}

export function probeKey(subject: Subject, probe: ProbeName): string {
  return `identity:${cacheSubject(subject)}:${probe}`;
}

export interface ReadThroughOptions<T> {
  key: string;
  schema: z.ZodType<T>;
  ttlSeconds: number;
  run: () => Promise<T>;
}

export interface ProbeLoader<T> {
  schema: z.ZodType<T>;
  run: () => Promise<T>;
}

function cacheUnavailable(action: "read" | "write"): () => null {
  return () => {
    console.error(JSON.stringify({ event: "identity.cache_unavailable", action }));
    return null;
  };
}

export async function readThrough<T>({ key, schema, ttlSeconds, run }: ReadThroughOptions<T>): Promise<T> {
  const hit = await env.IDENTITY_CACHE.get(key, "json").catch(cacheUnavailable("read"));
  const parsed = hit === null ? null : schema.safeParse(hit);
  if (parsed?.success) {
    return parsed.data;
  }

  const value = await run();
  await env.IDENTITY_CACHE.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds }).catch(
    cacheUnavailable("write"),
  );
  return value;
}

export async function cachedProbe<T>(subject: Subject, probe: ProbeName, { schema, run }: ProbeLoader<T>): Promise<T> {
  return readThrough({ key: probeKey(subject, probe), schema, ttlSeconds: PROBE_TTL_SECONDS, run });
}
