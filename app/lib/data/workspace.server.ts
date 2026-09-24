import { env } from "cloudflare:workers";

interface CardRow {
  card_slug: string | null;
  card_is_published: 0 | 1;
}

const SELECT_WORKSPACE_WATCHES = `SELECT w.id FROM watch w
JOIN entity e ON e.id = w.entity_id
WHERE e.workspace_id = ?
ORDER BY w.id`;

const DELETE_WORKSPACE = "DELETE FROM workspace WHERE id = ?";

const SELECT_CARD = "SELECT card_slug, card_is_published FROM workspace WHERE id = ?";

const SELECT_WORKSPACE_BY_OWNER = `SELECT id FROM workspace WHERE owner_user_id = ?
ORDER BY created_at LIMIT 1`;

const CLAIM_CARD = `UPDATE workspace
SET card_is_published = 1,
    card_slug = CASE WHEN card_slug IS NULL THEN ? ELSE card_slug END
WHERE id = ? AND card_is_published = 0`;

const UNPUBLISH_CARD = "UPDATE workspace SET card_is_published = 0 WHERE id = ?";

const ROTATE_CARD_SLUG = `UPDATE workspace SET card_slug = ?
WHERE id = ? AND card_is_published = 1`;

const CARD_SLUG_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function newCardSlug(): string {
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36];
  return out;
}

export interface CardSettings {
  published: boolean;
  slug: string | null;
}

export async function readCardSettings(workspaceId: string): Promise<CardSettings | null> {
  const row = await env.DB.prepare(SELECT_CARD).bind(workspaceId).first<CardRow>();
  if (row === null) return null;
  return { published: row.card_is_published === 1, slug: row.card_slug };
}

export async function publishCard(workspaceId: string): Promise<CardSettings | null> {
  for (let attempt = 0; attempt < CARD_SLUG_ATTEMPTS; attempt += 1) {
    const existing = await readCardSettings(workspaceId);
    if (existing === null) return null;
    if (existing.published) return existing;

    try {
      await env.DB.prepare(CLAIM_CARD).bind(newCardSlug(), workspaceId).run();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      continue;
    }
    return readCardSettings(workspaceId);
  }
  throw new Error("could not claim a unique card slug");
}

export async function unpublishCard(workspaceId: string): Promise<void> {
  await env.DB.prepare(UNPUBLISH_CARD).bind(workspaceId).run();
}

export async function rotateCardSlug(workspaceId: string): Promise<string | null> {
  for (let attempt = 0; attempt < CARD_SLUG_ATTEMPTS; attempt += 1) {
    const slug = newCardSlug();
    try {
      await env.DB.prepare(ROTATE_CARD_SLUG).bind(slug, workspaceId).run();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      continue;
    }
    return slug;
  }
  return null;
}

export async function readWorkspaceIdForOwner(userId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_WORKSPACE_BY_OWNER).bind(userId).first<{ id: string }>();
  return row?.id ?? null;
}

interface BoundStatement {
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface WorkspaceDb {
  prepare(query: string): {
    bind(...values: unknown[]): BoundStatement;
  };
}

const INSERT_WORKSPACE = `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
VALUES (?, ?, ?, ?, 1, 8, ?)
ON CONFLICT(id) DO NOTHING`;

const FILL_TIMEZONE = `UPDATE workspace SET timezone = ? WHERE id = ? AND timezone = 'UTC'`;

export async function insertWorkspace(
  db: WorkspaceDb,
  input: { id: string; name: string; ownerUserId: string; timezone: string; createdAt: string },
): Promise<void> {
  await db
    .prepare(INSERT_WORKSPACE)
    .bind(input.id, input.name, input.ownerUserId, input.timezone, input.createdAt)
    .run();
}

export async function fillWorkspaceTimezone(db: WorkspaceDb, id: string, timezone: string): Promise<void> {
  await db.prepare(FILL_TIMEZONE).bind(timezone, id).run();
}

export async function readWorkspaceR2Prefixes(workspaceId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(SELECT_WORKSPACE_WATCHES)
    .bind(workspaceId)
    .all<{ id: string }>();
  return [`card/${workspaceId}/`, ...results.map((row) => `snapshot/site/${row.id}/`)];
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await env.DB.prepare(DELETE_WORKSPACE).bind(workspaceId).run();
}
