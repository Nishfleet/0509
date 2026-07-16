import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { AppEnv } from "~/lib/env.server";

const J6_PERSONA = "e2e-support-recovery";
const J6_CASE_ID = "e2e-support-recovery-case";
const J6_ATTEMPT_KEY = `support-case:${J6_CASE_ID}`;
const J6_PROVIDER = "cloudflare_email";
const J6_PAYLOAD = Object.freeze({
  kind: "support_case_operator_alert",
  caseId: J6_CASE_ID,
});
const J6_VIEWPORTS = ["375x812", "768x900", "1440x900"] as const;

export type J6ReplayOutcome = "failure" | "recovery";
type J6Viewport = (typeof J6_VIEWPORTS)[number];

export interface J6ReplayMapping {
  outcome: J6ReplayOutcome;
  userId: typeof J6_PERSONA;
  runId: string;
  viewport: J6Viewport;
  caseId: typeof J6_CASE_ID;
}

interface J6ReplayStateRow {
  action: J6ReplayOutcome;
  user_id: string;
  run_id: string;
  status: "started" | "succeeded";
  processing_token: string;
  result_json: string | null;
  updated_at: string;
}

const J6_REPLAY_ACTIONS: Readonly<Record<string, J6ReplayMapping>> = Object.freeze(
  Object.fromEntries(
    J6_VIEWPORTS.flatMap((viewport) =>
      (["failure", "recovery"] as const).map((outcome) => {
        const key = `e2e-j6-support-${outcome}-${viewport}`;
        return [key, {
          outcome,
          userId: J6_PERSONA,
          runId: `e2e-run-j6-support-${outcome}-${viewport}`,
          viewport,
          caseId: J6_CASE_ID,
        } satisfies J6ReplayMapping];
      }),
    ),
  ),
);

export function resolveJ6ReplayMapping(
  idempotencyKey: string,
  userId: string,
  runId: string,
) {
  const mapping = J6_REPLAY_ACTIONS[idempotencyKey];
  return mapping?.userId === userId && mapping.runId === runId ? mapping : null;
}

export function resolveJ6ReplayAction(
  idempotencyKey: string,
  userId: string,
  runId: string,
) {
  return resolveJ6ReplayMapping(idempotencyKey, userId, runId)?.outcome ?? null;
}

export function resolveJ6ReplayStateRequest(request: Request) {
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
    url.pathname !== "/api/e2e/support/state" ||
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
  const mapping = resolveJ6ReplayMapping(idempotencyKey, J6_PERSONA, runId);
  if (!mapping || fixtureCookie(request) !== J6_PERSONA) return null;
  return { idempotencyKey, ...mapping };
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/api/e2e/support/replay") {
    return notFound();
  }

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
  if (!guarded.ok || guarded.metadata.scenario !== "j6" || !env.DB) return notFound();

  const mapping = resolveJ6ReplayMapping(
    guarded.metadata.idempotencyKey,
    guarded.metadata.userId,
    guarded.metadata.runId,
  );
  if (!mapping) return notFound();

  try {
    const claim = await claimReplayAction(sanitizeE2EProviderEnv(env), mapping, guarded.metadata);
    if (claim.replayed) {
      return noStoreJson({ ok: true, replayed: true, ...claim.result });
    }
    const result = await runJ6ReplayAction(sanitizeE2EProviderEnv(env), mapping, guarded.metadata.clock);
    await completeReplayAction(
      sanitizeE2EProviderEnv(env),
      guarded.metadata.idempotencyKey,
      claim.processingToken,
      result,
    );
    return noStoreJson({ ok: true, replayed: false, ...result });
  } catch (error) {
    if (error instanceof J6ReplayInProgressError) {
      return noStoreJson({ ok: false, blocker: "j6_replay_in_progress" }, 409);
    }
    return noStoreJson({ ok: false, blocker: "j6_replay_failed" }, 503);
  }
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const identity = resolveJ6ReplayStateRequest(request);
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
    const state = await readPublicReplayState(sanitizeE2EProviderEnv(env), identity);
    return state ? noStoreJson({ ok: true, ...state }) : notFound();
  } catch {
    return noStoreJson({ ok: false, blocker: "j6_state_failed" }, 503);
  }
}

