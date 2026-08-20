/**
 * Narrow append-only browser-job attribution telemetry (0509 browser
 * attribution first).
 *
 * One row per browser-capable job attempt (or cache/API serve that replaced a
 * browser run). The table (`browser_job_telemetry`, migration 0075) is write
 * only from the product path; queries belong to the operator surface.
 *
 * Secrecy contract: only bounded fields and stable hashes are persisted — never
 * raw tokens, share tokens, URLs, query text, page bodies, screenshots,
 * cookies, auth headers, or customer identifiers.
 *
 * - `job_id` is a random correlation id generated once per top-level request
 *   and passed through every provider leg of that job (see ad-source /
 *   landing-pages / report-pdf callers).
 * - `idempotency_key` is a stable SHA-256 fingerprint of the canonical
 *   correlation input (query, cache key, URL, or report content) — never the
 *   raw input, and never a paging cursor (callers hash the full canonical key
 *   before it reaches this writer).
 *
 * The writer is fail-closed on bounds: any field that does not match its
 * bounded format (see `validateTelemetryFields`) skips the row with a warn
 * line, so raw or oversized material can never be persisted even by accident.
 *
 * Telemetry failures are never fatal to the product job and never add
 * unbounded latency: the D1 write races a short timeout (default
 * `BROWSER_JOB_TELEMETRY_WRITE_TIMEOUT_MS`) and the product path never awaits
 * a slow write past it. When the caller has a request ExecutionContext
 * (`executionContext` option), the write is also registered with `waitUntil`
 * so it still completes after the response (background completion preserved).
 * Missing tables, unusable envs, and write errors all degrade to a warn line
 * at most.
 */

import { execute } from "~/lib/data/d1.server";
import { createId, nowIso } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import type { DiscoveryFailureClass } from "~/lib/types";

export const BROWSER_JOB_KINDS = [
  "meta_discovery",
  "landing_snapshot",
  "report_pdf",
] as const;
export type BrowserJobKind = (typeof BROWSER_JOB_KINDS)[number];

export const ACTUAL_BROWSER_PROVIDERS = [
  "plain_http",
  "customer_meta_api",
  "cloudflare_browser_run",
  "cloudflare_quick_actions",
  "browserless_bql",
  "cache",
] as const;
export type ActualBrowserProvider = (typeof ACTUAL_BROWSER_PROVIDERS)[number];

export const BROWSER_JOB_OUTCOMES = [
  "succeeded",
  "empty",
  "blocked",
  "rate_limited",
  "timeout",
  "failed",
  "degraded",
] as const;
export type BrowserJobOutcome = (typeof BROWSER_JOB_OUTCOMES)[number];

export const BROWSER_JOB_SOURCES = ["scheduled", "manual", "background", "api", "unknown"] as const;
export type BrowserJobSource = (typeof BROWSER_JOB_SOURCES)[number];

export const BROWSER_JOB_ROUTE_CONTEXTS = [
  "public_search",
  "watchlist_scan",
  "scheduled_warmup",
  "selection_enrichment",
  "proof_capture",
  "share_pdf",
] as const;
export type BrowserJobRouteContext = (typeof BROWSER_JOB_ROUTE_CONTEXTS)[number];

export const BROWSER_JOB_PLAN_TIERS = ["free", "scout", "starter", "agency"] as const;
export type BrowserJobPlanTier = (typeof BROWSER_JOB_PLAN_TIERS)[number];

export const BROWSER_JOB_CACHE_STATUSES = ["miss", "hit", "stale", "none"] as const;
export type BrowserJobCacheStatus = (typeof BROWSER_JOB_CACHE_STATUSES)[number];

export interface BrowserJobTelemetryFields {
  /** Per-job correlation id (one job = one chain of attempts). */
  jobId: string;
  /** Stable hash fingerprint for idempotent correlation; never raw input. */
  idempotencyKey?: string | null;
  jobKind: BrowserJobKind;
  actualProvider: ActualBrowserProvider;
  routeContext: BrowserJobRouteContext;
  planTier?: BrowserJobPlanTier | null;
  source: BrowserJobSource;
  attempt: number;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  /** Provider-reported browser milliseconds (e.g. X-Browser-Ms-Used). */
  browserMsUsed?: number | null;
  cacheStatus?: BrowserJobCacheStatus | null;
  cacheAgeMs?: number | null;
  outcome: BrowserJobOutcome;
  /** Result cardinality only — never raw content. */
  resultCount?: number | null;
  /** Result byte size only — never raw content. */
  resultBytes?: number | null;
  workerVersion?: string | null;
  /** Cron/task discriminator when the job runs from a scheduled surface. */
  cronTask?: string | null;
}

const SAFE_WORKER_VERSION = /^[A-Za-z0-9._-]{1,128}$/u;

