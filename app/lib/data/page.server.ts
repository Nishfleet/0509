import { env } from "cloudflare:workers";
import { z } from "zod";

export interface NewPage {
  id: string;
  entityId: string;
  url: string;
  role: "home";
  discoveredAt: string;
}

const INSERT_PAGE = `INSERT INTO page (id, entity_id, url, role, discovered_at)
VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT (entity_id, url) DO NOTHING`;

export async function insertPages(rows: readonly NewPage[]): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(INSERT_PAGE).bind(row.id, row.entityId, row.url, row.role, row.discoveredAt),
    ),
  );
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
