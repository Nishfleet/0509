import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { AppEnv } from "~/lib/env.server";
import { stableStringify } from "~/lib/normalize";

const J4_USER_ID = "e2e-agency";
const J4_API_KEY_ID = "e2e-api-key-agency";
const J4_REPORT_ID = "watchlist:e2e-watchlist-agency-1";
const J4_WATCHLIST_ID = "e2e-watchlist-agency-1";
const J4_REPLAY_VIEWPORTS = ["375x812", "768x900", "1440x900"] as const;

type J4ReplayAction = "report_share" | "client_room" | "batch_failure" | "approval_stale";

interface J4ReplayMapping {
  action: J4ReplayAction;
  userId: string;
  runId: string;
  viewport: (typeof J4_REPLAY_VIEWPORTS)[number];
}

interface J4ReplayStateRow {
  action: J4ReplayAction;
  user_id: string;
  run_id: string;
  status: "started" | "succeeded";
  processing_token: string;
  result_json: string | null;
  updated_at: string;
}

interface AgentAuditStateRow {
  status: "started" | "succeeded" | "failed";
  api_key_id: string;
  action_name: string;
  resource_type: string | null;
  resource_id: string | null;
  result_json: string | null;
  error_code: string | null;
  metadata_json: string | null;
}

interface ShareStateRow {
  user_id: string;
  resource_type: string;
  resource_id: string;
  is_snapshot: number | string;
  snapshot_payload_json: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

interface RoomResourceStateRow {
  user_id: string;
  resource_type: string;
  resource_id: string;
}

const J4_REPLAY_ACTIONS: Readonly<Record<string, J4ReplayMapping>> = Object.freeze(
  Object.fromEntries(
    J4_REPLAY_VIEWPORTS.flatMap((viewport) =>
      (["report-share", "client-room", "batch-failure", "approval-stale"] as const).map((key) => [
        `e2e-j4-${key}-${viewport}`,
        {
          action: key.replaceAll("-", "_") as J4ReplayAction,
          userId: J4_USER_ID,
          runId: `e2e-run-j4-${key}-${viewport}`,
          viewport,
        },
      ]),
    ),
  ),
);

export function resolveJ4ReplayAction(idempotencyKey: string, userId: string, runId: string) {
  const resolved = J4_REPLAY_ACTIONS[idempotencyKey];
  return resolved?.userId === userId && resolved.runId === runId
    ? resolved.action
    : null;
}

export function resolveJ4ReplayStateRequest(request: Request) {
  if (request.method !== "GET" || request.headers.get("x-0509-e2e-test-mode") !== "1") {
    return null;
  }
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
    url.origin !== `http://127.0.0.1:${port}`
  ) {
    return null;
  }
  const queryKeys = [...url.searchParams.keys()].sort();
  if (queryKeys.length !== 2 || queryKeys[0] !== "idempotencyKey" || queryKeys[1] !== "runId") {
    return null;
  }
  const idempotencyKey = url.searchParams.get("idempotencyKey") ?? "";
  const runId = url.searchParams.get("runId") ?? "";
  const mapping = J4_REPLAY_ACTIONS[idempotencyKey];
  if (!mapping || mapping.runId !== runId) return null;

  const fixtureUsers = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("f9_e2e_fixture="))
    .map((part) => {
      try {
        return decodeURIComponent(part.slice("f9_e2e_fixture=".length));
      } catch {
        return "";
      }
    });
  if (fixtureUsers.length !== 1 || fixtureUsers[0] !== mapping.userId) return null;
  return { idempotencyKey, ...mapping };
}