/**
 * Bounded formats enforced by the writer before any row is persisted. These
 * mirror the schema CHECKs (migration 0075) as a fail-closed first line:
 * raw cursors, URLs, tokens, query text, or oversized values cannot match.
 */
const JOB_ID_PATTERN = /^[a-z0-9-]{8,64}$/iu;
const IDEMPOTENCY_KEY_PATTERN = /^[a-z0-9:_-]{1,128}$/iu;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u;
const CRON_TASK_PATTERN = /^[a-z0-9._-]{1,64}$/iu;

/** Upper length bound for short enum-ish text fields (kind, provider, route). */
const MAX_SHORT_FIELD_LENGTH = 64;

/**
 * SHA-256 hex digest of arbitrary text. This is the ONLY way correlation
 * input (cache keys, URLs, cursors, report content) may be persisted as an
 * idempotency fingerprint — the raw input never reaches the writer.
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Worker version from `CF_VERSION_METADATA` when present and well-formed.
 * Mirrors the release-identity sanitization so no raw/oversized value can
 * reach the telemetry row.
 */
export function resolveWorkerVersionId(env: AppEnv): string | null {
  const versionId = env.CF_VERSION_METADATA?.id?.trim() ?? "";
  return SAFE_WORKER_VERSION.test(versionId) ? versionId : null;
}

/** Deterministic discovery failure-class → contract outcome mapping. */
export function mapDiscoveryFailureOutcome(
  failureClass: DiscoveryFailureClass | null | undefined,
): BrowserJobOutcome {
  switch (failureClass) {
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "empty_result":
      return "empty";
    case "login_wall":
      return "blocked";
    default:
      return "failed";
  }
}

/** Deterministic landing-capture failure reason → contract outcome mapping. */
export function mapLandingFailureOutcome(
  reasonCode: string | null | undefined,
): BrowserJobOutcome {
  switch (reasonCode) {
    case "landing_blocked":
    case "landing_redirect_blocked":
      return "blocked";
    case "landing_rate_limited":
      return "rate_limited";
    case "landing_content_empty_or_oversized":
      return "empty";
    case "landing_fetch_failed":
      return "failed";
    default:
      return "failed";
  }
}

/** Deterministic PDF error-code → contract outcome mapping. */
export function mapPdfErrorOutcome(errorCode: string | null | undefined): BrowserJobOutcome {
  switch (errorCode) {
    case "pdf_render_timeout":
      return "timeout";
    case "capacity_exhausted":
    case "pdf_daily_cap":
    case "pdf_single_flight":
      return "rate_limited";
    case "capacity_unavailable":
    case "pdf_unconfigured":
      return "degraded";
    case "plan_gated":
    case "evidence_not_ready":
      return "blocked";
    default:
      return "failed";
  }
}

/** Deterministic scheduled/manual source for a known route context. */
export function resolveSourceForRouteContext(
  routeContext: BrowserJobRouteContext | null | undefined,
  explicitSource?: BrowserJobSource | null,
): BrowserJobSource {
  if (explicitSource) {
    return explicitSource;
  }
  if (
    routeContext === "watchlist_scan" ||
    routeContext === "scheduled_warmup" ||
    routeContext === "proof_capture"
  ) {
    return "scheduled";
  }
  if (routeContext === "public_search" || routeContext === "share_pdf") {
    return "manual";
  }
  return "unknown";
}

function isUsableDb(env: AppEnv): env is AppEnv & { DB: D1Database } {
  return Boolean(env?.DB && typeof env.DB.prepare === "function");
}

function isMissingTelemetryTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes("no such table") &&
    message.includes("browser_job_telemetry")
  );
}

/**
 * Fail-closed bounds check for every persisted text field. Returns a short
 * reason string when the row must NOT be written; null when it is safe.
 */
function validateTelemetryFields(fields: BrowserJobTelemetryFields): string | null {
  if (!JOB_ID_PATTERN.test(fields.jobId)) {
    return "job_id_unbounded";
  }
  if (
    fields.idempotencyKey != null &&
    !IDEMPOTENCY_KEY_PATTERN.test(fields.idempotencyKey)
  ) {
    return "idempotency_key_unbounded";
  }
  for (const value of [fields.jobKind, fields.actualProvider, fields.routeContext]) {
    if (value.length > MAX_SHORT_FIELD_LENGTH) {
      return "enum_field_oversized";
    }
  }
  for (const value of [fields.source, fields.outcome, fields.cacheStatus, fields.planTier]) {
    if (value != null && value.length > MAX_SHORT_FIELD_LENGTH) {
      return "enum_field_oversized";
    }
  }
  for (const value of [fields.startedAt, fields.endedAt]) {
    if (value != null && !ISO_TIMESTAMP_PATTERN.test(value)) {
      return "timestamp_unbounded";
    }
  }
  if (fields.cronTask != null && !CRON_TASK_PATTERN.test(fields.cronTask)) {
    return "cron_task_unbounded";
  }
  if (fields.workerVersion != null && !SAFE_WORKER_VERSION.test(fields.workerVersion)) {
    return "worker_version_unbounded";
  }
  return null;
}

