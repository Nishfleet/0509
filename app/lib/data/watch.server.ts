import { env } from "cloudflare:workers";
import { z } from "zod";
import { required } from "../required";

export interface NewWatch {
  id: string;
  entityId: string;
  sourceId: string;
  targetKey: string;
}

export interface SiteSweepTarget {
  workspaceId: string;
  entityId: string;
  entityRole: string;
  sourceId: string;
  watchId: string;
  pageId: string;
  pageRole: string;
  url: string;
  transport: "fetch" | "browser" | null;
  transportTestedAt: string | null;
}

const INSERT_WATCH = `INSERT INTO watch (id, entity_id, source_id, target_key, created_at)
SELECT ?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE EXISTS (SELECT 1 FROM entity WHERE id = ?2)
ON CONFLICT (entity_id, source_id, target_key) DO NOTHING`;

const UNWATCHED_ENTITIES = `SELECT e.id AS id, e.domain AS domain, CASE WHEN json_valid(e.identity_json) THEN json_extract(e.identity_json, '$.url') END AS url,
       json_valid(e.identity_json) AS identity_valid
FROM entity e
WHERE e.state = 'on'
  AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.entity_id = e.id AND w.source_id = ?1)
ORDER BY e.id`;

const MARK_POLLED = `UPDATE watch SET last_polled_at = ?2 WHERE id = ?1`;

const SITE_SWEEP_TARGET_JOIN = `SELECT e.workspace_id AS workspace_id,
       e.id AS entity_id,
       e.role AS entity_role,
       w.source_id AS source_id,
       w.id AS watch_id,
       p.id AS page_id,
       COALESCE(p.role, 'other') AS page_role,
       p.url AS url,
       p.transport AS transport,
       p.transport_tested_at AS transport_tested_at
FROM watch w
JOIN source src ON src.id = w.source_id AND src.is_enabled = 1 AND src.platform <> 'feed'
JOIN entity e ON e.id = w.entity_id AND e.state = 'on'
JOIN page p ON p.entity_id = e.id AND p.url = w.target_key
WHERE w.is_active = 1`;

const SITE_SWEEP_TARGETS = `${SITE_SWEEP_TARGET_JOIN} AND src.key = ?1
ORDER BY e.workspace_id, e.id, p.url`;

const entityRows = z.array(z.object({ id: z.string(), domain: z.string() }));

const unwatchedEntityRows = z.array(
  z.object({
    id: z.string(),
    domain: z.string(),
    url: z.string().nullable(),
    identity_valid: z.number().transform((flag) => flag === 1),
  }),
);

type UnwatchedEntity = z.infer<typeof unwatchedEntityRows>[number];

const targetRows = z.array(
  z.object({
    workspace_id: z.string(),
    entity_id: z.string(),
    entity_role: z.string(),
    source_id: z.string(),
    watch_id: z.string(),
    page_id: z.string(),
    page_role: z.string(),
    url: z.string(),
    transport: z.enum(["fetch", "browser"]).nullable(),
    transport_tested_at: z.string().nullable(),
  }),
);

export async function insertWatches(rows: readonly NewWatch[]): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.batch(
    rows.map((row) => env.DB.prepare(INSERT_WATCH).bind(row.id, row.entityId, row.sourceId, row.targetKey)),
  );
}

const SELECT_ENTITY_WATCHES = `SELECT w.id AS id, s.id AS source_id, s.key AS source_key, w.target_key AS target_key
FROM watch w
JOIN source s ON s.id = w.source_id
WHERE w.entity_id = ?1
ORDER BY s.key, w.target_key, w.id`;

const entityWatchRows = z.array(
  z.object({
    id: z.string(),
    source_id: z.string(),
    source_key: z.string(),
    target_key: z.string(),
  }),
);

export interface EntityWatch {
  id: string;
  sourceId: string;
  sourceKey: string;
  targetKey: string;
}

export async function readEntityWatches(entityId: string): Promise<EntityWatch[]> {
  const rows = await env.DB.prepare(SELECT_ENTITY_WATCHES).bind(entityId).all();
  return entityWatchRows.parse(rows.results).map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    sourceKey: row.source_key,
    targetKey: row.target_key,
  }));
}

export async function readUnwatchedEntities(sourceId: string): Promise<readonly UnwatchedEntity[]> {
  const rows = await env.DB.prepare(UNWATCHED_ENTITIES).bind(sourceId).all();
  return unwatchedEntityRows.parse(rows.results);
}