export async function action({ context, request }: ActionFunctionArgs) {
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
    testMode: {
      enabled: testModeEnabled,
      sentinel: networkDeny.enabled && networkDeny.failClosed,
    },
  });
  if (!guarded.ok || guarded.metadata.scenario !== "j4") return notFound();

  const mapping = J4_REPLAY_ACTIONS[guarded.metadata.idempotencyKey];
  if (
    !mapping ||
    mapping.userId !== guarded.metadata.userId ||
    mapping.runId !== guarded.metadata.runId ||
    !env.DB
  ) {
    return notFound();
  }

  const replayEnv = sanitizeE2EProviderEnv(env);
  try {
    const claim = await claimReplayAction(replayEnv, mapping.action, guarded.metadata);
    if (claim.replayed) {
      return noStoreJson({ ok: true, replayed: true, ...claim.result });
    }
    const result = await runJ4ReplayAction(
      replayEnv,
      mapping,
      guarded.metadata.idempotencyKey,
      guarded.metadata.runId,
      guarded.metadata.origin,
    );
    await completeReplayAction(
      replayEnv,
      guarded.metadata.idempotencyKey,
      claim.processingToken,
      result,
    );
    return noStoreJson({ ok: true, replayed: false, ...result });
  } catch {
    return noStoreJson({ ok: false, blocker: "j4_replay_failed" }, 503);
  }
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const identity = resolveJ4ReplayStateRequest(request);
  if (!identity) return notFound();
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const [{ resolveE2EProviderDeny, sanitizeE2EProviderEnv }, { isE2ETestRequestEnabled }] =
    await Promise.all([
      import("~/lib/e2e-provider.server"),
      import("~/lib/e2e-auth.server"),
    ]);
  const networkDeny = await resolveE2EProviderDeny(env, request);
  const testModeEnabled = await isE2ETestRequestEnabled(env, request);
  if (
    !env.DB ||
    !networkDeny.enabled ||
    !networkDeny.failClosed ||
    !testModeEnabled
  ) {
    return notFound();
  }

  try {
    const state = await readPublicReplayState(
      sanitizeE2EProviderEnv(env),
      identity,
    );
    return state ? noStoreJson({ ok: true, ...state }) : notFound();
  } catch {
    return noStoreJson({ ok: false, blocker: "j4_state_failed" }, 503);
  }
}

async function runJ4ReplayAction(
  env: AppEnv,
  mapping: J4ReplayMapping,
  routeKey: string,
  runId: string,
  origin: string,
) {
  if (mapping.action === "approval_stale") {
    return invalidateBrowserRoomApproval(env, mapping, runId);
  }
  if (mapping.action === "batch_failure") {
    return runBatchFailureProbe(env, routeKey, runId);
  }

  const { AgentActionIdempotencyConflictError } = await import("~/lib/agent-actions.server");
  const {
    buildAgentActionRequestFingerprint,
    runCustomerAgentAction,
  } = await import("~/lib/customer-agent-actions.server");
  const internalKey = `${routeKey}-agent`;
  const baseContext = {
    userId: J4_USER_ID,
    apiKeyId: J4_API_KEY_ID,
    idempotencyKey: internalKey,
    source: "api_v1" as const,
    origin,
  };
  const input = buildJ4CustomerActionInput(mapping, runId);
  const actionName = mapping.action === "report_share" ? "report.share" : "client_room.upsert";
  const expectedFingerprint = buildAgentActionRequestFingerprint(actionName, input);
  const invoke = () => runCustomerAgentAction(env, baseContext, actionName, input);
  const concurrent = await Promise.allSettled([invoke(), invoke()]);
  const final = await invoke();
  const fulfilled = concurrent.find((entry) => entry.status === "fulfilled");
  if (
    !final.replayed ||
    !fulfilled ||
    stableStringify(fulfilled.value.result) !== stableStringify(final.result)
  ) {
    throw new Error("agent_replay_not_verified");
  }

  const alteredInput = mapping.action === "report_share"
    ? { ...input, e2eConflict: "altered" }
    : { ...input, name: `${input.name} altered` };
  let conflictVerified = false;
  try {
    await runCustomerAgentAction(env, baseContext, actionName, alteredInput);
  } catch (error) {
    conflictVerified = error instanceof AgentActionIdempotencyConflictError;
  }
  if (!conflictVerified) throw new Error("agent_conflict_not_verified");

  const result = final.result;
  if (mapping.action === "report_share") {
    const share = readObject(result.share);
    const id = readNonEmptyString(share?.id);
    const token = readNonEmptyString(share?.token);
    const shareUrl = readNonEmptyString(result.shareUrl);
    if (!id || !token || !shareUrl) throw new Error("invalid_agent_share_result");
    const effect = await verifyStoredAgentEffect(env, {
      action: mapping.action,
      internalKey,
      expectedFingerprint,
      expectedResult: result,
      resourceId: J4_REPORT_ID,
      effectId: id,
    });
    if (!effect) throw new Error("agent_share_effect_not_verified");
    return {
      action: mapping.action,
      agentReplayVerified: true,
      conflictVerified,
      share: { id, token, shareUrl },
      provider: { called: false, reason: "e2e_network_denied" },
    };
  }

  const room = readObject(result.room);
  const id = readNonEmptyString(room?.id);
  if (!id) throw new Error("invalid_agent_room_result");
  const effect = await verifyStoredAgentEffect(env, {
    action: mapping.action,
    internalKey,
    expectedFingerprint,
    expectedResult: result,
    resourceId: id,
    effectId: id,
  });
  if (!effect) throw new Error("agent_room_effect_not_verified");
  return {
    action: mapping.action,
    agentReplayVerified: true,
    conflictVerified,
    room: { id },
    provider: { called: false, reason: "e2e_network_denied" },
  };
}

