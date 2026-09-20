import {
  ensureDb,
  execute as run,
  queryOne as one,
} from "~/lib/data/d1.server";
import { createId, nowIso } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Org-scoped ownership foundation (issue #2176, phase 1; moved onto the Better
 * Auth organization plugin's tables by issue #3787).
 *
 * Every user owns a personal org (backfilled by migrations 0089 into `org` and
 * 0106 into `organization`). This module is the read/write seam for that org:
 * it resolves a user's org id and creates the personal org plus its owner
 * member row on demand for users who signed up after the backfill ran. Later
 * phases (dual-write, read-switch) build on this seam. The legacy `org` table
 * remains for rollback; reads and writes here hit `organization`/`member`.
 */

export interface OrgRecord {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export function personalOrgIdForUser(userId: string): string {
  return `org_${userId}`;
}

export function personalOrgSlugForUser(userId: string): string {
  return `org-${userId}`;
}

export async function getOrgById(env: AppEnv, orgId: string): Promise<OrgRecord | null> {
  return one<OrgRecord>(
    env,
    `
      SELECT o.id,
             o.name,
             COALESCE(om.userId, json_extract(o.metadata, '$.ownerUserId')) AS ownerUserId,
             o.createdAt AS createdAt,
             o.createdAt AS updatedAt
      FROM organization o
      LEFT JOIN member om ON om.organizationId = o.id AND om.role = 'owner'
      WHERE o.id = ?
    `,
    orgId,
  );
}

/**
 * Resolve the org id for a user, creating the personal org on demand if the
 * backfill (migration 0106) has not seen this user yet. Idempotent — the org
 * insert and the owner member insert both run unconditionally so a torn state
 * (org without its owner member row) self-heals on the next call.
 */
export async function getOrCreatePersonalOrg(env: AppEnv, userId: string): Promise<OrgRecord> {
  const orgId = personalOrgIdForUser(userId);

  const timestamp = nowIso();
  const user = await one<{ name: string; createdAt: string; updatedAt: string }>(
    env,
    `SELECT name, createdAt, updatedAt FROM user WHERE id = ?`,
    userId,
  );
  const name = user?.name ?? userId;
  const createdAt = user?.createdAt ?? timestamp;

  await run(
    env,
    `
      INSERT OR IGNORE INTO organization (id, name, slug, logo, createdAt, metadata)
      VALUES (?, ?, ?, NULL, ?, json_object('ownerUserId', ?))
    `,
    orgId,
    name,
    personalOrgSlugForUser(userId),
    createdAt,
    userId,
  );

  await run(
    env,
    `
      INSERT OR IGNORE INTO member (id, organizationId, userId, role, createdAt)
      VALUES (?, ?, ?, 'owner', ?)
    `,
    `mem_${userId}`,
    orgId,
    userId,
    createdAt,
  );

  const created = await getOrgById(env, orgId);
  if (created) {
    return created;
  }
  throw new Error(`org: failed to create personal org for user ${userId}`);
}

/** Resolve the org id for a user, or null when the org does not exist yet. */
export async function getOrgIdForUser(env: AppEnv, userId: string): Promise<string | null> {
  const org = await getOrgById(env, personalOrgIdForUser(userId));
  return org?.id ?? null;
}

export { ensureDb };