const ADVANCE_HN_CURSOR = `UPDATE watch SET hn_cursor = ?2 WHERE id = ?1 AND hn_cursor < ?2`;

export async function advanceHnCursor(watchId: string, cursor: number): Promise<void> {
  await env.DB.prepare(ADVANCE_HN_CURSOR).bind(watchId, cursor).run();
}

export async function markWatchPolled(watchId: string, polledAt: string): Promise<void> {
  await env.DB.prepare(MARK_POLLED).bind(watchId, polledAt).run();
}

const READ_WATCH_CONFIG = "SELECT config_json FROM watch WHERE id = ?1";
const WRITE_WATCH_CONFIG = "UPDATE watch SET config_json = ?2 WHERE id = ?1";

const readWatchConfigJsonRow = z.object({ config_json: z.string() });

export async function readWatchConfigJson(watchId: string): Promise<string | null> {
  const row = readWatchConfigJsonRow.nullable().parse(await env.DB.prepare(READ_WATCH_CONFIG).bind(watchId).first());
  return row === null ? null : row.config_json;
}

export async function writeWatchConfigJson(watchId: string, configJson: string): Promise<void> {
  const result = await env.DB.prepare(WRITE_WATCH_CONFIG).bind(watchId, configJson).run();
  if (result.meta.changes !== 1) throw new Error(`watch ${watchId} was not updated`);
}

const toSiteSweepTarget = (row: z.infer<typeof targetRows>[number]): SiteSweepTarget => ({
  workspaceId: row.workspace_id,
  entityId: row.entity_id,
  entityRole: row.entity_role,
  sourceId: row.source_id,
  watchId: row.watch_id,
  pageId: row.page_id,
  pageRole: row.page_role,
  url: row.url,
  transport: row.transport,
  transportTestedAt: row.transport_tested_at,
});

export async function readSiteSweepTargets(sourceKey: string): Promise<readonly SiteSweepTarget[]> {
  const rows = await env.DB.prepare(SITE_SWEEP_TARGETS).bind(sourceKey).all();
  return targetRows.parse(rows.results).map(toSiteSweepTarget);
}

const SITE_SWEEP_TARGET_BY_WATCH = `${SITE_SWEEP_TARGET_JOIN} AND w.id = ?1
ORDER BY p.url LIMIT 1`;

export async function readSiteSweepTarget(watchId: string): Promise<SiteSweepTarget | null> {
  const row = await env.DB.prepare(SITE_SWEEP_TARGET_BY_WATCH).bind(watchId).first();
  if (row === null) return null;
  return toSiteSweepTarget(required(targetRows.parse([row])[0], "watch.site-sweep-target"));
}

const ENSURE_WATCHES = `INSERT INTO watch (id, entity_id, source_id, target_key, created_at)
SELECT lower(hex(randomblob(16))), e.id, s.id, COALESCE(NULLIF(e.name, ''), e.domain), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM entity e JOIN source s ON s.kind = ?1 AND s.is_enabled = 1
WHERE e.state = 'on'
ON CONFLICT (entity_id, source_id, target_key) DO NOTHING`;

const SELECT_WATCHES = `SELECT w.id AS watch_id, w.target_key, w.hn_cursor, w.created_at AS watch_created_at, e.id AS entity_id, e.workspace_id, e.role,
  COALESCE(NULLIF(e.name, ''), e.domain) AS name, e.domain,
  s.id AS source_id, s.plugin_key, s.reliability,
  COALESCE(json_extract(CASE WHEN json_valid(s.config_json) THEN s.config_json ELSE '{}' END, '$.min_interval_seconds'), 0) AS min_interval_seconds
FROM watch w
JOIN entity e ON e.id = w.entity_id AND e.state = 'on'
JOIN source s ON s.id = w.source_id AND s.kind = ?1 AND s.is_enabled = 1
WHERE w.is_active = 1 AND w.target_key = COALESCE(NULLIF(e.name, ''), e.domain)
ORDER BY s.plugin_key, w.target_key, w.id`;

const watchRow = z.object({
  watch_id: z.string(),
  target_key: z.string(),
  hn_cursor: z.number(),
  watch_created_at: z.string().nullable(),
  entity_id: z.string(),
  workspace_id: z.string(),
  role: z.enum(["self", "competitor"]),
  name: z.string(),
  domain: z.string(),
  source_id: z.string(),
  plugin_key: z.string(),
  reliability: z.string(),
  min_interval_seconds: z.number(),
});