async function invalidateBrowserRoomApproval(
  env: AppEnv,
  mapping: J4ReplayMapping,
  runId: string,
) {
  const createdRoomReplay = await readReplayState(
    env,
    `e2e-j4-client-room-${mapping.viewport}`,
  );
  const createdRoomResult = parseBoundedObject(
    createdRoomReplay?.status === "succeeded"
      ? createdRoomReplay.result_json
      : null,
  );
  const roomId = readNonEmptyString(
    readObject(createdRoomResult?.room)?.id,
  );
  if (!roomId) throw new Error("browser_room_replay_missing");
  const roomName = `E2E approval recovery room ${mapping.viewport}`;
  const db = ensureDb(env);
  const room = await db.prepare(
    `SELECT id, notes_json
     FROM client_room
     WHERE id = ? AND user_id = ? AND name = ? AND status = 'active'
     LIMIT 1`,
  ).bind(roomId, J4_USER_ID, roomName).first<{ id: string; notes_json: string }>();
  if (!room) throw new Error("browser_room_not_found");
  const notes = parseBoundedObject(room.notes_json);
  const approvals = readObject(notes?.reportApprovals);
  const approval = readObject(approvals?.[J4_REPORT_ID]);
  if (!notes || !approvals || !approval) throw new Error("browser_room_approval_missing");
  const nextNotes = {
    ...notes,
    e2eRunId: runId,
    reportApprovals: {
      ...approvals,
      [J4_REPORT_ID]: {
        ...approval,
        evidenceFingerprint: "e2e-j4-stale-evidence",
      },
    },
  };
  const updated = await db.prepare(
    `UPDATE client_room
     SET notes_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND name = ? AND notes_json = ?`,
  ).bind(
    JSON.stringify(nextNotes),
    new Date().toISOString(),
    room.id,
    J4_USER_ID,
    roomName,
    room.notes_json,
  ).run();
  if (Number(updated.meta?.changes ?? 0) !== 1) throw new Error("browser_room_approval_race");
  return {
    action: "approval_stale" as const,
    approvalInvalidated: true,
    room: { id: room.id },
    provider: { called: false, reason: "e2e_network_denied" },
  };
}

