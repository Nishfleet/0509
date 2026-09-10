import {
  ensureDb,
  execute as run,
  queryOne as one,
} from "~/lib/data/d1.server";
import { createId, nowIso } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Org-scoped ownership foundation (issue #2176, phase 1).
 *
 * Every user owns a personal org (backfilled by migration 0088). This module
 * is the read/write seam for that org: it resolves a user's org id and
 * creates the personal org on demand for users who signed up after the
 * backfill ran. Later phases (dual-write, read-switch) build on this seam.
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

export async function getOrgById(env: AppEnv, orgId: string): Promise<OrgRecord | null> {
  return one<OrgRecord>(
    env,
    `
      SELECT id, name, owner_user_id AS ownerUserId, created_at AS createdAt, updated_at AS updatedAt
      FROM org
      WHERE id = ?
    `,
    orgId,
  );
}

/**
 * Resolve the org id for a user, creating the personal org on demand if the
 * backfill (migration 0088) has not seen this user yet. Idempotent.
 */
export async function getOrCreatePersonalOrg(env: AppEnv, userId: string): Promise<OrgRecord> {
  const orgId = personalOrgIdForUser(userId);
  const existing = await getOrgById(env, orgId);
  if (existing) {
    return existing;
  }

  const timestamp = nowIso();
  const user = await one<{ name: string; createdAt: string; updatedAt: string }>(
    env,
    `SELECT name, createdAt, updatedAt FROM user WHERE id = ?`,
    userId,
  );
  const name = user?.name ?? userId;
  const createdAt = user?.createdAt ?? timestamp;
  const updatedAt = user?.updatedAt ?? timestamp;

  await run(
    env,
    `
      INSERT OR IGNORE INTO org (id, name, owner_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    orgId,
    name,
    userId,
    createdAt,
    updatedAt,
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
