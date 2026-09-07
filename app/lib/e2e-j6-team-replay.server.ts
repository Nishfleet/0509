import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { AppEnv } from "~/lib/env.server";
import {
  acceptWorkspaceInvite,
  createWorkspaceInvite,
  listWorkspaceMembers,
  peekWorkspaceInvite,
  resendWorkspaceInvite,
  revokeWorkspaceMember,
  type WorkspaceMemberRow,
} from "~/lib/workspace.server";

const PERSONA = "e2e-agency" as const;
const REMOVED_MEMBER = "e2e-removed-member" as const;
const OWNER_EMAIL = "e2e-agency@example.invalid";
const REMOVED_MEMBER_EMAIL = "e2e-removed-member@example.invalid";
const RACE_EMAILS = [
  "e2e-j6-team-race-a@example.invalid",
  "e2e-j6-team-race-b@example.invalid",
] as const;
const BASELINE_IDS = new Set(["e2e-member-active", "e2e-member-revoked"]);
const VIEWPORTS = ["375x812", "768x900", "1440x900"] as const;
const PATH = "/api/e2e/team/replay";
const STATE_PATH = "/api/e2e/team/state";
const REPLAY_ACTION = "team_membership";

export type J6TeamViewport = (typeof VIEWPORTS)[number];

export interface J6TeamReplayMapping {
  userId: typeof PERSONA;
  runId: string;
  viewport: J6TeamViewport;
}

interface ReplayRow {
  action: string;
  user_id: string;
  run_id: string;
  status: "started" | "succeeded";
  processing_token: string;
  result_json: string | null;
  updated_at: string;
}

const REPLAY_ACTIONS: Readonly<Record<string, J6TeamReplayMapping>> = Object.freeze(
  Object.fromEntries(
    VIEWPORTS.map((viewport) => [
      `e2e-j6-team-invite-${viewport}`,
      {
        userId: PERSONA,
        runId: `e2e-run-j6-team-invite-${viewport}`,
        viewport,
      } satisfies J6TeamReplayMapping,
    ]),
  ),
);

export function resolveJ6TeamReplayMapping(
  idempotencyKey: string,
  userId: string,
  runId: string,
) {
  const mapping = REPLAY_ACTIONS[idempotencyKey];
  return mapping?.userId === userId && mapping.runId === runId ? mapping : null;
}

export function resolveJ6TeamReplayAction(
  idempotencyKey: string,
  userId: string,
  runId: string,
) {
  return resolveJ6TeamReplayMapping(idempotencyKey, userId, runId) ? "invite_concurrency_recovery" : null;
}

export function resolveJ6TeamReplayStateRequest(request: Request) {
  if (request.method !== "GET" || request.headers.get("x-0509-e2e-test-mode") !== "1") return null;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username !== "" ||
    url.password !== "" ||
    !Number.isInteger(port) ||
    port < 1_024 ||
    port > 65_535 ||
    url.origin !== `http://127.0.0.1:${port}` ||
    url.pathname !== STATE_PATH
  ) {
    return null;
  }
  const queryKeys = [...url.searchParams.keys()].sort();
  if (queryKeys.length !== 2 || queryKeys[0] !== "idempotencyKey" || queryKeys[1] !== "runId") return null;
  const idempotencyKey = url.searchParams.get("idempotencyKey") ?? "";
  const runId = url.searchParams.get("runId") ?? "";
  const mapping = resolveJ6TeamReplayMapping(idempotencyKey, PERSONA, runId);
  if (!mapping || fixtureCookie(request) !== PERSONA) return null;
  return { idempotencyKey, ...mapping };
}

