import { getDomain } from "tldts";
import { z } from "zod";

import { normaliseName } from "./types";

type ResolutionVia = "wikidata" | "slug" | "unresolved";

export interface Resolution {
  domain: string | null;
  via: ResolutionVia;
  live: boolean;
}

export interface ResolverEnv {
  kv?: KVNamespace;
  fetchImpl?: typeof fetch;
}

const CACHE_PREFIX = "resolve:";
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const FETCH_TIMEOUT_MS = 8_000;

const WikidataSearch = z.object({
  search: z.array(z.object({ id: z.string() })).optional(),
});

const WikidataEntities = z.object({
  entities: z.record(
    z.string(),
    z.object({
      claims: z
        .record(
          z.string(),
          z.array(
            z.object({
              mainsnak: z.object({
                datavalue: z.object({ value: z.unknown() }).optional(),
              }),
            }),
          ),
        )
        .optional(),
    }),
  ),
});

const CachedResolution = z.object({
  domain: z.string().nullable(),
  via: z.enum(["wikidata", "slug", "unresolved"]),
  live: z.boolean(),
});

export function slugFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function wikidataWebsite(name: string, fetchImpl: typeof fetch): Promise<string | null> {
  const searchRes = await fetchImpl(
    `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=3`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  ).catch(() => null);
  if (!searchRes?.ok) return null;
  const search = WikidataSearch.safeParse(await searchRes.json());
  const qid = search.success ? search.data.search?.[0]?.id : undefined;
  if (!qid) return null;
  const entityRes = await fetchImpl(
    `${WIKIDATA_API}?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=claims&format=json`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  ).catch(() => null);
  if (!entityRes?.ok) return null;
  const entities = WikidataEntities.safeParse(await entityRes.json());
  if (!entities.success) return null;
  for (const claim of entities.data.entities[qid]?.claims?.P856 ?? []) {
    const value = claim.mainsnak.datavalue?.value;
    if (typeof value !== "string") continue;
    const domain = getDomain(value);
    if (domain) return domain;
  }
  return null;
}

function organisationNamesFromJsonLd(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("Organization") && typeof record.name === "string") {
      names.push(record.name);
    }
    for (const value of Object.values(record)) {
      if (typeof value === "object" && value !== null) walk(value);
    }
  };
  walk(parsed);
  return names;
}

async function pageSiteNames(res: Response): Promise<string[]> {
  const ogNames: string[] = [];
  const ldJsonChunks: string[] = [];
  let ldJsonBuf = "";
  await new HTMLRewriter()
    .on('meta[property="og:site_name"]', {
      element(el) {
        const content = el.getAttribute("content");
        if (content) ogNames.push(content.trim());
      },
    })
    .on('script[type="application/ld+json"]', {
      text(node) {
        ldJsonBuf += node.text;
        if (node.lastInTextNode && ldJsonBuf.trim()) {
          ldJsonChunks.push(ldJsonBuf);
          ldJsonBuf = "";
        }
      },
    })
    .transform(res)
    .text();
  const names = [...ogNames];
  for (const chunk of ldJsonChunks) names.push(...organisationNamesFromJsonLd(chunk));
  return names;
}

async function slugGuess(name: string, fetchImpl: typeof fetch): Promise<Resolution> {
  const slug = slugFor(name);
  if (slug.length < 2) return { domain: null, via: "unresolved", live: false };
  const res = await fetchImpl(`https://${slug}.com/`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) return { domain: null, via: "unresolved", live: false };
  const wanted = normaliseName(name);
  const names = await pageSiteNames(res).catch(() => []);
  if (names.some((found) => normaliseName(found) === wanted)) {
    return { domain: `${slug}.com`, via: "slug", live: true };
  }
  return { domain: null, via: "unresolved", live: true };
}

export async function homepageLive(domain: string, fetchImpl: typeof fetch): Promise<boolean> {
  const res = await fetchImpl(`https://${domain}/`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null);
  return res !== null && res.status < 400;
}

export async function resolveCandidateDomain(
  name: string,
  env: ResolverEnv = {},
): Promise<Resolution> {
  const fetchImpl = env.fetchImpl ?? fetch;
  const cacheKey = `${CACHE_PREFIX}${normaliseName(name)}`;
  if (env.kv) {
    const cached = CachedResolution.safeParse(await env.kv.get(cacheKey, { type: "json" }));
    if (cached.success) return cached.data;
  }
  const wikidataDomain = await wikidataWebsite(name, fetchImpl);
  const resolution: Resolution = wikidataDomain
    ? { domain: wikidataDomain, via: "wikidata", live: await homepageLive(wikidataDomain, fetchImpl) }
    : await slugGuess(name, fetchImpl);
  if (env.kv) {
    await env.kv
      .put(cacheKey, JSON.stringify(resolution), { expirationTtl: CACHE_TTL_SECONDS })
      .catch(() => undefined);
  }
  return resolution;
}
