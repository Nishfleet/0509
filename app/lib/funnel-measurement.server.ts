import type { AppEnv } from "~/lib/env.server";
import { logAppEvent } from "~/lib/log.server";
import type { DiscoveryFailureClass } from "~/lib/types";

// Anonymous first-party funnel measurement. Spec: docs/funnel-measurement-spec.md.
// v1 events are request-scoped: they never carry visitor_id, session_id, cookies,
// IP, user agent, query text, URLs, or any other join key, and they are never
// linked to an account. Collection is DEFAULT-OFF: it requires the
// FUNNEL_MEASUREMENT_ENABLED server-side variable to be exactly "true" (absent or
// anything else is disabled), and every request carrying a GPC signal is skipped.
// The spec's unpassed rollout gates (legal review, owner-approved retention,
// policy-surface parity, canary) are process gates this code cannot pass itself.

export type FunnelRoute = "home" | "search_preview" | "signup" | "activation";

export type FunnelResultCountBucket = "0" | "1-10" | "11-50" | "51+";

export const FUNNEL_RESULT_COUNT_BUCKETS: readonly FunnelResultCountBucket[] = [
  "0",
  "1-10",
  "11-50",
  "51+",
];

export type FunnelErrorKind = DiscoveryFailureClass;

export const FUNNEL_ERROR_KINDS: readonly FunnelErrorKind[] = [
  "provider_unavailable",
  "browser_unavailable",
  "browser_launch_failed",
  "timeout",
  "login_wall",
  "rate_limited",
  "selector_drift",
  "empty_result",
];

export type FunnelEventName =
  | "funnel_home_view"
  | "funnel_search_preview_submit"
  | "funnel_search_preview_result"
  | "funnel_search_preview_error"
  | "funnel_signup_start";

export const FUNNEL_EVENT_NAMES: readonly FunnelEventName[] = [
  "funnel_home_view",
  "funnel_search_preview_submit",
  "funnel_search_preview_result",
  "funnel_search_preview_error",
  "funnel_signup_start",
];

export type FunnelEventInput =
  | { event: "funnel_home_view" }
  | { event: "funnel_search_preview_submit" }
  | {
      event: "funnel_search_preview_result";
      resultCountBucket: FunnelResultCountBucket;
    }
  | { event: "funnel_search_preview_error"; errorKind: FunnelErrorKind }
  | { event: "funnel_signup_start" };

const FUNNEL_ROUTE_BY_EVENT: Record<FunnelEventName, FunnelRoute> = {
  funnel_home_view: "home",
  funnel_search_preview_submit: "search_preview",
  funnel_search_preview_result: "search_preview",
  funnel_search_preview_error: "search_preview",
  funnel_signup_start: "signup",
};

const FUNNEL_ENABLE_VALUE = "true";

/**
 * Collection gate. Enabled only when FUNNEL_MEASUREMENT_ENABLED is set to the
 * exact value "true" (trimmed, case-insensitive). Absent, empty, or any other
 * value (including "1", "yes", "on") stays disabled, so an absent environment
 * variable can never turn collection on.
 */
export function isFunnelMeasurementEnabled(env: AppEnv): boolean {
  return (env.FUNNEL_MEASUREMENT_ENABLED ?? "").trim().toLowerCase() === FUNNEL_ENABLE_VALUE;
}

/** Global Privacy Control (Sec-GPC: 1): treat the visitor as opted out. */
export function isFunnelGpcOptOut(request: Request): boolean {
  return request.headers.get("sec-gpc") === "1";
}

/**
 * Coarse result-count bucket from the spec's fixed set. Negative or zero counts
 * (empty results are legitimate search outcomes) fall into "0".
 */
export function funnelResultCountBucket(count: number): FunnelResultCountBucket {
  if (count <= 0) {
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
 * Coarse error kind for funnel_search_preview_error. Accepts values already
 * carrying the existing DiscoveryFailureClass taxonomy and maps everything else
 * to a provider-neutral coarse class. Never includes error text or stack traces.
 */
export function funnelErrorKind(error: unknown): FunnelErrorKind {
  if (error && typeof error === "object") {
    const candidate = (error as { failureClass?: unknown }).failureClass;
    if (isFunnelErrorKind(candidate)) {
      return candidate;
    }
    const record = error as { isRateLimit?: unknown; isAuthError?: unknown };
    if (record.isRateLimit === true) {
      return "rate_limited";
    }
    if (record.isAuthError === true) {
      return "login_wall";
    }
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("rate limit") || message.includes("429")) {
    return "rate_limited";
  }
  if (message.includes("timeout")) {
    return "timeout";
  }
  return "provider_unavailable";
}

function isFunnelErrorKind(value: unknown): value is FunnelErrorKind {
  return FUNNEL_ERROR_KINDS.includes(value as FunnelErrorKind);
}

/**
 * Emit one anonymous funnel event, or no-op when collection is disabled or the
 * request carries a GPC opt-out. Only allowlisted fields are ever written: the
 * event name maps to a fixed route, the account scope is always "anonymous",
 * and the event_id is server-generated. Unknown fields on the input are ignored
 * by construction, so no forbidden value can reach the log record.
 */
export function recordFunnelEvent(
  env: AppEnv,
  request: Request,
  input: FunnelEventInput,
): void {
  if (!isFunnelMeasurementEnabled(env) || isFunnelGpcOptOut(request)) {
    return;
  }
  const route = FUNNEL_ROUTE_BY_EVENT[input.event];
  if (!route) {
    return;
  }
  const details: Record<string, unknown> = {
    event_id: crypto.randomUUID(),
    route,
    account_scope: "anonymous",
  };
  if (input.event === "funnel_search_preview_result") {
    details.result_count_bucket = input.resultCountBucket;
  } else if (input.event === "funnel_search_preview_error") {
    details.error_kind = input.errorKind;
  }
  logAppEvent("info", input.event, input.event, { details });
}
