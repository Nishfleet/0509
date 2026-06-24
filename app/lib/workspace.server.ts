import { getWorkspaceSeatLimit } from "~/lib/plan-entitlements";
import { getUserPlan } from "~/lib/plan.server";
import type { AppEnv } from "~/lib/env.server";

function ensureDb(env: AppEnv) {
  if (!env.DB) {
    throw new Error("D1 binding DB is required for workspace operations");
  }
  return env.DB;
}

/** Agency seats include the workspace owner (owner + up to two teammates). */
export const AGENCY_SEAT_LIMIT = getWorkspaceSeatLimit("agency");
const INVITE_TTL_DAYS = 7;

export interface WorkspaceMemberRow {
  id: string;
  ownerUserId: string;
  memberUserId: string | null;
  invitedEmail: string;
  status: "invited" | "active" | "revoked";
  createdAt: string;
  acceptedAt: string | null;
}

export interface WorkspaceContext {
  workspaceUserId: string;
  isMember: boolean;
  ownerName: string | null;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function resolveWorkspace(env: AppEnv, userId: string): Promise<WorkspaceContext> {
  if (!env.DB?.prepare) {
    return { workspaceUserId: userId, isMember: false, ownerName: null };
  }

  const membership = await ensureDb(env).prepare(
    `SELECT wm.owner_user_id AS ownerUserId, u.name AS ownerName
       FROM workspace_member wm
       JOIN user u ON u.id = wm.owner_user_id
      WHERE wm.member_user_id = ?1 AND wm.status = 'active'
      ORDER BY wm.accepted_at ASC
      LIMIT 1`,
  )
    .bind(userId)
    .first<{ ownerUserId: string; ownerName: string | null }>();

  if (!membership) {
    return { workspaceUserId: userId, isMember: false, ownerName: null };
  }

  const ownerPlan = await getUserPlan(env, membership.ownerUserId);
  if (ownerPlan !== "agency") {
    return { workspaceUserId: userId, isMember: false, ownerName: null };
  }

  return {
    workspaceUserId: membership.ownerUserId,
    isMember: true,
    ownerName: membership.ownerName,
  };
}

export async function resolveWorkspaceDataUserId(env: AppEnv, userId: string) {
  const workspace = await resolveWorkspace(env, userId);
  return workspace.workspaceUserId;
}

export async function listWorkspaceMembers(env: AppEnv, ownerUserId: string) {
  const rows = await ensureDb(env).prepare(
    `SELECT id, owner_user_id AS ownerUserId, member_user_id AS memberUserId,
            invited_email AS invitedEmail, status, created_at AS createdAt,
            accepted_at AS acceptedAt
       FROM workspace_member
      WHERE owner_user_id = ?1 AND status IN ('invited', 'active')
      ORDER BY created_at ASC`,
  )
    .bind(ownerUserId)
    .all<WorkspaceMemberRow>();

  return rows.results ?? [];
}

export async function createWorkspaceInvite(
  env: AppEnv,
  input: { ownerUserId: string; ownerEmail: string; inviteeEmail: string },
): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const inviteeEmail = normalizeEmail(input.inviteeEmail);

  if (!inviteeEmail.includes("@")) {
    return { ok: false, reason: "Enter a valid email address." };
  }

  if (inviteeEmail === normalizeEmail(input.ownerEmail)) {
    return { ok: false, reason: "You already have a seat — invite a teammate." };
  }

  const ownerPlan = await getUserPlan(env, input.ownerUserId);
  if (ownerPlan !== "agency") {
    return { ok: false, reason: "Team seats are part of the Agency plan." };
  }

  const existing = await listWorkspaceMembers(env, input.ownerUserId);
  if (existing.some((row) => row.invitedEmail === inviteeEmail)) {
    return { ok: false, reason: "That teammate is already invited." };
  }

  if (existing.length >= AGENCY_SEAT_LIMIT - 1) {
    return { ok: false, reason: `Agency includes ${AGENCY_SEAT_LIMIT} seats — all are in use.` };
  }

