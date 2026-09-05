import type { AppEnv } from "~/lib/env.server";
import { logAppEvent } from "~/lib/log.server";

/**
 * First-party funnel measurement (docs/funnel-measurement-spec.md).
 *
 * Shipped dormant: nothing is emitted unless the exact env value
 * `FUNNEL_MEASUREMENT_ENABLED=true` is present AND the spec's §8 rollout
 * gates (legal review, owner approval, policy-surface parity) have passed.
 * GPC requests are always suppressed. This module is the only surface that
 * may produce funnel events; it rebuilds every emitted record from a closed
 * allowlist, so caller-supplied extra fields can never reach a log line.
 */

export const FUNNEL_EVENT_NAMES = [
  "funnel_home_view",
  "funnel_search_preview_submit",
  "funnel_search_preview_result",
  "funnel_search_preview_error",
  "funnel_signup_start",
] as const;
export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

export const FUNNEL_ROUTES = ["home", "search_preview", "signup"] as const;
export type FunnelRoute = (typeof FUNNEL_ROUTES)[number];

export const RESULT_COUNT_BUCKETS = ["0", "1-10", "11-50", "51+"] as const;
export type ResultCountBucket = (typeof RESULT_COUNT_BUCKETS)[number];

export const FUNNEL_ERROR_KINDS = [
  "rate_limited",
  "timeout",
  "provider_unavailable",
  "unknown",
] as const;
export type FunnelErrorKind = (typeof FUNNEL_ERROR_KINDS)[number];

export type FunnelEvent =
  | { name: "funnel_home_view" }
  | { name: "funnel_search_preview_submit" }
  | { name: "funnel_search_preview_result"; resultCountBucket: ResultCountBucket }
  | { name: "funnel_search_preview_error"; errorKind: FunnelErrorKind }
  | { name: "funnel_signup_start" };

const ROUTE_FOR_EVENT: Record<FunnelEventName, FunnelRoute> = {
  funnel_home_view: "home",
  funnel_search_preview_submit: "search_preview",
  funnel_search_preview_result: "search_preview",
  funnel_search_preview_error: "search_preview",
  funnel_signup_start: "signup",
};

/**
 * Explicit server-side gate. Default-off by construction: absent, empty,
 * or any value other than the exact string "true" (case-insensitive) keeps
 * collection disabled, so a missing environment variable can never enable it.
 */
export function isFunnelMeasurementEnabled(env: AppEnv): boolean {
  return (env.FUNNEL_MEASUREMENT_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Global Privacy Control opt-out. A request carrying `Sec-GPC: 1` is treated
 * as opted out and records nothing. Tolerates a missing request object so
 * call sites without a request (tests, non-HTTP paths) cannot crash — they
 * simply record nothing.
 */
export function gpcOptedOut(request: Request | null | undefined): boolean {
  if (!request) {
    return false;
  }
  return (request.headers.get("sec-gpc") ?? "").trim().toLowerCase() === "1";
}

/**
 * Coarse result-count bucket from the spec §4 allowlist. Returns null for any
 * untrusted value (NaN, negative, fractional, non-number), and a null bucket
 * must cause the event to be dropped rather than recorded.
 */
export function bucketResultCount(count: number): ResultCountBucket | null {
  if (typeof count !== "number" || !Number.isFinite(count) || !Number.isInteger(count)) {
    return null;
  }
  if (count < 0) {
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
 * Classify a search-preview failure into the coarse error-kind allowlist.
 * Never reads error message bodies into the result — message text is a
 * forbidden field. Duck-typed against the discovery failure classes so this
 * module stays decoupled from the discovery internals.
 */
export function funnelErrorKindFrom(error: unknown): FunnelErrorKind {
  const failureClass = (error as { failureClass?: unknown } | null)?.failureClass;
  if (failureClass === "rate_limited") {
    return "rate_limited";
  }
  if (failureClass === "timeout") {
    return "timeout";
  }
  if ((error as { isRateLimit?: unknown } | null)?.isRateLimit === true) {
    return "rate_limited";
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "number" && code >= 500) {
    return "provider_unavailable";
  }
  return "unknown";
}

/**
 * Runtime allowlist guard. Every event passes through here so that a
 * tampered or mistyped caller input can never reach a log line: unknown
 * names, unknown buckets, and unknown error kinds are all dropped.
 */
export function isFunnelEvent(event: FunnelEvent): boolean {
  if (!event || typeof event !== "object") {
    return false;
  }
  const name = event.name;
  if (!FUNNEL_EVENT_NAMES.includes(name)) {
    return false;
  }
  if (name === "funnel_search_preview_result") {
    return RESULT_COUNT_BUCKETS.includes(event.resultCountBucket);
  }
  if (name === "funnel_search_preview_error") {
    return FUNNEL_ERROR_KINDS.includes(event.errorKind);
  }
  return true;
}

/**
 * Emit a funnel event as a structured JSON log record via the existing
 * log.server.ts mechanism. No-op when collection is disabled or the request
 * carries a GPC opt-out. The emitted record contains only allowlisted fields:
 * operation (event name), server timestamp, server-generated event id,
 * route, and the coarse bucket/kind for the events that carry one. All
 * details are rebuilt here from the closed union — caller-supplied keys and
 * values cannot leak into the record.
 */
export function emitFunnelEvent(
  env: AppEnv,
  request: Request | null | undefined,
  event: FunnelEvent,
): void {
  if (!isFunnelMeasurementEnabled(env)) {
    return;
  }
  if (gpcOptedOut(request)) {
    return;
  }
  if (!isFunnelEvent(event)) {
    return;
  }

  const details: Record<string, string> = { route: ROUTE_FOR_EVENT[event.name] };
  if (event.name === "funnel_search_preview_result") {
    details.result_count_bucket = event.resultCountBucket;
  }
  if (event.name === "funnel_search_preview_error") {
    details.error_kind = event.errorKind;
  }

  logAppEvent("info", event.name, `Funnel event: ${event.name}`, {
    eventId: crypto.randomUUID(),
    details,
  });
}
