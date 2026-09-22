import { env } from "cloudflare:workers";

// The only writer for the workspace table's card columns (docs/REBUILD-TRUST.md
// C5: one writer per table). Card state is two columns on the tenant root, so
// they live in their own module rather than in a route, where the eslint rules
// already forbid any DB access.
//
// Replacements happen in the writer, never at the call site: a publish toggle,
// a slug rotation and a settings read are one transaction's worth of intent and
// no caller should assemble the SQL.

interface CardRow {
  card_slug: string | null;
  card_is_published: 0 | 1;
}

const SELECT_CARD = "SELECT card_slug, card_is_published FROM workspace WHERE id = ?";

const SELECT_WORKSPACE_BY_OWNER = `SELECT id FROM workspace WHERE owner_user_id = ?
ORDER BY created_at LIMIT 1`;

// Publish. Idempotent in the way that matters: a workspace that has never
// been published gets a slug, and a workspace that already has one keeps it.
// Toggling off and back on must not change the URL a customer has shared, so the
// mint is conditional on there being nothing to keep. The CASE keeps it one
// statement, so there is no window where the flag is on and the slug is not.
const CLAIM_CARD = `UPDATE workspace
SET card_is_published = 1,
    card_slug = CASE WHEN card_slug IS NULL THEN ? ELSE card_slug END
WHERE id = ? AND card_is_published = 0`;

const UNPUBLISH_CARD = "UPDATE workspace SET card_is_published = 0 WHERE id = ?";

const ROTATE_CARD_SLUG = `UPDATE workspace SET card_slug = ?
WHERE id = ? AND card_is_published = 1`;

// A public URL that must be revocable. `crypto.getRandomValues` is the stock
// primitive and it is not a signature: rotating is an UPDATE, and the old value
// 404s because the row lookup misses. URL-safe because it is typed, pasted and
// put in a social post.
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

// Publish on. A workspace that has never been published gets a slug from here;
// one that already has one keeps it, because a URL the customer has shared
// changing underneath them is the same incident as an accidental rotation.
export async function publishCard(workspaceId: string): Promise<CardSettings | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = newCardSlug();
    const changes = await env.DB.prepare(CLAIM_CARD).bind(slug, workspaceId).run();
    if (changes.meta.changes > 0 || (await readCardSettings(workspaceId))?.published === true) {
      return readCardSettings(workspaceId);
    }
  }
  throw new Error("could not claim a unique card slug");
}

export async function unpublishCard(workspaceId: string): Promise<void> {
  await env.DB.prepare(UNPUBLISH_CARD).bind(workspaceId).run();
}

export async function rotateCardSlug(workspaceId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = newCardSlug();
    const changes = await env.DB.prepare(ROTATE_CARD_SLUG).bind(slug, workspaceId).run();
    if (changes.meta.changes > 0) return slug;
  }
  return null;
}

// The signed-in user's workspace. Read-only on purpose: the workspace is
// created on first sign-in (issue #4170), and a settings page that can create a
// tenant is a second way for one to appear.
export async function readWorkspaceIdForOwner(userId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_WORKSPACE_BY_OWNER).bind(userId).first<{ id: string }>();
  return row?.id ?? null;
}