  const memberOfOther = await ensureDb(env).prepare(
    `SELECT wm.id
       FROM workspace_member wm
       JOIN user u ON u.id = wm.member_user_id
      WHERE lower(u.email) = ?1 AND wm.status = 'active'
      LIMIT 1`,
  )
    .bind(inviteeEmail)
    .first<{ id: string }>();

  if (memberOfOther) {
    return { ok: false, reason: "That person already belongs to another workspace." };
  }

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await ensureDb(env).prepare(
    `INSERT INTO workspace_member (id, owner_user_id, invited_email, status, token_hash, token_expires_at)
     VALUES (?1, ?2, ?3, 'invited', ?4, ?5)`,
  )
    .bind(crypto.randomUUID(), input.ownerUserId, inviteeEmail, tokenHash, expiresAt)
    .run();

  return { ok: true, token };
}

export async function peekWorkspaceInvite(env: AppEnv, token: string) {
  const tokenHash = await sha256Hex(token);
  const invite = await ensureDb(env).prepare(
    `SELECT wm.invited_email AS invitedEmail, wm.token_expires_at AS tokenExpiresAt,
            wm.status, u.name AS ownerName
       FROM workspace_member wm
       JOIN user u ON u.id = wm.owner_user_id
      WHERE wm.token_hash = ?1
      LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{ invitedEmail: string; tokenExpiresAt: string | null; status: string; ownerName: string | null }>();

  if (!invite || invite.status !== "invited") {
    return null;
  }

  if (invite.tokenExpiresAt && new Date(invite.tokenExpiresAt).getTime() < Date.now()) {
    return null;
  }

  return { invitedEmail: invite.invitedEmail, ownerName: invite.ownerName };
}

export async function acceptWorkspaceInvite(
  env: AppEnv,
  input: { token: string; userId: string; userEmail: string },
): Promise<{ ok: true; ownerName: string | null } | { ok: false; reason: string }> {
  const tokenHash = await sha256Hex(input.token);
  const invite = await ensureDb(env).prepare(
    `SELECT wm.id, wm.owner_user_id AS ownerUserId, wm.invited_email AS invitedEmail,
            wm.token_expires_at AS tokenExpiresAt, wm.status, u.name AS ownerName
       FROM workspace_member wm
       JOIN user u ON u.id = wm.owner_user_id
      WHERE wm.token_hash = ?1
      LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      ownerUserId: string;
      invitedEmail: string;
      tokenExpiresAt: string | null;
      status: string;
      ownerName: string | null;
    }>();

  if (!invite || invite.status !== "invited") {
    return { ok: false, reason: "This invite link is no longer valid." };
  }

  if (invite.tokenExpiresAt && new Date(invite.tokenExpiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "This invite has expired — ask for a fresh one." };
  }

  if (normalizeEmail(input.userEmail) !== invite.invitedEmail) {
    return { ok: false, reason: "This invite was sent to a different email address." };
  }

  if (invite.ownerUserId === input.userId) {
    return { ok: false, reason: "You cannot accept your own invite." };
  }

  const existingMembership = await ensureDb(env).prepare(
    `SELECT id FROM workspace_member WHERE member_user_id = ?1 AND status = 'active' LIMIT 1`,
  )
    .bind(input.userId)
    .first<{ id: string }>();

  if (existingMembership) {
    return { ok: false, reason: "You already belong to a workspace — leave it before joining another." };
  }

  await ensureDb(env).prepare(
    `UPDATE workspace_member
        SET member_user_id = ?1, status = 'active', token_hash = NULL,
            accepted_at = datetime('now')
      WHERE id = ?2 AND status = 'invited'`,
  )
    .bind(input.userId, invite.id)
    .run();

  return { ok: true, ownerName: invite.ownerName };
}

export async function revokeWorkspaceMember(
  env: AppEnv,
  input: { ownerUserId: string; memberRowId: string },
) {
  await ensureDb(env).prepare(
    `UPDATE workspace_member
        SET status = 'revoked', token_hash = NULL, revoked_at = datetime('now')
      WHERE id = ?1 AND owner_user_id = ?2 AND status IN ('invited', 'active')`,
  )
    .bind(input.memberRowId, input.ownerUserId)
    .run();
}