export type WatchRow = z.infer<typeof watchRow>;

const watchRows = z.array(watchRow);

export async function readActiveWatches(kind: "mentions" | "ads"): Promise<WatchRow[]> {
  await env.DB.prepare(ENSURE_WATCHES).bind(kind).run();
  const rows = await env.DB.prepare(SELECT_WATCHES).bind(kind).all();
  return watchRows.parse(rows.results);
}

const ENTITIES_WITHOUT_HIRING_WATCH = `SELECT e.id AS id, e.domain AS domain
FROM entity e
WHERE e.state = 'on'
  AND NOT EXISTS (
    SELECT 1 FROM watch w
    JOIN source src ON src.id = w.source_id AND src.kind = 'hiring' AND src.is_enabled = 1
    WHERE w.entity_id = e.id AND w.is_active = 1
  )
ORDER BY e.id`;

const HIRING_TARGETS = `SELECT e.workspace_id AS workspace_id, e.id AS entity_id, w.source_id AS source_id,
       src.platform AS platform, w.id AS watch_id, w.target_key AS board_url
FROM watch w
JOIN source src ON src.id = w.source_id AND src.kind = 'hiring' AND src.is_enabled = 1
JOIN entity e ON e.id = w.entity_id AND e.state = 'on'
WHERE w.is_active = 1
ORDER BY e.workspace_id, e.id, w.id`;

const DEACTIVATE_WATCH = "UPDATE watch SET is_active = 0 WHERE id = ?1";

const hiringTargetRows = z.array(
  z.object({
    workspace_id: z.string(),
    entity_id: z.string(),
    source_id: z.string(),
    platform: z.string(),
    watch_id: z.string(),
    board_url: z.string(),
  }),
);

export interface HiringTarget {
  workspaceId: string;
  entityId: string;
  sourceId: string;
  platform: string;
  watchId: string;
  boardUrl: string;
}

export async function readEntitiesWithoutHiringWatch(): Promise<readonly { id: string; domain: string }[]> {
  const rows = await env.DB.prepare(ENTITIES_WITHOUT_HIRING_WATCH).all();
  return entityRows.parse(rows.results);
}

export async function readHiringTargets(): Promise<readonly HiringTarget[]> {
  const rows = await env.DB.prepare(HIRING_TARGETS).all();
  return hiringTargetRows.parse(rows.results).map((row) => ({
    workspaceId: row.workspace_id,
    entityId: row.entity_id,
    sourceId: row.source_id,
    platform: row.platform,
    watchId: row.watch_id,
    boardUrl: row.board_url,
  }));
}

const IN_PILOT = `(json_extract(CASE WHEN json_valid(src.config_json) THEN src.config_json ELSE '{}' END, '$.pilot') IS NULL
  OR e.workspace_id IN (SELECT ws.id FROM workspace ws JOIN user u ON u.id = ws.owner_user_id
    WHERE u.email = json_extract(CASE WHEN json_valid(src.config_json) THEN src.config_json ELSE '{}' END, '$.pilot')))`;

const ENTITIES_WITHOUT_FEED_WATCH = `SELECT e.id AS id, e.domain AS domain
FROM entity e
JOIN source src ON src.key = 'feed.rss' AND src.is_enabled = 1
WHERE e.state = 'on' AND ${IN_PILOT}
  AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.entity_id = e.id AND w.source_id = src.id AND w.is_active = 1)
ORDER BY e.id`;

const FEED_TARGETS = `SELECT e.workspace_id AS workspace_id, e.id AS entity_id, w.source_id AS source_id,
       w.id AS watch_id, w.target_key AS feed_url
FROM watch w
JOIN source src ON src.id = w.source_id AND src.key = 'feed.rss' AND src.is_enabled = 1
JOIN entity e ON e.id = w.entity_id AND e.state = 'on'
WHERE w.is_active = 1 AND ${IN_PILOT}
ORDER BY e.workspace_id, e.id, w.id`;

const feedTargetRows = z.array(
  z.object({
    workspace_id: z.string(),
    entity_id: z.string(),
    source_id: z.string(),
    watch_id: z.string(),
    feed_url: z.string(),
  }),
);