async function runBatchFailureProbe(env: AppEnv, routeKey: string, runId: string) {
  const { runAtomicAgentAction } = await import("~/lib/agent-actions.server");
  const internalKey = `${routeKey}-agent`;
  let aborted = false;
  try {
    await runAtomicAgentAction(
      env,
      {
        userId: J4_USER_ID,
        apiKeyId: J4_API_KEY_ID,
        actionName: "share.create",
        idempotencyKey: internalKey,
        metadata: { source: "e2e", e2eRunId: runId },
      },
      {
        requestFingerprint: `e2e-j4-batch-failure:${routeKey}`,
        prepare: (db) => ({
          statement: db
            .prepare("UPDATE agent_action_audit SET updated_at = updated_at WHERE id = ?")
            .bind("e2e-j4-required-zero-change"),
          result: { ok: true },
        }),
      },
    );
  } catch {
    aborted = true;
  }
  const audit = await readAgentAudit(env, internalKey, "share.create");
  if (!aborted || audit?.status !== "failed" || audit.result_json !== null) {
    throw new Error("atomic_batch_failure_not_verified");
  }
  return {
    action: "batch_failure" as const,
    atomicBatchAborted: true,
    provider: { called: false, reason: "e2e_network_denied" },
  };
}

async function readPublicReplayState(
  env: AppEnv,
  identity: J4ReplayMapping & { idempotencyKey: string },
) {
  const replay = await readReplayState(env, identity.idempotencyKey);
  if (
    !replay ||
    replay.action !== identity.action ||
    replay.user_id !== identity.userId ||
    replay.run_id !== identity.runId ||
    replay.status !== "succeeded"
  ) {
    return null;
  }
  if (identity.action === "approval_stale") {
    const replayResult = parseBoundedObject(replay.result_json);
    const roomId = readNonEmptyString(readObject(replayResult?.room)?.id);
    if (!roomId) return null;
    const room = await ensureDb(env).prepare(
      `SELECT user_id, name, notes_json
       FROM client_room WHERE id = ? AND user_id = ? LIMIT 1`,
    ).bind(roomId, identity.userId).first<{ user_id: string; name: string; notes_json: string }>();
    const refs = await ensureDb(env).prepare(
      `SELECT user_id, resource_type, resource_id
       FROM client_room_resource WHERE room_id = ?
       ORDER BY resource_type, resource_id`,
    ).bind(roomId).all<RoomResourceStateRow>();
    const expectedRefs = [
      { user_id: J4_USER_ID, resource_type: "report", resource_id: J4_REPORT_ID },
      { user_id: J4_USER_ID, resource_type: "watchlist", resource_id: J4_WATCHLIST_ID },
    ];
    const notes = parseBoundedObject(room?.notes_json ?? null);
    const approval = readObject(readObject(notes?.reportApprovals)?.[J4_REPORT_ID]);
    const approvalInvalidated = approval?.evidenceFingerprint === "e2e-j4-stale-evidence";
    if (
      !room ||
      room.user_id !== J4_USER_ID ||
      room.name !== `E2E approval recovery room ${identity.viewport}` ||
      stableStringify(refs.results ?? []) !== stableStringify(expectedRefs) ||
      !approvalInvalidated
    ) return null;
    return {
      runId: identity.runId,
      idempotencyKey: identity.idempotencyKey,
      action: identity.action,
      replayStatus: replay.status,
      effects: {
        auditCount: 0,
        auditStatus: null,
        auditAction: null,
        auditResourceType: null,
        auditResourceId: null,
        requestFingerprintPresent: false,
        resultPresent: true,
        shareCount: 0,
        activeShareCount: 0,
        roomCount: 1,
        roomResourceCount: 2,
        approvalInvalidated,
      },
      provider: { called: false, reason: "e2e_network_denied" },
    };
  }
  const internalKey = `${identity.idempotencyKey}-agent`;
  const auditAction = identity.action === "client_room" ? "client_room.upsert" : identity.action === "report_share" ? "report.share" : "share.create";
  const audit = await readAgentAudit(env, internalKey, auditAction);
  if (!audit) return null;
  if (identity.action === "batch_failure") {
    const metadata = parseBoundedObject(audit.metadata_json);
    const expectedFingerprint = `e2e-j4-batch-failure:${identity.idempotencyKey}`;
    if (
      audit.status !== "failed" ||
      audit.api_key_id !== J4_API_KEY_ID ||
      audit.action_name !== "share.create" ||
      audit.resource_type !== null ||
      audit.resource_id !== null ||
      audit.result_json !== null ||
      audit.error_code !== "atomic_batch_failed" ||
      metadata?.requestFingerprint !== expectedFingerprint ||
      metadata.source !== "e2e" ||
      metadata.e2eRunId !== identity.runId
    ) {
      return null;
    }
    return {
      runId: identity.runId,
      idempotencyKey: identity.idempotencyKey,
      action: identity.action,
      replayStatus: replay.status,
      effects: {
        auditCount: 1,
        auditStatus: audit.status,
        auditAction: audit.action_name,
        auditResourceType: null,
        auditResourceId: null,
        requestFingerprintPresent: true,
        resultPresent: false,
        shareCount: 0,
        activeShareCount: 0,
        roomCount: 0,
        roomResourceCount: 0,
      },
      provider: { called: false, reason: "e2e_network_denied" },
    };
  }

  const replayResult = parseBoundedObject(replay.result_json);
  const actionResult = identity.action === "report_share"
    ? readObject(replayResult?.share)
    : readObject(replayResult?.room);
  const effectId = readNonEmptyString(actionResult?.id);
  const provider = readObject(replayResult?.provider);
  if (
    !effectId ||
    replayResult?.action !== identity.action ||
    replayResult.agentReplayVerified !== true ||
    replayResult.conflictVerified !== true ||
    provider?.called !== false ||
    provider.reason !== "e2e_network_denied"
  ) return null;
  const { buildAgentActionRequestFingerprint } = await import("~/lib/customer-agent-actions.server");
  const input = buildJ4CustomerActionInput(identity, identity.runId);
  const expectedFingerprint = buildAgentActionRequestFingerprint(auditAction, input);
  const effect = await verifyStoredAgentEffect(env, {
    action: identity.action,
    internalKey,
    expectedFingerprint,
    resourceId: identity.action === "report_share" ? J4_REPORT_ID : effectId,
    effectId,
  });
  if (!effect) return null;
  const auditProjection = identity.action === "report_share"
    ? readObject(effect.auditResult.share)
    : readObject(effect.auditResult.room);
  if (
    readNonEmptyString(auditProjection?.id) !== effectId ||
    (identity.action === "report_share" && (
      readNonEmptyString(auditProjection?.token) !== readNonEmptyString(actionResult?.token) ||
      readNonEmptyString(effect.auditResult.shareUrl) !== readNonEmptyString(actionResult?.shareUrl)
    ))
  ) return null;
  return {
    runId: identity.runId,
    idempotencyKey: identity.idempotencyKey,
    action: identity.action,
    replayStatus: replay.status,
    effects: {
      auditCount: 1,
      auditStatus: effect.audit.status,
      auditAction: effect.audit.action_name,
      auditResourceType: effect.audit.resource_type,
      auditResourceId: effect.audit.resource_id,
      requestFingerprintPresent: true,
      resultPresent: true,
      shareCount: effect.shareCount,
      activeShareCount: effect.activeShareCount,
      roomCount: effect.roomCount,
      roomResourceCount: effect.roomResourceCount,
    },
    provider: { called: false, reason: "e2e_network_denied" },
  };
}

