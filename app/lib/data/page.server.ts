import { env } from "cloudflare:workers";
import { z } from "zod";

export interface NewPage {
  id: string;
  entityId: string;
  url: string;
  role: "home" | "pricing";
  discoveredAt: string;
}

export interface JudgedPage {
  id: string;
  entityId: string;
  url: string;
  title: string;
  role: "home" | "pricing" | "product" | "blog" | "careers" | "legal" | "other";
  roleDecidedForHash: string;
  discoveredAt: string;
}

const INSERT_PAGE = `INSERT INTO page (id, entity_id, url, role, discovered_at)
VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT (entity_id, url) DO NOTHING`;

const UPSERT_JUDGED_PAGE = `INSERT INTO page (id, entity_id, url, title, role, role_decided_for_hash, discovered_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
ON CONFLICT (entity_id, url) DO UPDATE SET
  title = excluded.title,
  role = excluded.role,
  role_decided_for_hash = excluded.role_decided_for_hash`;

const SELECT_JUDGED_HASHES =
  "SELECT url, role_decided_for_hash FROM page WHERE entity_id = ?1 AND role_decided_for_hash IS NOT NULL";

const pageHashes = z.array(z.object({ url: z.string(), role_decided_for_hash: z.string() }));

export async function insertPages(rows: readonly NewPage[]): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.batch(
    rows.map((row) => env.DB.prepare(INSERT_PAGE).bind(row.id, row.entityId, row.url, row.role, row.discoveredAt)),
  );
}

export async function upsertJudgedPages(rows: readonly JudgedPage[]): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(UPSERT_JUDGED_PAGE).bind(
        row.id,
        row.entityId,
        row.url,
        row.title,
        row.role,
        row.roleDecidedForHash,
        row.discoveredAt,
      ),
    ),
  );
}

export async function readPageHashes(entityId: string): Promise<ReadonlyMap<string, string>> {
  const rows = await env.DB.prepare(SELECT_JUDGED_HASHES).bind(entityId).all();
  const parsed = pageHashes.parse(rows.results);
  return new Map(parsed.map((row) => [row.url, row.role_decided_for_hash]));
}

const SELECT_JUDGED_PRICING =
  "SELECT url FROM page WHERE entity_id = ?1 AND role = 'pricing' AND role_decided_for_hash IS NOT NULL ORDER BY url LIMIT 1";

export async function readJudgedPricingUrl(entityId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_JUDGED_PRICING).bind(entityId).first<{ url: string }>();
  return row?.url ?? null;
}

const COMPETITORS_TO_CLASSIFY = `SELECT e.id AS entity_id, e.workspace_id AS workspace_id, e.domain AS domain,
       COALESCE(NULLIF(e.name, ''), e.domain) AS name, p.id AS page_id, p.url AS url
FROM entity e
JOIN page p ON p.entity_id = e.id AND p.role = 'home'
WHERE e.role = 'competitor' AND e.state = 'on'
  AND (
    NOT EXISTS (SELECT 1 FROM page j WHERE j.entity_id = e.id AND j.role_decided_for_hash IS NOT NULL)
    OR CASE WHEN json_valid(e.identity_json)
         THEN json_extract(e.identity_json, '$.socialsReadAt') IS NULL AND coalesce(json_array_length(e.identity_json, '$.socials'), 0) = 0
         ELSE 0 END
  )
  AND (p.deferred_at IS NULL OR p.deferred_at < ?2)
ORDER BY random()
LIMIT ?1`;

const competitorRows = z.array(
  z.object({
    entity_id: z.string(),
    workspace_id: z.string(),
    domain: z.string(),
    name: z.string(),
    page_id: z.string(),
    url: z.string(),
  }),
);

export interface CompetitorToClassify {
  entityId: string;
  workspaceId: string;
  domain: string;
  name: string;
  homePageId: string;
  homepageUrl: string;
}

const UNREADABLE_SITE_BACKOFF_MS = 3 * 86_400_000;

export async function readCompetitorsToClassify(limit: number, now: string): Promise<readonly CompetitorToClassify[]> {
  const retryAfter = new Date(Date.parse(now) - UNREADABLE_SITE_BACKOFF_MS).toISOString();
  const rows = await env.DB.prepare(COMPETITORS_TO_CLASSIFY).bind(limit, retryAfter).all();
  return competitorRows.parse(rows.results).map((row) => ({
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    domain: row.domain,
    name: row.name,
    homePageId: row.page_id,
    homepageUrl: row.url,
  }));
}

const PRICING_PAGES_WATCHED = 3;

const RANKED_PRICING_PAGES = `SELECT p.entity_id AS entity_id, p.url AS url,
       ROW_NUMBER() OVER (PARTITION BY p.entity_id ORDER BY p.rowid) AS position
FROM page p
JOIN entity e ON e.id = p.entity_id AND e.state = 'on'
WHERE p.role = 'pricing' AND p.role_decided_for_hash IS NOT NULL`;

const WANTED_PRICING_WATCH = `EXISTS (
  SELECT 1 FROM (${RANKED_PRICING_PAGES}) r
  WHERE r.position <= ?2 AND r.entity_id = watch.entity_id AND r.url = watch.target_key
)`;

