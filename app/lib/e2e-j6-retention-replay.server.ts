import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { alertScheduledTaskFailure } from "~/lib/cron-failure-alert.server";
import {
  E2E_HARNESS_REPLAY_MAX_JSON_BYTES,
  guardE2EHarnessReplayRequest,
} from "~/lib/e2e-harness-guard.server";
import { sanitizeE2EProviderEnv, resolveE2EProviderDeny } from "~/lib/e2e-provider.server";
import type { AppEnv } from "~/lib/env.server";
import { runRetentionSweep } from "~/lib/retention.server";

export const J6_RETENTION_PERSONA = "e2e-starter" as const;
const J6_RETENTION_PATH = "/api/e2e/retention/replay";
const J6_RETENTION_STATE_PATH = "/api/e2e/retention/state";
const J6_RETENTION_STEPS = [
  "discovery_fetch_log",
  "discovery_cache_entry",
  "better_auth_magic_link_ticket",
  "meta_integration_log",
  "watchlist_run",
  "delivery_attempt",
  "landing_page_snapshot",
  "presence_item",
] as const;
export const J6_RETENTION_VIEWPORTS = ["375x812", "768x900", "1440x900"] as const;
export const J6_RETENTION_CACHE_PREFIX = "e2e-j6-retention:";
export const J6_RETENTION_QUERY_PREFIX = "e2e-j6-retention-";
const J6_RETENTION_TASK_KEY = "retention_sweep";

export type J6RetentionOutcome = "failure" | "recovery";
export type J6RetentionViewport = (typeof J6_RETENTION_VIEWPORTS)[number];

export interface J6RetentionReplayMapping {
  outcome: J6RetentionOutcome;
  userId: typeof J6_RETENTION_PERSONA;
  runId: string;
  viewport: J6RetentionViewport;
}

interface J6RetentionReplayStateRow {
  action: J6RetentionOutcome;
  user_id: string;
  run_id: string;
  status: "started" | "succeeded";
  processing_token: string;
  result_json: string | null;
}

const J6_RETENTION_REPLAY_ACTIONS: Readonly<Record<string, J6RetentionReplayMapping>> = Object.freeze(
  Object.fromEntries(
    J6_RETENTION_VIEWPORTS.flatMap((viewport) =>
      (["failure", "recovery"] as const).map((outcome) => {
        const key = `e2e-j6-retention-${outcome}-${viewport}`;
        return [key, {
          outcome,
          userId: J6_RETENTION_PERSONA,
          runId: `e2e-run-j6-retention-${outcome}-${viewport}`,
          viewport,
        } satisfies J6RetentionReplayMapping];
      }),
    ),
  ),
);

export function resolveJ6RetentionReplayMapping(
  idempotencyKey: string,
  userId: string,
  runId: string,
) {
  const mapping = J6_RETENTION_REPLAY_ACTIONS[idempotencyKey];
  return mapping?.userId === userId && mapping.runId === runId ? mapping : null;
}

export function resolveJ6RetentionReplayAction(
  idempotencyKey: string,
  userId: string,
  runId: string,
) {
  return resolveJ6RetentionReplayMapping(idempotencyKey, userId, runId)?.outcome ?? null;
}

// Keep the short names available to route-contract tests that exercise the
// other Journey 6 replay seams.
export const resolveJ6ReplayMapping = resolveJ6RetentionReplayMapping;
export const resolveJ6ReplayAction = resolveJ6RetentionReplayAction;

/** The state seam accepts only the same exact fixture identity as the replay seam. */
export function resolveJ6RetentionStateRequest(request: Request) {
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
    url.pathname !== J6_RETENTION_STATE_PATH
  ) {
    return null;
  }
  const queryKeys = [...url.searchParams.keys()].sort();
  if (queryKeys.length !== 2 || queryKeys[0] !== "idempotencyKey" || queryKeys[1] !== "runId") return null;
  const idempotencyKey = url.searchParams.get("idempotencyKey") ?? "";
  const runId = url.searchParams.get("runId") ?? "";
  if (fixtureCookie(request) !== J6_RETENTION_PERSONA) return null;
  const mapping = resolveJ6RetentionReplayMapping(idempotencyKey, J6_RETENTION_PERSONA, runId);
  return mapping ? { idempotencyKey, ...mapping } : null;
}