export async function action({ context, request }: ActionFunctionArgs) {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return notFound();
  }
  if (request.method !== "POST" || pathname !== PATH) return notFound();

  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const [{ resolveE2EProviderDeny, sanitizeE2EProviderEnv }, { isE2ETestRequestEnabled }, guardModule] =
    await Promise.all([
      import("~/lib/e2e-provider.server"),
      import("~/lib/e2e-auth.server"),
      import("~/lib/e2e-harness-guard.server"),
    ]);
  const networkDeny = await resolveE2EProviderDeny(env, request);
  const testModeEnabled = await isE2ETestRequestEnabled(env, request);
  const guarded = await guardModule.guardE2EHarnessReplayRequest(request, {
    networkDeny,
    testMode: { enabled: testModeEnabled, sentinel: networkDeny.enabled && networkDeny.failClosed },
  });
  if (!guarded.ok || guarded.metadata.scenario !== "j6" || !env.DB) return notFound();

  const mapping = resolveJ6TeamReplayMapping(
    guarded.metadata.idempotencyKey,
    guarded.metadata.userId,
    guarded.metadata.runId,
  );
  if (!mapping) return notFound();

  const replayEnv = sanitizeE2EProviderEnv(env);
  try {
    const claim = await claimReplayAction(replayEnv, mapping, guarded.metadata);
    if (claim.replayed) return noStoreJson({ ok: true, replayed: true, ...claim.result });
    const result = await runJ6TeamReplay(replayEnv, mapping);
    await completeReplayAction(replayEnv, guarded.metadata.idempotencyKey, claim.processingToken, result);
    return noStoreJson({ ok: true, replayed: false, ...result });
  } catch (error) {
    if (error instanceof J6TeamReplayInProgressError) {
      return noStoreJson({ ok: false, blocker: "j6_team_replay_in_progress" }, 409);
    }
    return noStoreJson({ ok: false, blocker: "j6_team_replay_failed" }, 503);
  }
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const identity = resolveJ6TeamReplayStateRequest(request);
  if (!identity) return notFound();
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const [{ resolveE2EProviderDeny, sanitizeE2EProviderEnv }, { isE2ETestRequestEnabled }] = await Promise.all([
    import("~/lib/e2e-provider.server"),
    import("~/lib/e2e-auth.server"),
  ]);
  const networkDeny = await resolveE2EProviderDeny(env, request);
  if (!env.DB || !networkDeny.enabled || !networkDeny.failClosed || !(await isE2ETestRequestEnabled(env, request))) {
    return notFound();
  }
  try {
    const row = await readReplayState(sanitizeE2EProviderEnv(env), identity.idempotencyKey);
    if (!row || row.user_id !== PERSONA || row.run_id !== identity.runId || row.status !== "succeeded") return notFound();
    return noStoreJson({ ok: true, ...parseReplayResult(row.result_json) });
  } catch {
    return noStoreJson({ ok: false, blocker: "j6_team_state_failed" }, 503);
  }
}

export function resolveJ6TeamReplayClaim(
  row: Pick<ReplayRow, "status" | "processing_token" | "run_id"> | null,
  processingToken: string,
  runId: string,
) {
  if (!row || row.run_id !== runId) return "invalid" as const;
  if (row.status === "succeeded") return "replayed" as const;
  return row.processing_token === processingToken ? "claimed" as const : "in_progress" as const;
}

export function resolveJ6TeamReplayCompletion(input: {
  changes: number;
  currentStatus: string;
  currentToken: string;
  currentRunId: string;
  processingToken: string;
  runId: string;
}) {
  return input.changes === 1 && input.currentStatus === "started" &&
    input.currentToken === input.processingToken && input.currentRunId === input.runId;
}