function normalizeAttempt(attempt: number): number {
  return Number.isInteger(attempt) && attempt >= 1 ? attempt : 1;
}

/** Null out NaN/negative numerics so a bad clock read can never drop a row. */
function nonNegativeNumber(value: number | null | undefined): number | null {
  return Number.isFinite(value) && (value as number) >= 0 ? (value as number) : null;
}

/**
 * Upper bound on how long a product path may wait for one telemetry row. A
 * slow D1 write must never delay cache hits, discovery, landing, or PDF
 * responses; the write continues in the background (all errors swallowed).
 */
export const BROWSER_JOB_TELEMETRY_WRITE_TIMEOUT_MS = 250;

/** Race the write against the timeout; resolve early on timeout. Never throws. */
async function boundedWrite(write: Promise<void>, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) {
    await write;
    return;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    write,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }
}

export interface BrowserJobTelemetryWriteOptions {
  /** Override the bounded wait cap (defaults to `BROWSER_JOB_TELEMETRY_WRITE_TIMEOUT_MS`). */
  timeoutMs?: number;
  /**
   * Request ExecutionContext when the caller actually has one. When present,
   * the row write is registered with `waitUntil` so it still lands after the
   * response (preserving observable/background completion) instead of being
   * dropped when the bounded race wins. The product path never waits past the
   * cap either way — waitUntil only keeps the isolate alive, it never blocks
   * the response.
   */
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
}

/**
 * Persist one bounded telemetry row. Never throws and never blocks the
 * product path longer than `timeoutMs` (default 250ms): unusable DB, missing
 * table, out-of-bounds fields, and write errors all degrade to a warn line at
 * most. `timeoutMs` is injectable for deterministic slow-write tests; an
 * optional `executionContext` preserves background completion via waitUntil
 * when the caller has one (see `BrowserJobTelemetryWriteOptions`).
 */
export async function recordBrowserJobTelemetry(
  env: AppEnv,
  fields: BrowserJobTelemetryFields,
  options: BrowserJobTelemetryWriteOptions = {},
): Promise<void> {
  if (!isUsableDb(env)) {
    return;
  }

  const boundsFailure = validateTelemetryFields(fields);
  if (boundsFailure) {
    console.warn(
      JSON.stringify({
        event: "browser_job_telemetry_bounds_rejected",
        reason: boundsFailure,
        jobKind: fields.jobKind,
      }),
    );
    return;
  }

  const attempt = normalizeAttempt(fields.attempt);
  const write = (async () => {
    try {
      await execute(
        env,
        `
          INSERT INTO browser_job_telemetry (
            id,
            job_id,
            idempotency_key,
            job_kind,
            actual_provider,
            route_context,
            plan_tier,
            source,
            attempt,
            started_at,
            ended_at,
            duration_ms,
            browser_ms_used,
            cache_status,
            cache_age_ms,
            outcome,
            result_count,
            result_bytes,
            worker_version,
            cron_task,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        createId(),
        fields.jobId,
        fields.idempotencyKey ?? null,
        fields.jobKind,
        fields.actualProvider,
        fields.routeContext,
        fields.planTier ?? null,
        fields.source,
        attempt,
        fields.startedAt,
        fields.endedAt ?? null,
        nonNegativeNumber(fields.durationMs),
        nonNegativeNumber(fields.browserMsUsed),
        fields.cacheStatus ?? null,
        nonNegativeNumber(fields.cacheAgeMs),
        fields.outcome,
        nonNegativeNumber(fields.resultCount),
        nonNegativeNumber(fields.resultBytes),
        fields.workerVersion ?? resolveWorkerVersionId(env),
        fields.cronTask ?? null,
        nowIso(),
      );
    } catch (error) {
      if (isMissingTelemetryTableError(error)) {
        return;
      }
      console.warn(
        JSON.stringify({
          event: "browser_job_telemetry_write_failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }
  })();

  // When the caller has a real request ExecutionContext, register the write
  // with waitUntil so the row still lands after the response returns (the
  // isolate stays alive for it) instead of being dropped when the bounded
  // race below wins. Registration never blocks and never throws; the product
  // path still waits at most `BROWSER_JOB_TELEMETRY_WRITE_TIMEOUT_MS`.
  const executionContext = options.executionContext;
  if (executionContext && typeof executionContext.waitUntil === "function") {
    try {
      executionContext.waitUntil(write);
    } catch {
      // A context that refuses the registration must not break the job.
    }
  }

  await boundedWrite(write, options.timeoutMs ?? BROWSER_JOB_TELEMETRY_WRITE_TIMEOUT_MS);
}
