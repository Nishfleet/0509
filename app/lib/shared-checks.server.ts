import { env } from "cloudflare:workers";

import { blankEnvString } from "./env.server";

const STATS_PREFIX = "shared-stats:";

const STATS_SECONDS = 36 * 60 * 60;

export type SharedKind = "page" | "verdict";

export type SharedResult = "hit" | "no_copy" | "no_match" | "read_failed";

export interface SharedChecksSummary {
  enabled: boolean;
  pageHits: number;
  pageMisses: Record<string, number>;
  verdictHits: number;
  verdictMisses: Record<string, number>;
}

export function sharedChecksOn(): boolean {
  return blankEnvString(env.SHARED_RIVAL_CHECKS) === "on";
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export async function noteSharedOutcome(kind: SharedKind, result: SharedResult, at: string): Promise<void> {
  try {
    await env.IDENTITY_CACHE.put(`${STATS_PREFIX}${dayOf(at)}:${kind}:${result}:${crypto.randomUUID()}`, "1", {
      expirationTtl: STATS_SECONDS,
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "site.shared_stats_failed", error: String(error).slice(0, 300) }));
  }
}

async function noteNames(day: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.IDENTITY_CACHE.list({ prefix: `${STATS_PREFIX}${day}:`, ...(cursor ? { cursor } : {}) });
    names.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);
  return names;
}

function tally(names: readonly string[], kind: SharedKind): { hits: number; misses: Record<string, number> } {
  const misses: Record<string, number> = {};
  let hits = 0;
  for (const name of names) {
    const [, , noted, result] = name.split(":");
    if (noted !== kind) continue;
    if (result === "hit") hits += 1;
    else if (result !== undefined) misses[result] = (misses[result] ?? 0) + 1;
  }
  return { hits, misses };
}

export async function summarizeSharedChecks(at: string): Promise<SharedChecksSummary> {
  const names = await noteNames(dayOf(at));
  const page = tally(names, "page");
  const verdict = tally(names, "verdict");
  return {
    enabled: sharedChecksOn(),
    pageHits: page.hits,
    pageMisses: page.misses,
    verdictHits: verdict.hits,
    verdictMisses: verdict.misses,
  };
}

export async function logSharedChecks(at: string): Promise<void> {
  try {
    console.log(JSON.stringify({ event: "site.shared_checks", ...(await summarizeSharedChecks(at)) }));
  } catch (error) {
    console.warn(JSON.stringify({ event: "site.shared_checks_failed", error: String(error).slice(0, 300) }));
  }
}
