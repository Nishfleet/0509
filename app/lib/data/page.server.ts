import { env } from "cloudflare:workers";

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