function buildJ4CustomerActionInput(mapping: Pick<J4ReplayMapping, "action" | "viewport">, runId: string) {
  return mapping.action === "report_share"
    ? { reportId: J4_REPORT_ID, reviewed: true }
    : {
        name: `E2E approval recovery room ${mapping.viewport}`,
        clientLabel: "E2E client",
        status: "active",
        notes: {
          e2eRunId: runId,
          purpose: "approval recovery",
          goal: "Review current competitor evidence before client delivery.",
          cadence: "Weekly",
          tone: "Direct and evidence-led",
        },
        resourceRefs: [
          { resourceType: "watchlist", resourceId: J4_WATCHLIST_ID, label: "Tracked evidence" },
          { resourceType: "report", resourceId: J4_REPORT_ID, label: "Reviewed report" },
        ],
      };
}

async function verifyStoredAgentEffect(
  env: AppEnv,
  input: {
    action: "report_share" | "client_room";
    internalKey: string;
    expectedFingerprint: string;
    expectedResult?: Record<string, unknown>;
    resourceId: string;
    effectId: string;
  },
) {
  const actionName = input.action === "report_share" ? "report.share" : "client_room.upsert";
  const audit = await readAgentAudit(env, input.internalKey, actionName);
  const metadata = parseBoundedObject(audit?.metadata_json ?? null);
  const auditResult = parseBoundedObject(audit?.result_json ?? null, 128 * 1_024);
  if (
    !audit ||
    audit.status !== "succeeded" ||
    audit.api_key_id !== J4_API_KEY_ID ||
    audit.action_name !== actionName ||
    audit.resource_type !== (input.action === "report_share" ? "report" : "client_room") ||
    audit.resource_id !== input.resourceId ||
    audit.error_code !== null ||
    !auditResult ||
    metadata?.source !== "api_v1" ||
    metadata.requestFingerprint !== input.expectedFingerprint ||
    (input.expectedResult && stableStringify(auditResult) !== stableStringify(input.expectedResult))
  ) {
    return null;
  }
  const auditCount = await ensureDb(env).prepare(
    `SELECT COUNT(*) AS count FROM agent_action_audit
     WHERE user_id = ? AND api_key_id = ? AND idempotency_key = ? AND action_name = ?`,
  ).bind(J4_USER_ID, J4_API_KEY_ID, input.internalKey, actionName).first<{ count: number }>();
  if (Number(auditCount?.count ?? 0) !== 1) return null;

  if (input.action === "report_share") {
    const share = await ensureDb(env).prepare(
      `SELECT user_id, resource_type, resource_id, is_snapshot,
              snapshot_payload_json, revoked_at, expires_at
       FROM share_link WHERE id = ? LIMIT 1`,
    ).bind(input.effectId).first<ShareStateRow>();
    const snapshot = parseBoundedObject(share?.snapshot_payload_json ?? null, 256 * 1_024);
    const { isApprovedReportSnapshot } = await import("~/lib/report-approval");
    if (
      !share ||
      share.user_id !== J4_USER_ID ||
      share.resource_type !== "report" ||
      share.resource_id !== J4_REPORT_ID ||
      Number(share.is_snapshot) !== 1 ||
      share.revoked_at !== null ||
      (share.expires_at !== null && Date.parse(share.expires_at) <= Date.now()) ||
      !snapshot ||
      !isApprovedReportSnapshot(snapshot)
    ) {
      return null;
    }
    return {
      audit,
      auditResult,
      shareCount: 1,
      activeShareCount: 1,
      roomCount: 0,
      roomResourceCount: 0,
    };
  }

  const room = await ensureDb(env).prepare(
    "SELECT user_id FROM client_room WHERE id = ? LIMIT 1",
  ).bind(input.effectId).first<{ user_id: string }>();
  const refs = await ensureDb(env).prepare(
    `SELECT user_id, resource_type, resource_id
     FROM client_room_resource WHERE room_id = ?
     ORDER BY resource_type, resource_id`,
  ).bind(input.effectId).all<RoomResourceStateRow>();
  const expectedRefs = [
    { user_id: J4_USER_ID, resource_type: "report", resource_id: J4_REPORT_ID },
    { user_id: J4_USER_ID, resource_type: "watchlist", resource_id: J4_WATCHLIST_ID },
  ];
  if (
    room?.user_id !== J4_USER_ID ||
    stableStringify(refs.results ?? []) !== stableStringify(expectedRefs)
  ) {
    return null;
  }
  return {
    audit,
    auditResult,
    shareCount: 0,
    activeShareCount: 0,
    roomCount: 1,
    roomResourceCount: 2,
  };
}