async function runJ6ReplayAction(env: AppEnv, mapping: J6ReplayMapping, clock: string) {
  const data = await import("~/lib/data.server");
  const supportCase = await data.getSupportCase(env, J6_PERSONA, mapping.caseId);
  if (!supportCase || supportCase.status !== "open") throw new Error("support_case_unavailable");

  const existing = await data.getDeliveryAttemptByIdempotencyKey(env, J6_ATTEMPT_KEY);
  if (mapping.outcome === "failure" && existing?.status === "sent") {
    return buildResult(mapping, supportCase.status, existing.status, existing.webhookStatus, true);
  }
  if (mapping.outcome === "recovery" && existing?.status === "sent") {
    return buildResult(mapping, supportCase.status, existing.status, existing.webhookStatus, true);
  }
  if (mapping.outcome === "recovery" && (!existing || existing.status !== "failed")) {
    throw new Error("support_failure_not_recorded");
  }

  const claim = await data.claimInstantDeliveryAttempt(env, {
    userId: J6_PERSONA,
    watchlistId: null,
    deliveryTargetId: null,
    lane: "internal",
    channel: "email",
    provider: J6_PROVIDER,
    targetValue: "support-internal",
    templateName: "operator_alert",
    eventIds: [],
    payloadSnapshot: J6_PAYLOAD,
    idempotencyKey: J6_ATTEMPT_KEY,
  });
  if (!claim.attemptId || !claim.claimUpdatedAt) {
    if (claim.duplicate?.status === "sent") {
      return buildResult(mapping, supportCase.status, claim.duplicate.status, claim.duplicate.webhookStatus, true);
    }
    throw new Error("support_attempt_claim_failed");
  }

  const finalStatus = mapping.outcome === "failure" ? "failed" : "sent";
  const finalWebhook = mapping.outcome === "failure" ? "failed" : "delivered";
  const finalized = await data.updateDeliveryAttemptResult(env, claim.attemptId, {
    provider: J6_PROVIDER,
    status: finalStatus,
    webhookStatus: finalWebhook,
    providerMessageId: null,
    providerStatusLastSeenAt: null,
    errorMessage: null,
    sentAt: mapping.outcome === "recovery" ? clock : null,
    failedAt: mapping.outcome === "failure" ? clock : null,
    payloadSnapshot: J6_PAYLOAD,
    targetValue: "support-internal",
    expectedStatus: "pending",
    expectedWebhookStatus: "pending",
    expectedUpdatedAt: claim.claimUpdatedAt,
    updatedAt: clock,
  });
  if (!finalized) throw new Error("support_attempt_completion_lost");

  await data.createSupportCaseEvent(env, {
    caseId: J6_CASE_ID,
    userId: J6_PERSONA,
    eventType: mapping.outcome === "failure" ? "support_notification_failed" : "support_notified",
    message: mapping.outcome === "failure"
      ? "Support notification failed safely."
      : "Support notification recovered.",
    visibleToCustomer: true,
    metadata: { delivery: mapping.outcome === "failure" ? "failed" : "sent" },
    idempotencyKey: `support-notification:${J6_CASE_ID}:${mapping.outcome === "failure" ? "failed" : "sent"}`,
  });

  return buildResult(mapping, supportCase.status, finalStatus, finalWebhook, false);
}

function buildResult(
  mapping: J6ReplayMapping,
  caseStatus: string,
  attemptStatus: string,
  webhookStatus: string,
  alreadySent: boolean,
) {
  return {
    scenario: "j6",
    action: "support_notification",
    outcome: mapping.outcome,
    persona: J6_PERSONA,
    viewport: mapping.viewport,
    case: { id: J6_CASE_ID, status: caseStatus },
    attempt: {
      owned: true,
      lane: "internal",
      channel: "email",
      status: attemptStatus,
      webhookStatus,
      provider: J6_PROVIDER,
      casePayloadMatched: true,
    },
    provider: { called: false, reason: "e2e_network_denied" },
    cleanup: { rawProviderIdsExposed: false, rawErrorsExposed: false, piiExposed: false },
    alreadySent,
  };
}

async function readPublicReplayState(env: AppEnv, identity: J6ReplayMapping & { idempotencyKey: string }) {
  const data = await import("~/lib/data.server");
  const replay = await readReplayState(env, identity.idempotencyKey);
  if (!replay || replay.user_id !== J6_PERSONA || replay.run_id !== identity.runId || replay.status !== "succeeded") {
    return null;
  }
  const supportCase = await data.getSupportCase(env, J6_PERSONA, J6_CASE_ID);
  const events = supportCase
    ? await data.listSupportCaseEvents(env, J6_PERSONA, J6_CASE_ID)
    : [];
  const attempt = await data.getDeliveryAttemptByIdempotencyKey(env, J6_ATTEMPT_KEY);
  if (!supportCase || !attempt) return null;
  const payload = attempt.payloadSnapshot;
  return {
    scenario: "j6",
    action: "support_notification",
    outcome: identity.outcome,
    persona: J6_PERSONA,
    viewport: identity.viewport,
    case: { id: J6_CASE_ID, status: supportCase.status },
    events: events.map((event) => ({
      eventType: event.eventType,
      safeMessage: event.message,
      time: event.createdAt,
    })),
    attempt: {
      owned: attempt.userId === J6_PERSONA,
      lane: attempt.lane,
      channel: attempt.channel,
      status: attempt.status,
      webhookStatus: attempt.webhookStatus,
      provider: attempt.provider,
      casePayloadMatched: payload.kind === J6_PAYLOAD.kind && payload.caseId === J6_CASE_ID,
    },
    provider: { called: false, reason: "e2e_network_denied" },
    cleanup: { rawProviderIdsExposed: false, rawErrorsExposed: false, piiExposed: false },
  };
}

