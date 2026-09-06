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
  tokenExpiresAt: string | null;
  revokedAt: string | null;
}

export interface WorkspaceContext {
  workspaceUserId: string;
  isMember: boolean;
  ownerName: string | null;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function mutationChanges(result: { meta?: { changes?: number } }) {
  return Number(result.meta?.changes ?? 0);
}

export function workspaceMemberOccupiesSeat(
  member: Pick<WorkspaceMemberRow, "status" | "tokenExpiresAt">,
  now = Date.now(),
) {
  if (member.status === "active") {
    return true;
  }
  if (member.status !== "invited" || !member.tokenExpiresAt) {
    return member.status === "invited";
  }
  const expiresAt = Date.parse(member.tokenExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > now;
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
    `SELECT wm.owner_user_id AS ownerUserId, u.name AS ownerName,
            COUNT(*) OVER () AS membershipCount
       FROM workspace_member wm
       JOIN user u ON u.id = wm.owner_user_id
      WHERE wm.member_user_id = ?1 AND wm.status = 'active'
      ORDER BY wm.accepted_at ASC
      LIMIT 1`,
  )
    .bind(userId)
    .first<{ ownerUserId: string; ownerName: string | null; membershipCount?: number }>();

  if (!membership || Number(membership.membershipCount ?? 1) !== 1) {
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
            accepted_at AS acceptedAt, token_expires_at AS tokenExpiresAt,
            revoked_at AS revokedAt
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
  if (existing.filter((row) => workspaceMemberOccupiesSeat(row)).length >= AGENCY_SEAT_LIMIT - 1) {
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

  let result: { meta?: { changes?: number } };
  try {
    result = await ensureDb(env)
      .prepare(
        `INSERT INTO workspace_member
           (id, owner_user_id, invited_email, status, token_hash, token_expires_at)
         SELECT ?1, ?2, ?3, 'invited', ?4, ?5
           FROM user_plan owner_plan
          WHERE owner_plan.user_id = ?2
            AND owner_plan.plan = 'agency'
            AND NOT (
              owner_plan.dodo_status = 'cancellation_scheduled'
              AND owner_plan.dodo_next_billing_at IS NOT NULL
              AND julianday(owner_plan.dodo_next_billing_at) <= julianday('now')
            )
            AND (
              SELECT COUNT(*)
                FROM workspace_member used_seat
               WHERE used_seat.owner_user_id = ?2
                 AND (
                   used_seat.status = 'active'
                   OR (
                     used_seat.status = 'invited'
                     AND (
                       used_seat.token_expires_at IS NULL
                       OR julianday(used_seat.token_expires_at) IS NULL
                       OR julianday(used_seat.token_expires_at) > julianday('now')
                     )
                   )
                 )
            ) < ?6
            AND NOT EXISTS (
              SELECT 1
                FROM workspace_member existing_email
               WHERE lower(existing_email.invited_email) = ?3
                 AND (
                   existing_email.status = 'active'
                   OR (
                     existing_email.status = 'invited'
                     AND (
                       existing_email.owner_user_id = ?2
                       OR existing_email.token_expires_at IS NULL
                       OR julianday(existing_email.token_expires_at) IS NULL
                       OR julianday(existing_email.token_expires_at) > julianday('now')
                     )
                   )
                 )
            )
            AND NOT EXISTS (
              SELECT 1
                FROM workspace_member active_member
                JOIN user active_user ON active_user.id = active_member.member_user_id
               WHERE lower(active_user.email) = ?3
                 AND active_member.status = 'active'
            )`,
      )
      .bind(
        crypto.randomUUID(),
        input.ownerUserId,
        inviteeEmail,
        tokenHash,
        expiresAt,
        AGENCY_SEAT_LIMIT - 1,
      )
      .run();
  } catch {
    return { ok: false, reason: "That invite could not be created — refresh and try again." };
  }

  if (mutationChanges(result) !== 1) {
    return {
      ok: false,
      reason: "That invite could not be created because the seat or teammate state changed.",
    };
  }

  return { ok: true, token };
}

export async function resendWorkspaceInvite(
  env: AppEnv,
  input: { ownerUserId: string; memberRowId: string },
): Promise<{ ok: true; token: string; inviteeEmail: string } | { ok: false; reason: string }> {
  const ownerPlan = await getUserPlan(env, input.ownerUserId);
  if (ownerPlan !== "agency") {
    return { ok: false, reason: "Team seats are part of the Agency plan." };
  }

  const member = await ensureDb(env).prepare(
    `SELECT id, invited_email AS invitedEmail, status
       FROM workspace_member
      WHERE id = ?1 AND owner_user_id = ?2
      LIMIT 1`,
  )
    .bind(input.memberRowId, input.ownerUserId)
    .first<{ id: string; invitedEmail: string; status: string }>();

  if (!member || member.status !== "invited") {
    return { ok: false, reason: "Only pending invites can be resent." };
  }

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const result = await ensureDb(env).prepare(
    `UPDATE workspace_member
        SET token_hash = ?1, token_expires_at = ?2
      WHERE id = ?3 AND owner_user_id = ?4 AND status = 'invited'
        AND (
          SELECT COUNT(*)
            FROM workspace_member used_seat
           WHERE used_seat.owner_user_id = ?4
             AND used_seat.id <> workspace_member.id
             AND (
               used_seat.status = 'active'
               OR (
                 used_seat.status = 'invited'
                 AND (
                   used_seat.token_expires_at IS NULL
                   OR julianday(used_seat.token_expires_at) IS NULL
                   OR julianday(used_seat.token_expires_at) > julianday('now')
                 )
               )
             )
        ) < ?5
        AND NOT EXISTS (
          SELECT 1
            FROM workspace_member live_email
           WHERE live_email.id <> workspace_member.id
             AND lower(live_email.invited_email) = lower(workspace_member.invited_email)
             AND (
               live_email.status = 'active'
               OR (
                 live_email.status = 'invited'
                 AND (
                   live_email.token_expires_at IS NULL
                   OR julianday(live_email.token_expires_at) IS NULL
                   OR julianday(live_email.token_expires_at) > julianday('now')
                 )
               )
             )
        )
        AND NOT EXISTS (
          SELECT 1
            FROM workspace_member active_member
            JOIN user active_user ON active_user.id = active_member.member_user_id
           WHERE lower(active_user.email) = lower(workspace_member.invited_email)
             AND active_member.status = 'active'
        )`,
  )
    .bind(
      tokenHash,
      expiresAt,
      input.memberRowId,
      input.ownerUserId,
      AGENCY_SEAT_LIMIT - 1,
    )
    .run();

  if (mutationChanges(result) !== 1) {
    return { ok: false, reason: "That invite is no longer pending — refresh the team page." };
  }

  return { ok: true, token, inviteeEmail: member.invitedEmail };
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

  const ownerPlan = await getUserPlan(env, invite.ownerUserId);
  if (ownerPlan !== "agency") {
    return { ok: false, reason: "This team's Agency plan is no longer active." };
  }

  const ownedWorkspace = await ensureDb(env).prepare(
    `SELECT id
       FROM workspace_member
      WHERE owner_user_id = ?1 AND status IN ('invited', 'active')
      LIMIT 1`,
  )
    .bind(input.userId)
    .first<{ id: string }>();
  if (ownedWorkspace) {
    return { ok: false, reason: "You already own a workspace — leave it before joining another." };
  }

  let result: { meta?: { changes?: number } };
  try {
    result = await ensureDb(env).prepare(
      `UPDATE workspace_member
        SET member_user_id = ?1, status = 'active', token_hash = NULL,
            accepted_at = datetime('now')
      WHERE id = ?2
        AND token_hash = ?3
        AND status = 'invited'
        AND lower(invited_email) = ?4
        AND (token_expires_at IS NULL OR julianday(token_expires_at) > julianday('now'))
        AND EXISTS (
          SELECT 1
            FROM user_plan owner_plan
           WHERE owner_plan.user_id = workspace_member.owner_user_id
             AND owner_plan.plan = 'agency'
             AND NOT (
               owner_plan.dodo_status = 'cancellation_scheduled'
               AND owner_plan.dodo_next_billing_at IS NOT NULL
               AND julianday(owner_plan.dodo_next_billing_at) <= julianday('now')
             )
        )
        AND NOT EXISTS (
          SELECT 1
            FROM workspace_member active_membership
           WHERE active_membership.member_user_id = ?1
             AND active_membership.status = 'active'
        )
        AND NOT EXISTS (
          SELECT 1
            FROM workspace_member owned_workspace
           WHERE owned_workspace.owner_user_id = ?1
             AND owned_workspace.status IN ('invited', 'active')
        )
        AND NOT EXISTS (
          SELECT 1
            FROM user_plan invitee_plan
           WHERE invitee_plan.user_id = ?1
             AND invitee_plan.plan = 'agency'
        )`,
    )
      .bind(input.userId, invite.id, tokenHash, invite.invitedEmail)
      .run();
  } catch {
    return {
      ok: false,
      reason: "This invite is no longer available — the workspace changed while you were joining.",
    };
  }

  if (mutationChanges(result) !== 1) {
    return {
      ok: false,
      reason: "This invite is no longer available — the workspace changed while you were joining.",
    };
  }

  return { ok: true, ownerName: invite.ownerName };
}

export async function revokeWorkspaceMember(
  env: AppEnv,
  input: { ownerUserId: string; memberRowId: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await ensureDb(env).prepare(
    `UPDATE workspace_member
        SET status = 'revoked', token_hash = NULL, revoked_at = datetime('now')
      WHERE id = ?1 AND owner_user_id = ?2 AND status IN ('invited', 'active')`,
  )
    .bind(input.memberRowId, input.ownerUserId)
    .run();

  return mutationChanges(result) === 1
    ? { ok: true }
    : { ok: false, reason: "That seat is already revoked or no longer belongs to this workspace." };
}