async function claimReplayAction(
  env: AppEnv,
  actionName: J4ReplayAction,
  metadata: { userId: string; runId: string; idempotencyKey: string },
) {
  const db = ensureDb(env);
  const processingToken = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db.prepare(
    `INSERT INTO e2e_j4_replay (
       idempotency_key, action, user_id, run_id, status, processing_token,
       result_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'started', ?, NULL, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`,
  ).bind(
    metadata.idempotencyKey,
    actionName,
    metadata.userId,
    metadata.runId,
    processingToken,
    timestamp,
    timestamp,
  ).run();

  let row = await readReplayState(env, metadata.idempotencyKey);
  if (
    !row ||
    row.action !== actionName ||
    row.user_id !== metadata.userId ||
    row.run_id !== metadata.runId
  ) {
    throw new Error("replay_identity_conflict");
  }
  if (row.status === "succeeded") {
    return {
      replayed: true as const,
      processingToken: row.processing_token,
      result: parseBoundedObject(row.result_json) ?? {},
    };
  }
  if (row.processing_token === processingToken) {
    return { replayed: false as const, processingToken, result: null };
  }
  const staleBefore = new Date(Date.now() - 30_000).toISOString();
  const reclaimed = await db.prepare(
    `UPDATE e2e_j4_replay
     SET processing_token = ?, updated_at = ?
     WHERE idempotency_key = ?
       AND status = 'started'
       AND processing_token = ?
       AND updated_at <= ?`,
  ).bind(
    processingToken,
    timestamp,
    metadata.idempotencyKey,
    row.processing_token,
    staleBefore,
  ).run();
  if (Number(reclaimed.meta?.changes ?? 0) !== 1) throw new Error("replay_in_progress");
  row = await readReplayState(env, metadata.idempotencyKey);
  if (row?.processing_token !== processingToken) throw new Error("replay_reclaim_failed");
  return { replayed: false as const, processingToken, result: null };
}

