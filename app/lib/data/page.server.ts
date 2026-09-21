/**
 * `page` — discovered pages per entity with D9's role cached by
 * URL + title hash (role_decided_for_hash), so a page is re-judged only when
 * the title changes (docs/REBUILD-JEV.md D9).
 */
import type { DataEnv } from "./entity.server";

export interface PageRow {
  id: string;
  entity_id: string;
  url: string;
  title: string | null;
  role: string | null;
  role_decided_for_hash: string | null;
}

export async function listPagesForEntity(
  env: DataEnv,
  entityId: string,
): Promise<PageRow[]> {
  const rows = await env.DB.prepare(
    "SELECT id, entity_id, url, title, role, role_decided_for_hash FROM page WHERE entity_id = ?",
  )
    .bind(entityId)
    .all<PageRow>();
  return rows.results ?? [];
}

export async function upsertPage(
  env: DataEnv,
  entityId: string,
  url: string,
): Promise<PageRow> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO page (id, entity_id, url, discovered_at) VALUES (?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), entityId, url, new Date().toISOString())
    .run();
  const row = await env.DB.prepare(
    "SELECT id, entity_id, url, title, role, role_decided_for_hash FROM page WHERE entity_id = ? AND url = ?",
  )
    .bind(entityId, url)
    .first<PageRow>();
  if (!row) throw new Error("page row missing after upsert");
  return row;
}

export async function setPageRole(
  env: DataEnv,
  pageId: string,
  title: string,
  role: string,
  roleHash: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE page SET role = ?, title = ?, role_decided_for_hash = ? WHERE id = ?",
  )
    .bind(role, title, roleHash, pageId)
    .run();
}

export async function setPageTitle(
  env: DataEnv,
  pageId: string,
  title: string,
): Promise<void> {
  await env.DB.prepare("UPDATE page SET title = ? WHERE id = ?")
    .bind(title, pageId)
    .run();
}