export interface FeedTarget {
  workspaceId: string;
  entityId: string;
  sourceId: string;
  watchId: string;
  feedUrl: string;
}

export async function readEntitiesWithoutFeedWatch(): Promise<readonly { id: string; domain: string }[]> {
  const rows = await env.DB.prepare(ENTITIES_WITHOUT_FEED_WATCH).all();
  return entityRows.parse(rows.results);
}

export async function readFeedTargets(): Promise<readonly FeedTarget[]> {
  const rows = await env.DB.prepare(FEED_TARGETS).all();
  return feedTargetRows.parse(rows.results).map((row) => ({
    workspaceId: row.workspace_id,
    entityId: row.entity_id,
    sourceId: row.source_id,
    watchId: row.watch_id,
    feedUrl: row.feed_url,
  }));
}

export async function deactivateWatch(watchId: string): Promise<void> {
  await env.DB.prepare(DEACTIVATE_WATCH).bind(watchId).run();
}

const ALTERNATE_MARKER = (alias: string): string =>
  `coalesce(CASE WHEN json_valid(${alias}.config_json) THEN json_extract(${alias}.config_json, '$.alternateHome') END, 0) = 1`;

const BLOCKED_RIVALS = `SELECT e.id AS entity_id, e.workspace_id AS workspace_id, e.domain AS domain
FROM entity e
WHERE e.role = 'competitor' AND e.state = 'on'
  AND EXISTS (SELECT 1 FROM page h WHERE h.entity_id = e.id AND h.role = 'home' AND h.deferred_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM watch w WHERE w.entity_id = e.id AND w.is_active = 1 AND ${ALTERNATE_MARKER("w")})
ORDER BY random()
LIMIT ?1`;

const blockedRivalRows = z.array(z.object({ entity_id: z.string(), workspace_id: z.string(), domain: z.string() }));

export interface BlockedRival {
  entityId: string;
  workspaceId: string;
  domain: string;
}

export async function readBlockedRivals(limit: number): Promise<readonly BlockedRival[]> {
  const rows = await env.DB.prepare(BLOCKED_RIVALS).bind(limit).all();
  return blockedRivalRows
    .parse(rows.results)
    .map((row) => ({ entityId: row.entity_id, workspaceId: row.workspace_id, domain: row.domain }));
}

const ALTERNATE_ATTEMPTS = `SELECT w.target_key AS url FROM watch w
WHERE w.entity_id = ?1 AND w.source_id = ?2
  AND (NOT (${ALTERNATE_MARKER("w")}) OR CASE WHEN json_valid(w.config_json) THEN json_extract(w.config_json, '$.at') END >= ?3)`;

export async function readAlternateAttempts(
  entityId: string,
  sourceId: string,
  since: string,
): Promise<ReadonlySet<string>> {
  const rows = await env.DB.prepare(ALTERNATE_ATTEMPTS).bind(entityId, sourceId, since).all();
  return new Set(
    z
      .array(z.object({ url: z.string() }))
      .parse(rows.results)
      .map((row) => row.url),
  );
}

const RECORD_ALTERNATE_ATTEMPT = `INSERT INTO watch (id, entity_id, source_id, target_key, is_active, config_json)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
ON CONFLICT (entity_id, source_id, target_key) DO UPDATE SET is_active = excluded.is_active, config_json = excluded.config_json
WHERE ${ALTERNATE_MARKER("watch")}`;

export async function recordAlternateAttempt(input: {
  entityId: string;
  sourceId: string;
  url: string;
  at: string;
  outcome: { adopted: true } | { adopted: false; reason: string };
  origin?: "customer";
}): Promise<void> {
  const { entityId, sourceId, url, at, outcome, origin } = input;
  const config = JSON.stringify({
    alternateHome: 1,
    at,
    ...(origin === "customer" ? { customer: 1 } : {}),
    ...(outcome.adopted ? {} : { reason: outcome.reason }),
  });
  await env.DB.prepare(RECORD_ALTERNATE_ATTEMPT)
    .bind(crypto.randomUUID(), entityId, sourceId, url, outcome.adopted ? 1 : 0, config)
    .run();
}

const CUSTOMER_MARKER = (alias: string): string =>
  `${ALTERNATE_MARKER(alias)} AND coalesce(CASE WHEN json_valid(${alias}.config_json) THEN json_extract(${alias}.config_json, '$.customer') END, 0) = 1`;