export async function action({ context, request }: ActionFunctionArgs) {
  let pathname: string;
  try { pathname = new URL(request.url).pathname; } catch { return notFound(); }
  if (request.method !== "POST" || pathname !== J6_RETENTION_PATH) return notFound();
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const [{ isE2ETestRequestEnabled }] = await Promise.all([import("~/lib/e2e-auth.server")]);
  const networkDeny = await resolveE2EProviderDeny(env, request);
  const testModeEnabled = await isE2ETestRequestEnabled(env, request);
  const guarded = await guardE2EHarnessReplayRequest(request, {
    networkDeny,
    testMode: {
      enabled: testModeEnabled,
      sentinel: networkDeny.enabled && networkDeny.failClosed,
    },
    maxJsonBytes: E2E_HARNESS_REPLAY_MAX_JSON_BYTES,
  });
  if (!guarded.ok || guarded.metadata.scenario !== "j6" || !env.DB) return notFound();

  const mapping = resolveJ6RetentionReplayMapping(
    guarded.metadata.idempotencyKey,
    guarded.metadata.userId,
    guarded.metadata.runId,
  );
  if (!mapping) return notFound();

  const replayEnv = sanitizeE2EProviderEnv(env);
  try {
    const claim = await claimReplayAction(replayEnv, mapping, guarded.metadata);
    if (claim.replayed) return noStoreJson({ ok: true, replayed: true, ...claim.result });
    const result = await executeJ6RetentionReplay(replayEnv, mapping, guarded.metadata.clock);
    await completeReplayAction(replayEnv, guarded.metadata.idempotencyKey, claim.processingToken, result);
    return noStoreJson({ ok: true, replayed: false, ...result });
  } catch (error) {
    if (error instanceof J6ReplayInProgressError) {
      return noStoreJson({ ok: false, blocker: "j6_retention_replay_in_progress" }, 409);
    }
    return noStoreJson({ ok: false, blocker: "j6_retention_replay_failed" }, 503);
  }
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const identity = resolveJ6RetentionStateRequest(request);
  if (!identity) return notFound();
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const [{ isE2ETestRequestEnabled }] = await Promise.all([import("~/lib/e2e-auth.server")]);
  const networkDeny = await resolveE2EProviderDeny(env, request);
  if (!env.DB || !networkDeny.enabled || !networkDeny.failClosed || !(await isE2ETestRequestEnabled(env, request))) {
    return notFound();
  }
  try {
    const replay = await readReplayState(sanitizeE2EProviderEnv(env), identity.idempotencyKey);
    if (!replay || replay.user_id !== J6_RETENTION_PERSONA || replay.run_id !== identity.runId || replay.status !== "succeeded") {
      return notFound();
    }
    return noStoreJson({ ok: true, ...parseReplayResult(replay.result_json) });
  } catch {
    return noStoreJson({ ok: false, blocker: "j6_retention_state_failed" }, 503);
  }
}

/** Runs the production sweep unchanged, adding only a request-local failure seam. */
export async function executeJ6RetentionReplay(
  env: AppEnv,
  mapping: J6RetentionReplayMapping,
  clock: string,
) {
  if (mapping.outcome === "failure") {
    await createRetentionFixture(env, mapping.viewport, clock);
  }
  if (mapping.outcome === "recovery") {
    const failure = await readReplayState(env, `e2e-j6-retention-failure-${mapping.viewport}`);
    if (!failure || failure.action !== "failure" || failure.user_id !== J6_RETENTION_PERSONA || failure.run_id !== `e2e-run-j6-retention-failure-${mapping.viewport}` || failure.status !== "succeeded") {
      throw new Error("retention_failure_not_recorded");
    }
  }
  const fixture = await readFixtureState(env, mapping.viewport);
  if (fixture !== 1) throw new Error("retention_fixture_unavailable");

  const failureProxy = createRetentionDbProxy(env.DB!, mapping.outcome === "failure");
  const sweep = await runRetentionSweep({ ...env, DB: failureProxy }, { now: new Date(clock) });
  if (mapping.outcome === "failure" && (!failureProxy.injectedFailure || JSON.stringify(sweep.failedSteps) !== JSON.stringify(["discovery_cache_entry"]))) {
    throw new Error("retention_failure_injection_not_verified");
  }
  if (mapping.outcome === "recovery" && sweep.failedSteps.length > 0) {
    throw new Error("retention_recovery_failed");
  }

  const completedSteps = J6_RETENTION_STEPS.filter((step) => Object.prototype.hasOwnProperty.call(sweep.deleted, step));
  const expectedCompletedSteps = J6_RETENTION_STEPS.filter((step) => !sweep.failedSteps.includes(step));
  if (expectedCompletedSteps.some((step) => !completedSteps.includes(step))) {
    throw new Error("retention_steps_not_verified");
  }

  const remaining = await readFixtureState(env, mapping.viewport);
  if (mapping.outcome === "recovery" && remaining !== 0) throw new Error("retention_fixture_not_recovered");

  const alert = mapping.outcome === "failure"
    ? await alertScheduledTaskFailure(env, J6_RETENTION_TASK_KEY, new Error("retention_step_failed"), { now: new Date(clock) })
    : { sent: false, reason: "not_needed" as const };
  return {
    scenario: "j6",
    action: "retention_sweep",
    outcome: mapping.outcome,
    persona: J6_RETENTION_PERSONA,
    viewport: mapping.viewport,
    failedSteps: sweep.failedSteps,
    continuedSteps: completedSteps.filter((step) => !sweep.failedSteps.includes(step)),
    deleted: Object.fromEntries(
      completedSteps.map((step) => [step, Number(sweep.deleted[step] ?? 0)]),
    ),
    fixture: {
      rowsBefore: fixture,
      rowsAfter: remaining,
      discoveryCacheDeleted: mapping.outcome === "recovery" ? Math.max(0, fixture - remaining) : 0,
    },
    alert: { sent: alert.sent, reason: alert.reason },
    provider: { called: false, reason: "e2e_network_denied" },
    cleanup: { rawErrorsExposed: false, rawProviderIdsExposed: false, piiExposed: false },
    recoveryRequired: mapping.outcome === "failure",
  };
}

