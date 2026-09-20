import { getOrCreatePersonalOrg } from "~/lib/data/org.server";
import { getWorkspaceSeatLimit } from "~/lib/plan-entitlements";
import { getUserPlan } from "~/lib/plan.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Workspace teams on the Better Auth organization plugin (issue #3787).
 *
 * The plugin's `organization` row is the personal org every user already owns
 * (`org_<userId>`, shared identity with the dormant `org_id` columns). A
 * teammate seat is a `member` row with role='member' on the owner's org; a
 * pending invite is an `invitation` row with status='pending' and a hashed
 * `tokenHash`. Accept flips the invitation to 'accepted' and inserts the
 * member row under the SAME id, so a seat's memberRowId is stable across the
 * invited -> active -> revoked lifecycle ('canceled' invitation tombstone +
 * member row deleted).
 *
 * The plan seat cap stays here, not in plugin hooks: the conditional
 * INSERT/UPDATE writes are what make concurrent invites resolve to exactly one
 * winner, and they stay atomic with the write. The plugin's
 * membershipLimit/invitationLimit options in better-auth.server.ts are only
 * defense-in-depth for the plugin's own session-bound endpoints.
 */

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
    `SELECT owner_member.userId AS ownerUserId, u.name AS ownerName,
            COUNT(*) OVER () AS membershipCount
       FROM member m
       JOIN member owner_member
         ON owner_member.organizationId = m.organizationId
        AND owner_member.role = 'owner'
       JOIN user u ON u.id = owner_member.userId
      WHERE m.userId = ?1 AND m.role = 'member'
      ORDER BY m.createdAt ASC
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
    `SELECT id, ownerUserId, memberUserId, invitedEmail, status, createdAt,
            acceptedAt, tokenExpiresAt, revokedAt
       FROM (
         SELECT i.id AS id,
                ?1 AS ownerUserId,
                NULL AS memberUserId,
                i.email AS invitedEmail,
                'invited' AS status,
                i.createdAt AS createdAt,
                NULL AS acceptedAt,
                i.expiresAt AS tokenExpiresAt,
                NULL AS revokedAt
           FROM invitation i
          WHERE i.organizationId = 'org_' || ?1 AND i.status = 'pending'
         UNION ALL
         SELECT mm.id,
                ?1,
                mm.userId,
                u.email,
                'active',
                COALESCE(inv.createdAt, mm.createdAt),
                mm.createdAt,
                NULL,
                NULL
           FROM member mm
           JOIN user u ON u.id = mm.userId
           LEFT JOIN invitation inv ON inv.id = mm.id
          WHERE mm.organizationId = 'org_' || ?1 AND mm.role = 'member'
       )
      ORDER BY createdAt ASC`,
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
    `SELECT mm.id
       FROM member mm
       JOIN user u ON u.id = mm.userId
      WHERE lower(u.email) = ?1 AND mm.role = 'member'
      LIMIT 1`,
  )
    .bind(inviteeEmail)
    .first<{ id: string }>();

  if (memberOfOther) {
    return { ok: false, reason: "That person already belongs to another workspace." };
  }

  // The personal org is the FK anchor for the invitation row; create it on
  // demand for owners who signed up after the 0106 backfill.
  const org = await getOrCreatePersonalOrg(env, input.ownerUserId);

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  let result: { meta?: { changes?: number } };
  try {
    result = await ensureDb(env)
      .prepare(
        `INSERT INTO invitation
           (id, organizationId, email, role, status, expiresAt, createdAt, inviterId, tokenHash)
         SELECT ?1, ?2, ?3, 'member', 'pending', ?4, ?5, ?6, ?7
          WHERE EXISTS (
            SELECT 1
              FROM user_plan owner_plan
             WHERE owner_plan.user_id = ?6
               AND owner_plan.plan = 'agency'
               AND NOT (
                 owner_plan.dodo_status = 'cancellation_scheduled'
                 AND owner_plan.dodo_next_billing_at IS NOT NULL
                 AND julianday(owner_plan.dodo_next_billing_at) <= julianday('now')
               )
          )
          AND (
            (
              SELECT COUNT(*)
                FROM member used_member_seat
               WHERE used_member_seat.organizationId = ?2
                 AND used_member_seat.role = 'member'
            ) + (
              SELECT COUNT(*)
                FROM invitation used_invite_seat
               WHERE used_invite_seat.organizationId = ?2
                 AND used_invite_seat.status = 'pending'
                 AND (
                   used_invite_seat.expiresAt IS NULL
                   OR julianday(used_invite_seat.expiresAt) IS NULL
                   OR julianday(used_invite_seat.expiresAt) > julianday('now')
                 )
            )
          ) < ?8
          AND NOT EXISTS (
            SELECT 1
              FROM invitation existing_email
             WHERE lower(existing_email.email) = ?3
               AND existing_email.status = 'pending'
               AND (
                 existing_email.organizationId = ?2
                 OR existing_email.expiresAt IS NULL
                 OR julianday(existing_email.expiresAt) IS NULL
                 OR julianday(existing_email.expiresAt) > julianday('now')
               )
          )
          AND NOT EXISTS (
            SELECT 1
              FROM member active_member
              JOIN user active_user ON active_user.id = active_member.userId
             WHERE lower(active_user.email) = ?3
               AND active_member.role = 'member'
          )`,
      )
      .bind(
        crypto.randomUUID(),
        org.id,
        inviteeEmail,
        expiresAt,
        createdAt,
        input.ownerUserId,
        tokenHash,
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

  const invite = await ensureDb(env).prepare(
    `SELECT id, email AS invitedEmail, status
       FROM invitation
      WHERE id = ?1 AND organizationId = 'org_' || ?2
      LIMIT 1`,
  )
    .bind(input.memberRowId, input.ownerUserId)
    .first<{ id: string; invitedEmail: string; status: string }>();

  if (!invite || invite.status !== "pending") {
    return { ok: false, reason: "Only pending invites can be resent." };
  }

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const result = await ensureDb(env).prepare(
    `UPDATE invitation
        SET tokenHash = ?1, expiresAt = ?2
      WHERE id = ?3 AND organizationId = 'org_' || ?4 AND status = 'pending'
        AND (
          (
            SELECT COUNT(*)
              FROM member used_member_seat
             WHERE used_member_seat.organizationId = 'org_' || ?4
               AND used_member_seat.role = 'member'
          ) + (
            SELECT COUNT(*)
              FROM invitation used_invite_seat
             WHERE used_invite_seat.organizationId = 'org_' || ?4
               AND used_invite_seat.status = 'pending'
               AND used_invite_seat.id <> invitation.id
               AND (
                 used_invite_seat.expiresAt IS NULL
                 OR julianday(used_invite_seat.expiresAt) IS NULL
                 OR julianday(used_invite_seat.expiresAt) > julianday('now')
               )
          )
        ) < ?5
        AND NOT EXISTS (
          SELECT 1
            FROM invitation live_email
           WHERE live_email.id <> invitation.id
             AND lower(live_email.email) = lower(invitation.email)
             AND live_email.status = 'pending'
             AND (
               live_email.expiresAt IS NULL
               OR julianday(live_email.expiresAt) IS NULL
               OR julianday(live_email.expiresAt) > julianday('now')
             )
        )
        AND NOT EXISTS (
          SELECT 1
            FROM member active_member
            JOIN user active_user ON active_user.id = active_member.userId
           WHERE lower(active_user.email) = lower(invitation.email)
             AND active_member.role = 'member'
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

  return { ok: true, token, inviteeEmail: invite.invitedEmail };
}

