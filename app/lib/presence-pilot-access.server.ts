import type { AppEnv } from "~/lib/env.server";
import { sha256Base64Url } from "~/lib/presence-hash";

export async function hashWorkspaceId(workspaceUserId: string) {
  return sha256Base64Url(workspaceUserId.trim());
}

export async function isPilotWorkspaceEnrolled(env: AppEnv, workspaceUserId: string) {
  if (!env.DB) {
    return false;
  }
  const workspaceIdHash = await hashWorkspaceId(workspaceUserId);
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM presence_pilot_workspace
     WHERE workspace_id_hash = ? AND revoked_at IS NULL`,
  )
    .bind(workspaceIdHash)
    .first<{ ok: number }>();
  return Boolean(row?.ok);
}

export async function countActivePilotWorkspaces(env: AppEnv) {
  if (!env.DB) {
    return 0;
  }
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM presence_pilot_workspace WHERE revoked_at IS NULL`,
  ).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function enrollPilotWorkspace(
  env: AppEnv,
  workspaceUserId: string,
  options: { invitedBy?: string | null; notes?: string | null } = {},
) {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 database is not configured.");
  }
  const workspaceIdHash = await hashWorkspaceId(workspaceUserId);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO presence_pilot_workspace (workspace_id_hash, invited_at, invited_by, notes, revoked_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(workspace_id_hash) DO UPDATE SET
         invited_at = excluded.invited_at,
         invited_by = excluded.invited_by,
         notes = excluded.notes,
         revoked_at = NULL`,
    )
    .bind(workspaceIdHash, now, options.invitedBy ?? null, options.notes ?? null)
    .run();
  return { workspaceIdHash, enrolledAt: now };
}

export async function revokePilotWorkspace(env: AppEnv, workspaceUserId: string) {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 database is not configured.");
  }
  const workspaceIdHash = await hashWorkspaceId(workspaceUserId);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE presence_pilot_workspace
       SET revoked_at = ?
       WHERE workspace_id_hash = ? AND revoked_at IS NULL`,
    )
    .bind(now, workspaceIdHash)
    .run();
  return { workspaceIdHash, revokedAt: now };
}