const RETIRE_CUSTOMER_SITES = `UPDATE watch SET is_active = 0
WHERE entity_id = ?2 AND target_key <> ?3 AND is_active = 1 AND ${CUSTOMER_MARKER("watch")}
  AND entity_id IN (SELECT id FROM entity WHERE id = ?2 AND workspace_id = ?1)`;

export async function retireCustomerSites(workspaceId: string, entityId: string, keepUrl: string): Promise<void> {
  await env.DB.prepare(RETIRE_CUSTOMER_SITES).bind(workspaceId, entityId, keepUrl).run();
}

const CUSTOMER_SITE_USAGE = `SELECT COUNT(*) AS rows_used,
       MAX(CASE WHEN json_valid(w.config_json) THEN json_extract(w.config_json, '$.at') END) AS last_at
FROM watch w JOIN entity e ON e.id = w.entity_id AND e.workspace_id = ?1
WHERE w.entity_id = ?2 AND ${CUSTOMER_MARKER("w")}`;

const readCustomerSiteUsageRow = z.object({
  rows_used: z.number(),
  last_at: z.string().nullable(),
});

export async function readCustomerSiteUsage(
  workspaceId: string,
  entityId: string,
): Promise<{ rows: number; lastAt: string | null }> {
  const row = readCustomerSiteUsageRow
    .nullable()
    .parse(await env.DB.prepare(CUSTOMER_SITE_USAGE).bind(workspaceId, entityId).first());
  return { rows: row?.rows_used ?? 0, lastAt: row?.last_at ?? null };
}

const SITE_WATCH_SUMMARY = `SELECT COUNT(*) AS pages, MAX(w.last_polled_at) AS last_polled_at,
       (EXISTS (SELECT 1 FROM entity ue WHERE ue.id = ?2 AND ue.workspace_id = ?1)
        AND EXISTS (SELECT 1 FROM page hp WHERE hp.entity_id = ?2 AND hp.role = 'home' AND hp.deferred_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM watch aw WHERE aw.entity_id = ?2 AND aw.is_active = 1 AND ${ALTERNATE_MARKER("aw")})) AS unreadable,
       (SELECT cw.target_key FROM watch cw JOIN entity ce ON ce.id = cw.entity_id AND ce.workspace_id = ?1 WHERE cw.entity_id = ?2 AND cw.is_active = 1 AND ${CUSTOMER_MARKER("cw")} LIMIT 1) AS customer_site
FROM watch w
JOIN source src ON src.id = w.source_id AND src.kind = 'site' AND src.platform <> 'feed'
JOIN entity e ON e.id = w.entity_id AND e.workspace_id = ?1
WHERE w.entity_id = ?2 AND w.is_active = 1`;

export interface SiteWatchSummary {
  pages: number;
  lastPolledAt: string | null;
  unreadable: boolean;
  customerSite: string | null;
}

const readSiteWatchSummaryRow = z.object({
  pages: z.number(),
  last_polled_at: z.string().nullable(),
  unreadable: z.number(),
  customer_site: z.string().nullable(),
});

export async function readSiteWatchSummary(workspaceId: string, entityId: string): Promise<SiteWatchSummary> {
  const row = readSiteWatchSummaryRow
    .nullable()
    .parse(await env.DB.prepare(SITE_WATCH_SUMMARY).bind(workspaceId, entityId).first());
  return {
    pages: row?.pages ?? 0,
    lastPolledAt: row?.last_polled_at ?? null,
    unreadable: row?.unreadable === 1,
    customerSite: row?.customer_site ?? null,
  };
}

const ENTITY_R2_PREFIXES = `SELECT w.id AS id
FROM watch w
JOIN entity e ON e.id = w.entity_id
WHERE e.id = ?2 AND e.workspace_id = ?1 AND e.role = 'competitor'
ORDER BY w.id`;

const readEntityR2PrefixesRows = z.array(z.object({ id: z.string() }));

export async function readEntityR2Prefixes(workspaceId: string, entityId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(ENTITY_R2_PREFIXES).bind(workspaceId, entityId).all();
  return readEntityR2PrefixesRows
    .parse(results)
    .flatMap((row) => [`snapshot/site/${row.id}/`, `snapshot/hiring/${row.id}/`, `snapshot/feed/${row.id}/`]);
}