export async function peekWorkspaceInvite(env: AppEnv, token: string) {
  const tokenHash = await sha256Hex(token);
  const invite = await ensureDb(env).prepare(
    `SELECT i.email AS invitedEmail, i.expiresAt AS tokenExpiresAt,
            i.status, u.name AS ownerName
       FROM invitation i
       JOIN member owner_member
         ON owner_member.organizationId = i.organizationId
        AND owner_member.role = 'owner'
       JOIN user u ON u.id = owner_member.userId
      WHERE i.tokenHash = ?1
      LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{ invitedEmail: string; tokenExpiresAt: string | null; status: string; ownerName: string | null }>();

  if (!invite || invite.status !== "pending") {
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
    `SELECT i.id, i.organizationId, i.inviterId AS ownerUserId,
            i.email AS invitedEmail, i.expiresAt AS tokenExpiresAt,
            i.status, u.name AS ownerName
       FROM invitation i
       JOIN member owner_member
         ON owner_member.organizationId = i.organizationId
        AND owner_member.role = 'owner'
       JOIN user u ON u.id = owner_member.userId
      WHERE i.tokenHash = ?1
      LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      organizationId: string;
      ownerUserId: string;
      invitedEmail: string;
      tokenExpiresAt: string | null;
      status: string;
      ownerName: string | null;
    }>();

  if (!invite || invite.status !== "pending") {
    return { ok: false, reason: "This invite link is no longer valid." };
  }

  if (invite.tokenExpiresAt && new Date(invite.tokenExpiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "This invite has expired — ask for a fresh one." };
  }

  if (normalizeEmail(input.userEmail) !== invite.invitedEmail.toLowerCase()) {
    return { ok: false, reason: "This invite was sent to a different email address." };
  }

  if (invite.ownerUserId === input.userId) {
    return { ok: false, reason: "You cannot accept your own invite." };
  }

  const existingMembership = await ensureDb(env).prepare(
    `SELECT id FROM member WHERE userId = ?1 AND role = 'member' LIMIT 1`,
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
       FROM invitation owned_invite
      WHERE owned_invite.organizationId = 'org_' || ?1
        AND owned_invite.status = 'pending'
      LIMIT 1`,
  )
    .bind(input.userId)
    .first<{ id: string }>();
  const ownedSeats = ownedWorkspace
    ? ownedWorkspace
    : await ensureDb(env).prepare(
        `SELECT id
           FROM member owned_member
          WHERE owned_member.organizationId = 'org_' || ?1
            AND owned_member.role = 'member'
          LIMIT 1`,
      )
      .bind(input.userId)
      .first<{ id: string }>();
  if (ownedWorkspace || ownedSeats) {
    return { ok: false, reason: "You already own a workspace — leave it before joining another." };
  }

  // Accept is two writes (member insert + invitation tombstone) gated on the
  // same predicates, run as one D1 batch so the flip is atomic. The gated
  // INSERT carries every invariant — a racing second accept sees either the
  // committed member row (NOT EXISTS fails) or the flipped invitation
  // (status='pending' fails) — never both halves applied twice.
  const memberCreatedAt = new Date().toISOString();
  const db = ensureDb(env);
  let insertResult: { meta?: { changes?: number } };
  let updateResult: { meta?: { changes?: number } };
  try {
    [insertResult, updateResult] = await db.batch([
      db.prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         SELECT i.id, i.organizationId, ?1, 'member', ?2
           FROM invitation i
          WHERE i.id = ?3
            AND i.tokenHash = ?4
            AND i.status = 'pending'
            AND lower(i.email) = ?5
            AND (i.expiresAt IS NULL OR julianday(i.expiresAt) > julianday('now'))
            AND EXISTS (
              SELECT 1
                FROM user_plan owner_plan
               WHERE owner_plan.user_id = i.inviterId
                 AND owner_plan.plan = 'agency'
                 AND NOT (
                   owner_plan.dodo_status = 'cancellation_scheduled'
                   AND owner_plan.dodo_next_billing_at IS NOT NULL
                   AND julianday(owner_plan.dodo_next_billing_at) <= julianday('now')
                 )
            )
            AND NOT EXISTS (
              SELECT 1
                FROM member active_membership
               WHERE active_membership.userId = ?1
                 AND active_membership.role = 'member'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM invitation owned_invite
               WHERE owned_invite.organizationId = 'org_' || ?1
                 AND owned_invite.status = 'pending'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM member owned_member
               WHERE owned_member.organizationId = 'org_' || ?1
                 AND owned_member.role = 'member'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM user_plan invitee_plan
               WHERE invitee_plan.user_id = ?1
                 AND invitee_plan.plan = 'agency'
            )`,
      ).bind(input.userId, memberCreatedAt, invite.id, tokenHash, normalizeEmail(input.userEmail)),
      db.prepare(
        `UPDATE invitation
            SET status = 'accepted', tokenHash = NULL
          WHERE id = ?1 AND tokenHash = ?2 AND status = 'pending'
            AND EXISTS (
              SELECT 1 FROM member
               WHERE member.id = invitation.id AND member.userId = ?3
            )`,
      ).bind(invite.id, tokenHash, input.userId),
    ]);
  } catch {
    return {
      ok: false,
      reason: "This invite is no longer available — the workspace changed while you were joining.",
    };
  }

  if (mutationChanges(insertResult) !== 1 || mutationChanges(updateResult) !== 1) {
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
  const db = ensureDb(env);
  const [inviteResult, memberResult] = await db.batch([
    db.prepare(
      `UPDATE invitation
          SET status = 'canceled', tokenHash = NULL
        WHERE id = ?1 AND organizationId = 'org_' || ?2 AND status IN ('pending', 'accepted')`,
    ).bind(input.memberRowId, input.ownerUserId),
    db.prepare(
      `DELETE FROM member
        WHERE id = ?1 AND organizationId = 'org_' || ?2 AND role = 'member'`,
    ).bind(input.memberRowId, input.ownerUserId),
  ]);

  return mutationChanges(inviteResult) + mutationChanges(memberResult) > 0
    ? { ok: true }
    : { ok: false, reason: "That seat is already revoked or no longer belongs to this workspace." };
}