async function completeReplayAction(
  env: AppEnv,
  idempotencyKey: string,
  processingToken: string,
  result: Record<string, unknown>,
) {
  const resultJson = JSON.stringify(result);
  if (resultJson.length > 8_192) throw new Error("replay_result_too_large");
  const completed = await ensureDb(env).prepare(
    `UPDATE e2e_j4_replay
     SET status = 'succeeded', result_json = ?, updated_at = ?
     WHERE idempotency_key = ?
       AND status = 'started'
       AND processing_token = ?`,
  ).bind(resultJson, new Date().toISOString(), idempotencyKey, processingToken).run();
  if (Number(completed.meta?.changes ?? 0) !== 1) throw new Error("replay_completion_lost");
}

async function readReplayState(env: AppEnv, idempotencyKey: string) {
  return ensureDb(env).prepare(
    `SELECT action, user_id, run_id, status, processing_token, result_json, updated_at
     FROM e2e_j4_replay WHERE idempotency_key = ? LIMIT 1`,
  ).bind(idempotencyKey).first<J4ReplayStateRow>();
}

async function readAgentAudit(env: AppEnv, idempotencyKey: string, actionName: string) {
  return ensureDb(env).prepare(
    `SELECT status, api_key_id, action_name, resource_type, resource_id, result_json, error_code, metadata_json
     FROM agent_action_audit
     WHERE user_id = ? AND api_key_id = ? AND idempotency_key = ? AND action_name = ?
     LIMIT 1`,
  ).bind(J4_USER_ID, J4_API_KEY_ID, idempotencyKey, actionName).first<AgentAuditStateRow>();
}

function parseBoundedObject(value: string | null, maxBytes = 8_192) {
  if (!value || value.length > maxBytes) return null;
  try {
    return readObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function ensureDb(env: AppEnv) {
  if (!env.DB) throw new Error("missing_db");
  return env.DB;
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function notFound() {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}