export function createRetentionDbProxy(db: D1Database, failDiscoveryDelete: boolean) {
  let injectedFailure = false;
  const proxy = {
    prepare(sql: string) {
      const prepared = db.prepare(sql);
      return {
        bind(...bindings: unknown[]) {
          const bound = prepared.bind(...bindings);
          return {
            ...bound,
            async run(...args: unknown[]) {
              if (failDiscoveryDelete && !injectedFailure && /^\s*DELETE\s+FROM\s+discovery_cache_entry\b/iu.test(sql)) {
                injectedFailure = true;
                throw new Error("fixture retention delete failure");
              }
              return bound.run(...args as []);
            },
            async all<T>(...args: unknown[]) {
              return bound.all<T>(...args as []);
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return Object.defineProperty(proxy, "injectedFailure", { get: () => injectedFailure }) as D1Database & { readonly injectedFailure: boolean };
}

async function readFixtureState(env: AppEnv, viewport: J6RetentionViewport) {
  const row = await env.DB!.prepare(
    `SELECT COUNT(*) AS count FROM discovery_cache_entry
     WHERE cache_key = ? AND query_fingerprint = ?`,
  )
    .bind(`${J6_RETENTION_CACHE_PREFIX}${viewport}`, `${J6_RETENTION_QUERY_PREFIX}${viewport}`)
    .first<{ count: number | string }>();
  return Number(row?.count ?? 0);
}

async function createRetentionFixture(env: AppEnv, viewport: J6RetentionViewport, clock: string) {
  const now = new Date(clock).getTime();
  if (!Number.isFinite(now)) throw new Error("retention_fixture_clock_invalid");
  const fetchedAt = new Date(now - 32 * 24 * 60 * 60 * 1_000).toISOString();
  const expiresAt = new Date(now - 31 * 24 * 60 * 60 * 1_000).toISOString();
  const inserted = await ensureDb(env).prepare(`
    INSERT INTO discovery_cache_entry (
      cache_key, provider, route_context, query_fingerprint, country, cursor,
      payload_json, fetched_at, expires_at, browser_ms_used, created_at, updated_at
    ) VALUES (?, 'demo', 'scheduled_warmup', ?, 'all', NULL, '{}', ?, ?, 0, ?, ?)
    ON CONFLICT(cache_key) DO NOTHING
  `).bind(
    `${J6_RETENTION_CACHE_PREFIX}${viewport}`,
    `${J6_RETENTION_QUERY_PREFIX}${viewport}`,
    fetchedAt,
    expiresAt,
    fetchedAt,
    fetchedAt,
  ).run();
  if (Number(inserted.meta?.changes ?? 0) !== 1) {
    throw new Error("retention_fixture_already_exists");
  }
}

async function claimReplayAction(env: AppEnv, mapping: J6RetentionReplayMapping, metadata: { userId: string; runId: string; idempotencyKey: string }) {
  const db = ensureDb(env);
  const processingToken = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db.prepare(`
    INSERT INTO e2e_j6_replay (idempotency_key, action, user_id, run_id, status, processing_token, result_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'started', ?, NULL, ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).bind(metadata.idempotencyKey, mapping.outcome, mapping.userId, mapping.runId, processingToken, timestamp, timestamp).run();
  const row = await readReplayState(env, metadata.idempotencyKey);
  if (!row || row.action !== mapping.outcome || row.user_id !== metadata.userId || row.run_id !== metadata.runId) throw new Error("replay_identity_conflict");
  if (row.status === "succeeded") return { replayed: true as const, result: parseReplayResult(row.result_json), processingToken };
  if (row.processing_token === processingToken) return { replayed: false as const, processingToken };
  throw new J6ReplayInProgressError();
}

async function completeReplayAction(env: AppEnv, idempotencyKey: string, processingToken: string, result: Record<string, unknown>) {
  const resultJson = JSON.stringify(result);
  if (resultJson.length > 8_192) throw new Error("replay_result_too_large");
  const updated = await ensureDb(env).prepare(`
    UPDATE e2e_j6_replay SET status = 'succeeded', result_json = ?, updated_at = ?
    WHERE idempotency_key = ? AND status = 'started' AND processing_token = ?
  `).bind(resultJson, new Date().toISOString(), idempotencyKey, processingToken).run();
  if (Number(updated.meta?.changes ?? 0) !== 1) throw new Error("replay_completion_lost");
}

async function readReplayState(env: AppEnv, idempotencyKey: string) {
  return ensureDb(env).prepare(`
    SELECT action, user_id, run_id, status, processing_token, result_json
    FROM e2e_j6_replay WHERE idempotency_key = ? LIMIT 1
  `).bind(idempotencyKey).first<J6RetentionReplayStateRow>();
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
  constructor() { super("j6_retention_replay_in_progress"); this.name = "J6ReplayInProgressError"; }
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
