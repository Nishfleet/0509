import type { AppEnv } from "~/lib/env.server";
import { isFunnelMeasurementEnabled } from "~/lib/env.server";
import { logAppEvent } from "~/lib/log.server";

/**
 * First-party anonymous funnel measurement (v1). Implementation surface for
 * docs/funnel-measurement-spec.md §3–§5: request-scoped events carrying ONLY
 * the spec's field allowlist. This module is server-only and fail-closed:
 *
 * - Collection is default-off. It is enabled only by an explicit
 *   `FUNNEL_MEASUREMENT_ENABLED` env value, never by absence.
 * - GPC (`Sec-GPC: 1` / `GPC: 1`) requests are treated as opted out and
 *   produce nothing.
 * - Every input is validated against a fixed allowlist; any value outside the
 *   allowlist (or missing the gate) returns `false` and emits nothing, so a
 *   forbidden field can never reach a funnel log record through this helper.
 * - Events carry no request join keys (no request id, session, visitor,
 *   cookies, IP, UA, referrer) and no client-supplied values.
 */

export const FUNNEL_ROUTES = Object.freeze([
  "home",
  "search_preview",
  "signup",
  "activation",
] as const);
export type FunnelRoute = (typeof FUNNEL_ROUTES)[number];

export const FUNNEL_RESULT_COUNT_BUCKETS = Object.freeze([
  "0",
  "1-10",
  "11-50",
  "51+",
] as const);
export type FunnelResultCountBucket = (typeof FUNNEL_RESULT_COUNT_BUCKETS)[number];

/** Coarse error classes only; never error text or stack traces. */
export const FUNNEL_ERROR_KINDS = Object.freeze([
  "provider_unavailable",
  "browser_unavailable",
  "browser_launch_failed",
  "timeout",
  "login_wall",
  "rate_limited",
  "selector_drift",
  "empty_result",
  "degraded",
] as const);
export type FunnelErrorKind = (typeof FUNNEL_ERROR_KINDS)[number];

export const FUNNEL_EVENT_NAMES = Object.freeze([
  "funnel_home_view",
  "funnel_search_preview_submit",
  "funnel_search_preview_result",
  "funnel_search_preview_error",
  "funnel_signup_start",
] as const);
export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

const EVENT_MESSAGES: Record<FunnelEventName, string> = Object.freeze({
  funnel_home_view: "Anonymous homepage view",
  funnel_search_preview_submit: "Anonymous public search preview submitted",
  funnel_search_preview_result: "Anonymous public search preview returned a result",
  funnel_search_preview_error: "Anonymous public search preview failed",
  funnel_signup_start: "Visitor began signup",
});

function isFunnelRoute(value: unknown): value is FunnelRoute {
  return typeof value === "string" && (FUNNEL_ROUTES as readonly string[]).includes(value);
}

function isFunnelErrorKind(value: unknown): value is FunnelErrorKind {
  return (
    typeof value === "string" && (FUNNEL_ERROR_KINDS as readonly string[]).includes(value)
  );
}

function isFunnelResultCountBucket(value: unknown): value is FunnelResultCountBucket {
  return (
    typeof value === "string" &&
    (FUNNEL_RESULT_COUNT_BUCKETS as readonly string[]).includes(value)
  );
}

/** Coarse bucket of a search-preview result count; `null` for invalid counts. */
export function funnelResultCountBucket(count: unknown): FunnelResultCountBucket | null {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    return null;
  }
  if (count === 0) {
    return "0";
  }
  if (count <= 10) {
    return "1-10";
  }
  if (count <= 50) {
    return "11-50";
  }
  return "51+";
}

/**
 * Global Privacy Control opt-out signal. DNT is intentionally NOT treated as
 * an opt-out (spec §5).
 */
export function hasGpcOptOut(request: Request) {
  const signal = (request.headers.get("sec-gpc") ?? request.headers.get("gpc") ?? "").trim();
  return signal === "1";
}

function emit(
  env: AppEnv,
  request: Request,
  event: FunnelEventName,
  route: FunnelRoute,
  extra?: { resultCountBucket?: FunnelResultCountBucket; errorKind?: FunnelErrorKind },
): boolean {
  if (!isFunnelMeasurementEnabled(env) || hasGpcOptOut(request)) {
    return false;
  }
  if (!isFunnelRoute(route)) {
    return false;
  }
  if (
    extra?.resultCountBucket !== undefined &&
    !isFunnelResultCountBucket(extra.resultCountBucket)
  ) {
    return false;
  }
  if (extra?.errorKind !== undefined && !isFunnelErrorKind(extra.errorKind)) {
    return false;
  }

  const details: Record<string, string> = {
    route,
    event_id: crypto.randomUUID(),
    account_scope: "anonymous",
  };
  if (extra?.resultCountBucket !== undefined) {
    details.result_count_bucket = extra.resultCountBucket;
  }
  if (extra?.errorKind !== undefined) {
    details.error_kind = extra.errorKind;
  }

  logAppEvent("info", event, EVENT_MESSAGES[event], { details });
  return true;
}

/** Homepage rendered for a visitor. */
export function emitFunnelHomeView(env: AppEnv, request: Request): boolean {
  return emit(env, request, "funnel_home_view", "home");
}

/** Visitor submitted a public search preview. */
export function emitFunnelSearchPreviewSubmit(env: AppEnv, request: Request): boolean {
  return emit(env, request, "funnel_search_preview_submit", "search_preview");
}

/** Public search preview returned results (coarse count bucket only). */
export function emitFunnelSearchPreviewResult(
  env: AppEnv,
  request: Request,
  resultCount: unknown,
): boolean {
  const bucket = funnelResultCountBucket(resultCount);
  if (bucket === null) {
    return false;
  }
  return emit(env, request, "funnel_search_preview_result", "search_preview", {
    resultCountBucket: bucket,
  });
}

/** Public search preview failed (coarse error kind only). */
export function emitFunnelSearchPreviewError(
  env: AppEnv,
  request: Request,
  errorKind: unknown,
): boolean {
  return emit(env, request, "funnel_search_preview_error", "search_preview", {
    errorKind: errorKind as FunnelErrorKind,
  });
}

/** Visitor began signup (email magic link or OAuth). */
export function emitFunnelSignupStart(env: AppEnv, request: Request): boolean {
  return emit(env, request, "funnel_signup_start", "signup");
}
