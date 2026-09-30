import { getDomain } from "tldts";
import { z } from "zod";

import { cappedJson, cappedText, fetchOutbound } from "../fetch/outbound.server";
import { CRAWLER_USER_AGENT } from "../fetch/robots.server";
import { readThrough } from "../identity/probe-cache.server";
import { readPageNames } from "./page-names";

export interface Resolution {
  domain: string | null;
  via: "wikidata" | "slug" | "unresolved";
}

const UNRESOLVED: Resolution = { domain: null, via: "unresolved" };
const CACHE_TTL_SECONDS = 2592000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

const resolutionSchema = z.object({
  domain: z.string().nullable(),
  via: z.enum(["wikidata", "slug", "unresolved"]),
});

const wikidataSearchSchema = z.object({
  search: z.array(z.object({ id: z.string() })),
});

const wikidataEntitiesSchema = z.object({
  entities: z.record(z.string(), z.object({ claims: z.record(z.string(), z.array(z.unknown())) })),
});

const p856ClaimSchema = z.object({
  mainsnak: z.object({ datavalue: z.object({ value: z.string() }) }),
});

function normaliseName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function slugOf(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function logLookupFailure(step: "wikidata" | "slug", failure: string): void {
  console.error(
    JSON.stringify({
      event: "discovery.resolve_failed",
      step,
      error: failure,
    }),
  );
}

async function wikidataGet(url: string): Promise<unknown> {
  try {
    const res = await fetchOutbound(url, {
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      logLookupFailure("wikidata", `status ${String(res.status)}`);
      return null;
    }
    return await cappedJson(res, MAX_JSON_BYTES);
  } catch (error) {
    logLookupFailure("wikidata", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

async function wikidataDomain(name: string): Promise<string | null> {
  const search = wikidataSearchSchema.safeParse(
    await wikidataGet(
      "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=1&search=" +
        encodeURIComponent(name.trim()),
    ),
  );
  const id = search.success ? search.data.search[0]?.id : undefined;
  if (!id) return null;

  const entities = wikidataEntitiesSchema.safeParse(
    await wikidataGet(
      "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=" + encodeURIComponent(id),
    ),
  );
  if (!entities.success) return null;

  const claim = entities.data.entities[id]?.claims.P856?.[0];
  const p856 = p856ClaimSchema.safeParse(claim);
  if (!p856.success) return null;

  return getDomain(p856.data.mainsnak.datavalue.value);
}

async function slugDomain(name: string): Promise<string | null> {
  const slug = slugOf(name);
  if (slug.length === 0) return null;

  try {
    const res = await fetchOutbound(`https://${slug}.com/`, {
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const html = await cappedText(res, MAX_PAGE_BYTES);
    if (html === null) return null;
    const names = await readPageNames(html);
    const target = normaliseName(name);
    if (names.ogSiteName !== null && normaliseName(names.ogSiteName) === target) {
      return `${slug}.com`;
    }
    if (names.ldOrganizationName !== null && normaliseName(names.ldOrganizationName) === target) {
      return `${slug}.com`;
    }
    return null;
  } catch (error) {
    logLookupFailure("slug", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export function resolveKey(name: string): string {
  return `identity:name:${name.trim().toLowerCase()}:resolve`;
}

async function resolveUncached(name: string): Promise<Resolution> {
  const wikidata = await wikidataDomain(name);
  if (wikidata !== null) return { domain: wikidata, via: "wikidata" };
  const slug = await slugDomain(name);
  return slug !== null ? { domain: slug, via: "slug" } : { ...UNRESOLVED };
}

export async function resolveDomain(name: string): Promise<Resolution> {
  return readThrough(resolveKey(name), resolutionSchema, CACHE_TTL_SECONDS, () => resolveUncached(name));
}
