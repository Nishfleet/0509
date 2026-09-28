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
    rows.map((row) =>
      env.DB.prepare(INSERT_PAGE).bind(row.id, row.entityId, row.url, row.role, row.discoveredAt),
    ),
  );
}

export async function upsertJudgedPages(rows: readonly JudgedPage[]): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.batch(
    rows.map((row) =>
      env.DB
        .prepare(UPSERT_JUDGED_PAGE)
        .bind(row.id, row.entityId, row.url, row.title, row.role, row.roleDecidedForHash, row.discoveredAt),
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

const RECORD_TRANSPORT = "UPDATE page SET transport = ?2, transport_reason = ?3, transport_tested_at = ?4, deferred_at = NULL WHERE id = ?1";

const MARK_DEFERRED = "UPDATE page SET deferred_at = ?2 WHERE id = ?1";

export async function recordPageTransport(input: {
  pageId: string;
  transport: "fetch" | "browser";
  reason: string | null;
  testedAt: string;
}): Promise<void> {
  await env.DB.prepare(RECORD_TRANSPORT)
    .bind(input.pageId, input.transport, input.reason, input.testedAt)
    .run();
}

export async function markPageDeferred(pageId: string, at: string): Promise<void> {
  await env.DB.prepare(MARK_DEFERRED).bind(pageId, at).run();
}

export interface OwnSitePage {
  workspaceId: string;
  entityId: string;
  domain: string;
  pageId: string;
  url: string;
}

const ENTITIES_WITHOUT_HOME = `SELECT e.id AS id, e.domain AS domain
FROM entity e
WHERE e.state = 'on'
  AND NOT EXISTS (SELECT 1 FROM page p WHERE p.entity_id = e.id AND p.role = 'home')
ORDER BY e.id`;

const OWN_SITE_PAGES = `SELECT e.workspace_id AS workspace_id,
       e.id AS entity_id,
       e.domain AS domain,
       p.id AS page_id,
       p.url AS url
FROM entity e
JOIN page p ON p.entity_id = e.id AND p.role = 'home'
WHERE e.role = 'self' AND e.state = 'on'
ORDER BY e.workspace_id, p.id`;

const entityRows = z.array(z.object({ id: z.string(), domain: z.string() }));

const ownSiteRows = z.array(
  z.object({
    workspace_id: z.string(),
    entity_id: z.string(),
    domain: z.string(),
    page_id: z.string(),
    url: z.string(),
  }),
);

export async function readEntitiesWithoutHomePage(): Promise<readonly { id: string; domain: string }[]> {
  const rows = await env.DB.prepare(ENTITIES_WITHOUT_HOME).all();
  return entityRows.parse(rows.results);
}

export async function readOwnSitePages(): Promise<OwnSitePage[]> {
  const rows = await env.DB.prepare(OWN_SITE_PAGES).all();
  return ownSiteRows.parse(rows.results).map((row) => ({
    workspaceId: row.workspace_id,
    entityId: row.entity_id,
    domain: row.domain,
    pageId: row.page_id,
    url: row.url,
  }));
}