export function resolveJ6ReplayClaim(
  row: Pick<J6ReplayStateRow, "status" | "processing_token" | "run_id"> | null,
  processingToken: string,
  runId: string,
) {
  if (!row || row.run_id !== runId) return "invalid" as const;
  if (row.status === "succeeded") return "replayed" as const;
  return row.processing_token === processingToken ? "claimed" as const : "in_progress" as const;
}

export function resolveJ6ReplayCompletion(input: {
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

async function claimReplayAction(env: AppEnv, mapping: J6ReplayMapping, metadata: { userId: string; runId: string; idempotencyKey: string }) {
  const db = ensureDb(env);
  const processingToken = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db.prepare(`
    INSERT INTO e2e_j6_replay (idempotency_key, action, user_id, run_id, status, processing_token, result_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'started', ?, NULL, ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).bind(metadata.idempotencyKey, mapping.outcome, mapping.userId, mapping.runId, processingToken, timestamp, timestamp).run();

  let row = await readReplayState(env, metadata.idempotencyKey);
  if (!row || row.action !== mapping.outcome || row.user_id !== metadata.userId || row.run_id !== metadata.runId) {
    throw new Error("replay_identity_conflict");
  }
  if (row.status === "succeeded") {
    return { replayed: true as const, processingToken: row.processing_token, result: parseReplayResult(row.result_json) };
  }
  if (row.processing_token === processingToken) return { replayed: false as const, processingToken };

  const staleBefore = new Date(Date.now() - 30_000).toISOString();
  const reclaimed = await db.prepare(`
    UPDATE e2e_j6_replay SET processing_token = ?, updated_at = ?
    WHERE idempotency_key = ? AND status = 'started' AND processing_token = ? AND updated_at <= ?
  `).bind(processingToken, timestamp, metadata.idempotencyKey, row.processing_token, staleBefore).run();
  if (Number(reclaimed.meta?.changes ?? 0) !== 1) throw new J6ReplayInProgressError();
  row = await readReplayState(env, metadata.idempotencyKey);
  if (row?.processing_token !== processingToken) throw new Error("replay_reclaim_failed");
  return { replayed: false as const, processingToken };
}

async function completeReplayAction(env: AppEnv, idempotencyKey: string, processingToken: string, result: Record<string, unknown>) {
  const resultJson = JSON.stringify(result);
  if (resultJson.length > 8_192) throw new Error("replay_result_too_large");
  const completed = await ensureDb(env).prepare(`
    UPDATE e2e_j6_replay SET status = 'succeeded', result_json = ?, updated_at = ?
    WHERE idempotency_key = ? AND status = 'started' AND processing_token = ?
  `).bind(resultJson, new Date().toISOString(), idempotencyKey, processingToken).run();
  if (Number(completed.meta?.changes ?? 0) !== 1) throw new Error("replay_completion_lost");
}

async function readReplayState(env: AppEnv, idempotencyKey: string) {
  return ensureDb(env).prepare(`
    SELECT action, user_id, run_id, status, processing_token, result_json, updated_at
    FROM e2e_j6_replay WHERE idempotency_key = ? LIMIT 1
  `).bind(idempotencyKey).first<J6ReplayStateRow>();
}

function parseReplayResult(value: string | null) {
  if (!value || value.length > 8_192) throw new Error("invalid_replay_result");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("invalid_replay_result"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_replay_result");
  return parsed as Record<string, unknown>;
}

function fixtureCookie(request: Request) {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("f9_e2e_fixture="));
  if (values.length !== 1) return null;
  try { return decodeURIComponent(values[0]!.slice("f9_e2e_fixture=".length)); } catch { return null; }
}

class J6ReplayInProgressError extends Error {
  constructor() { super("j6_replay_in_progress"); this.name = "J6ReplayInProgressError"; }
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