const STOP_UNWANTED_PRICING_WATCHES = `UPDATE watch SET is_active = 0
WHERE source_id = ?1 AND is_active = 1
  AND entity_id IN (SELECT id FROM entity WHERE state = 'on' AND role = 'competitor')
  AND EXISTS (
    SELECT 1 FROM page p
    WHERE p.entity_id = watch.entity_id AND p.url = watch.target_key
      AND p.role IS NOT NULL AND p.role <> 'home' AND p.role_decided_for_hash IS NOT NULL
      AND EXISTS (SELECT 1 FROM page h WHERE h.entity_id = p.entity_id AND h.role = 'home' AND h.url <> p.url)
  )
  AND NOT ${WANTED_PRICING_WATCH}`;

const RESUME_WANTED_PRICING_WATCHES = `UPDATE watch SET is_active = 1
WHERE source_id = ?1 AND is_active = 0
  AND entity_id IN (SELECT id FROM entity WHERE role = 'competitor')
  AND ${WANTED_PRICING_WATCH}`;

export async function syncPricingWatches(sourceId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(STOP_UNWANTED_PRICING_WATCHES).bind(sourceId, PRICING_PAGES_WATCHED),
    env.DB.prepare(RESUME_WANTED_PRICING_WATCHES).bind(sourceId, PRICING_PAGES_WATCHED),
  ]);
}

const UNWATCHED_PRICING_PAGES = `SELECT r.entity_id AS entity_id, r.url AS url
FROM (${RANKED_PRICING_PAGES}) r
WHERE r.position <= ?2
  AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.entity_id = r.entity_id AND w.source_id = ?1 AND w.target_key = r.url)
ORDER BY r.entity_id, r.url`;

const pricingPageRows = z.array(z.object({ entity_id: z.string(), url: z.string() }));

export async function readUnwatchedPricingPages(sourceId: string): Promise<{ entityId: string; url: string }[]> {
  const rows = await env.DB.prepare(UNWATCHED_PRICING_PAGES).bind(sourceId, PRICING_PAGES_WATCHED).all();
  return pricingPageRows.parse(rows.results).map((row) => ({ entityId: row.entity_id, url: row.url }));
}

const INSERT_ALTERNATE_PAGE = `INSERT INTO page (id, entity_id, url, role, transport, transport_tested_at, discovered_at)
VALUES (?1, ?2, ?3, 'blog', ?4, ?5, ?5)
ON CONFLICT (entity_id, url) DO NOTHING`;

export async function insertAlternatePage(input: {
  entityId: string;
  url: string;
  transport: "fetch" | "browser";
  at: string;
}): Promise<void> {
  const { entityId, url, transport, at } = input;
  await env.DB.prepare(INSERT_ALTERNATE_PAGE).bind(crypto.randomUUID(), entityId, url, transport, at).run();
}

const RECORD_TRANSPORT =
  "UPDATE page SET transport = ?2, transport_reason = ?3, transport_tested_at = ?4, deferred_at = NULL WHERE id = ?1";

const MARK_DEFERRED = "UPDATE page SET deferred_at = ?2 WHERE id = ?1";

export async function recordPageTransport(input: {
  pageId: string;
  transport: "fetch" | "browser";
  reason: string | null;
  testedAt: string;
}): Promise<void> {
  await env.DB.prepare(RECORD_TRANSPORT).bind(input.pageId, input.transport, input.reason, input.testedAt).run();
}

export async function markPageDeferred(pageId: string, at: string): Promise<void> {
  await env.DB.prepare(MARK_DEFERRED).bind(pageId, at).run();
}

export interface OwnSitePage {
  workspaceId: string;
  entityId: string;
  pageId: string;
  url: string;
}

const ENTITIES_WITHOUT_HOME = `SELECT e.id AS id, e.domain AS domain, CASE WHEN json_valid(e.identity_json) THEN json_extract(e.identity_json, '$.url') END AS url,
       json_valid(e.identity_json) AS identity_valid
FROM entity e
WHERE e.state = 'on'
  AND NOT EXISTS (SELECT 1 FROM page p WHERE p.entity_id = e.id AND p.role = 'home')
ORDER BY e.id`;

const OWN_SITE_PAGES = `SELECT e.workspace_id AS workspace_id,
       e.id AS entity_id,
       p.id AS page_id,
       p.url AS url
FROM entity e
JOIN page p ON p.entity_id = e.id AND p.role = 'home'
WHERE e.role = 'self' AND e.state = 'on'
ORDER BY e.workspace_id, p.id`;

const entityRows = z.array(
  z.object({
    id: z.string(),
    domain: z.string(),
    url: z.string().nullable(),
    identity_valid: z.number().transform((flag) => flag === 1),
  }),
);

export type EntityWithoutHomePage = z.infer<typeof entityRows>[number];

const ownSiteRows = z.array(
  z.object({
    workspace_id: z.string(),
    entity_id: z.string(),
    page_id: z.string(),
    url: z.string(),
  }),
);

export async function readEntitiesWithoutHomePage(): Promise<readonly EntityWithoutHomePage[]> {
  const rows = await env.DB.prepare(ENTITIES_WITHOUT_HOME).all();
  return entityRows.parse(rows.results);
}

export async function readOwnSitePages(): Promise<OwnSitePage[]> {
  const rows = await env.DB.prepare(OWN_SITE_PAGES).all();
  return ownSiteRows.parse(rows.results).map((row) => ({
    workspaceId: row.workspace_id,
    entityId: row.entity_id,
    pageId: row.page_id,
    url: row.url,
  }));
}