export async function runJ6TeamReplay(env: AppEnv, mapping: J6TeamReplayMapping) {
  const baseline = await readAllWorkspaceMembers(env);
  const baselineById = new Map(baseline.map((row) => [row.id, row.status]));
  if (baselineById.get("e2e-member-active") !== "active" || baselineById.get("e2e-member-revoked") !== "revoked") {
    throw new Error("j6_team_baseline_missing");
  }

  const createdIds = new Set<string>();
  try {
    const raceResults = await Promise.all(RACE_EMAILS.map((inviteeEmail) =>
      createWorkspaceInvite(env, { ownerUserId: PERSONA, ownerEmail: OWNER_EMAIL, inviteeEmail }),
    ));
    const raceMembers = await listWorkspaceMembers(env, PERSONA);
    for (const row of raceMembers) if (!baselineById.has(row.id)) createdIds.add(row.id);
    const raceSuccesses = raceResults.filter((result) => result.ok);
    if (raceSuccesses.length !== 1 || raceResults.filter((result) => !result.ok).length !== 1) {
      throw new Error("j6_team_concurrency_not_exactly_one");
    }
    const winner = raceMembers.find((row) => !baselineById.has(row.id) && RACE_EMAILS.includes(row.invitedEmail as (typeof RACE_EMAILS)[number]));
    if (!winner) throw new Error("j6_team_winner_missing");
    const winnerRevoked = await revokeWorkspaceMember(env, { ownerUserId: PERSONA, memberRowId: winner.id });
    if (!winnerRevoked.ok) throw new Error("j6_team_winner_revoke_failed");

    const created = await createWorkspaceInvite(env, {
      ownerUserId: PERSONA,
      ownerEmail: OWNER_EMAIL,
      inviteeEmail: REMOVED_MEMBER_EMAIL,
    });
    if (!created.ok) throw new Error("j6_team_removed_invite_failed");
    let rows = await listWorkspaceMembers(env, PERSONA);
    const removedRow = rows.find((row) => row.invitedEmail === REMOVED_MEMBER_EMAIL && !BASELINE_IDS.has(row.id) && row.status === "invited");
    if (!removedRow) throw new Error("j6_team_removed_row_missing");
    createdIds.add(removedRow.id);

    const resent = await resendWorkspaceInvite(env, { ownerUserId: PERSONA, memberRowId: removedRow.id });
    if (!resent.ok) throw new Error("j6_team_resend_failed");
    const stalePeek = await peekWorkspaceInvite(env, created.token);
    if (stalePeek !== null) throw new Error("j6_team_stale_token_accepted");
    const staleAccept = await acceptWorkspaceInvite(env, {
      token: created.token,
      userId: REMOVED_MEMBER,
      userEmail: REMOVED_MEMBER_EMAIL,
    });
    if (staleAccept.ok) throw new Error("j6_team_stale_token_accepted");
    const currentPeek = await peekWorkspaceInvite(env, resent.token);
    if (!currentPeek) throw new Error("j6_team_current_token_missing");

    const accepted = await acceptWorkspaceInvite(env, {
      token: resent.token,
      userId: REMOVED_MEMBER,
      userEmail: REMOVED_MEMBER_EMAIL,
    });
    if (!accepted.ok) throw new Error("j6_team_current_token_rejected");
    rows = await listWorkspaceMembers(env, PERSONA);
    const acceptedRow = rows.find((row) => row.id === removedRow.id);
    if (!acceptedRow || acceptedRow.status !== "active" || acceptedRow.memberUserId !== REMOVED_MEMBER) {
      throw new Error("j6_team_accept_state_invalid");
    }
    const tokenHashCleared = await hasNullTokenHash(env, removedRow.id);
    if (!tokenHashCleared) throw new Error("j6_team_token_hash_not_cleared");

    const acceptedRevoked = await revokeWorkspaceMember(env, { ownerUserId: PERSONA, memberRowId: removedRow.id });
    const staleRevoke = await revokeWorkspaceMember(env, { ownerUserId: PERSONA, memberRowId: removedRow.id });
    const staleResend = await resendWorkspaceInvite(env, { ownerUserId: PERSONA, memberRowId: removedRow.id });
    const acceptAfterRevoke = await acceptWorkspaceInvite(env, {
      token: resent.token,
      userId: REMOVED_MEMBER,
      userEmail: REMOVED_MEMBER_EMAIL,
    });
    if (!acceptedRevoked.ok || staleRevoke.ok || staleResend.ok || acceptAfterRevoke.ok) {
      throw new Error("j6_team_revocation_conflict_invalid");
    }

    return {
      scenario: "j6",
      action: "team_invite_concurrency_recovery",
      persona: PERSONA,
      viewport: mapping.viewport,
      owner: { id: PERSONA, plan: "agency" },
      concurrency: { attempted: 2, successes: 1, failures: 1, exactlyOneSuccess: true },
      winner: { revoked: true },
      rotation: { created: true, resent: true, staleTokenRejected: true, currentTokenAccepted: true, tokenHashCleared: true },
      revoke: { acceptedMemberRevoked: true, staleRevoke: false, staleResend: false, acceptAfterRevoke: false },
      baseline: { active: "active", revoked: "revoked" },
      provider: { called: false, reason: "e2e_network_denied" },
      cleanup: { rawTokensExposed: false, rawHashesExposed: false, rawProviderIdsExposed: false, piiExposed: false },
    };
  } finally {
    const rows = await readAllWorkspaceMembers(env).catch(() => [] as WorkspaceMemberRow[]);
    for (const row of rows) {
      if (!BASELINE_IDS.has(row.id) && (createdIds.has(row.id) || RACE_EMAILS.includes(row.invitedEmail as (typeof RACE_EMAILS)[number]) || row.invitedEmail === REMOVED_MEMBER_EMAIL)) {
        createdIds.add(row.id);
      }
    }
    if (createdIds.size > 0) {
      const placeholders = [...createdIds].map(() => "?").join(",");
      await ensureDb(env).prepare(`DELETE FROM workspace_member WHERE owner_user_id = ? AND id IN (${placeholders})`)
        .bind(PERSONA, ...createdIds)
        .run();
    }
  }
}

async function readAllWorkspaceMembers(env: AppEnv) {
  return (await ensureDb(env).prepare(`
    SELECT id, owner_user_id AS ownerUserId, member_user_id AS memberUserId,
           invited_email AS invitedEmail, status, created_at AS createdAt,
           accepted_at AS acceptedAt, token_expires_at AS tokenExpiresAt,
           revoked_at AS revokedAt
      FROM workspace_member WHERE owner_user_id = ? ORDER BY created_at ASC
  `).bind(PERSONA).all<WorkspaceMemberRow>()).results ?? [];
}

async function hasNullTokenHash(env: AppEnv, id: string) {
  const row = await ensureDb(env).prepare("SELECT token_hash AS tokenHash FROM workspace_member WHERE id = ? LIMIT 1").bind(id).first<{ tokenHash: string | null }>();
  return row?.tokenHash === null;
}

async function claimReplayAction(env: AppEnv, mapping: J6TeamReplayMapping, metadata: { userId: string; runId: string; idempotencyKey: string }) {
  const db = ensureDb(env);
  const processingToken = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db.prepare(`
    INSERT INTO e2e_j6_replay (idempotency_key, action, user_id, run_id, status, processing_token, result_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'started', ?, NULL, ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).bind(metadata.idempotencyKey, REPLAY_ACTION, mapping.userId, mapping.runId, processingToken, timestamp, timestamp).run();
  let row = await readReplayState(env, metadata.idempotencyKey);
  if (!row || row.action !== REPLAY_ACTION || row.user_id !== metadata.userId || row.run_id !== metadata.runId) throw new Error("replay_identity_conflict");
  if (row.status === "succeeded") return { replayed: true as const, processingToken: row.processing_token, result: parseReplayResult(row.result_json) };
  if (row.processing_token === processingToken) return { replayed: false as const, processingToken };
  const staleBefore = new Date(Date.now() - 30_000).toISOString();
  const reclaimed = await db.prepare(`UPDATE e2e_j6_replay SET processing_token = ?, updated_at = ? WHERE idempotency_key = ? AND status = 'started' AND processing_token = ? AND updated_at <= ?`)
    .bind(processingToken, timestamp, metadata.idempotencyKey, row.processing_token, staleBefore).run();
  if (Number(reclaimed.meta?.changes ?? 0) !== 1) throw new J6TeamReplayInProgressError();
  row = await readReplayState(env, metadata.idempotencyKey);
  if (row?.processing_token !== processingToken) throw new Error("replay_reclaim_failed");
  return { replayed: false as const, processingToken };
}

async function completeReplayAction(env: AppEnv, idempotencyKey: string, processingToken: string, result: Record<string, unknown>) {
  const resultJson = JSON.stringify(result);
  if (resultJson.length > 8_192) throw new Error("replay_result_too_large");
  const completed = await ensureDb(env).prepare(`UPDATE e2e_j6_replay SET status = 'succeeded', result_json = ?, updated_at = ? WHERE idempotency_key = ? AND status = 'started' AND processing_token = ?`)
    .bind(resultJson, new Date().toISOString(), idempotencyKey, processingToken).run();
  if (Number(completed.meta?.changes ?? 0) !== 1) throw new Error("replay_completion_lost");
}

async function readReplayState(env: AppEnv, idempotencyKey: string) {
  return ensureDb(env).prepare("SELECT action, user_id, run_id, status, processing_token, result_json, updated_at FROM e2e_j6_replay WHERE idempotency_key = ? LIMIT 1").bind(idempotencyKey).first<ReplayRow>();
}

function parseReplayResult(value: string | null) {
  if (!value || value.length > 8_192) throw new Error("invalid_replay_result");
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_replay_result");
  return parsed as Record<string, unknown>;
}

function fixtureCookie(request: Request) {
  const values = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith("f9_e2e_fixture="));
  if (values.length !== 1) return null;
  try { return decodeURIComponent(values[0]!.slice("f9_e2e_fixture=".length)); } catch { return null; }
}

function ensureDb(env: AppEnv) {
  if (!env.DB) throw new Error("missing_db");
  return env.DB;
}

class J6TeamReplayInProgressError extends Error {
  constructor() { super("j6_team_replay_in_progress"); this.name = "J6TeamReplayInProgressError"; }
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function notFound() {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}
