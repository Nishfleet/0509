import type { AppEnv } from "~/lib/env.server";
import { logAppEvent } from "~/lib/log.server";

/**
 * Anonymous first-party funnel measurement (docs/funnel-measurement-spec.md).
 *
 * This is the only entry point for v1 funnel events. It is default-off: no
 * event is written unless the server-side gate is explicitly set to "1" AND the
 * request carries no GPC opt-out. Events carry only the spec §4 allowlisted
 * fields (server event_id, server timestamp, coarse route, account_scope, and
 * the coarse bucket/kind the event table requires). No production environment
 * sets the gate; the spec §8 rollout gates remain unpassed.
 */

export const FUNNEL_ROUTES = ["home", "search_preview", "signup", "activation"] as const;
export type FunnelRoute = (typeof FUNNEL_ROUTES)[number];

export const FUNNEL_OPERATIONS = [
  "funnel_home_view",
  "funnel_search_preview_submit",
  "funnel_search_preview_result",
  "funnel_search_preview_error",
  "funnel_signup_start",
] as const;
export type FunnelOperation = (typeof FUNNEL_OPERATIONS)[number];

export const FUNNEL_RESULT_COUNT_BUCKETS = ["0", "1-10", "11-50", "51+"] as const;
export type FunnelResultCountBucket = (typeof FUNNEL_RESULT_COUNT_BUCKETS)[number];

export const FUNNEL_ERROR_KINDS = [
  "rate_limited",
  "timeout",
  "provider_unavailable",
  "browser_unavailable",
  "browser_launch_failed",
  "login_wall",
  "selector_drift",
  "empty_result",
  "invalid_input",
  "internal",
] as const;
export type FunnelErrorKind = (typeof FUNNEL_ERROR_KINDS)[number];

/**
 * Closed event shapes: only the spec's coarse fields exist on the input, so
 * forbidden content cannot enter through a helper call.
 */
export type FunnelEventSpec =
  | {
      operation: "funnel_home_view" | "funnel_search_preview_submit" | "funnel_signup_start";
      route: FunnelRoute;
    }
  | {
      operation: "funnel_search_preview_result";
      route: "search_preview";
      resultCountBucket: FunnelResultCountBucket;
    }
  | {
      operation: "funnel_search_preview_error";
      route: "search_preview";
      errorKind: FunnelErrorKind;
    };

/** Explicit gate: only exactly "1" enables. Absent or anything else stays off. */
export function isFunnelMeasurementEnabled(env: AppEnv) {
  return (env.FUNNEL_MEASUREMENT_ENABLED ?? "").trim() === "1";
}

/** Global Privacy Control: Sec-GPC (standard) or GPC (extension/user-agent) header. */
export function hasGpcOptOut(request: Request) {
  return (
    request.headers.get("sec-gpc")?.trim() === "1" ||
    request.headers.get("gpc")?.trim() === "1"
  );
}

/** Coarse result-count bucket from the spec; non-finite or negative counts are rejected. */
export function funnelResultCountBucket(value: unknown): FunnelResultCountBucket | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value === 0) {
    return "0";
  }
  if (value <= 10) {
    return "1-10";
  }
  if (value <= 50) {
    return "11-50";
  }
  return "51+";
}

/**
 * Maps a coarse discovery failure class (e.g. from the search preview result)
 * into the funnel error-kind allowlist. Unknown or free-text values are
 * rejected so no event can carry an unapproved error label.
 */
export function funnelErrorKind(value: string | null | undefined): FunnelErrorKind | null {
  if (!value || !FUNNEL_ERROR_KINDS.includes(value as FunnelErrorKind)) {
    return null;
  }
  return value as FunnelErrorKind;
}

function validateFunnelSpec(spec: FunnelEventSpec) {
  if (!FUNNEL_OPERATIONS.includes(spec.operation)) {
    return false;
  }
  if (!FUNNEL_ROUTES.includes(spec.route)) {
    return false;
  }
  if (spec.operation === "funnel_search_preview_result") {
    return FUNNEL_RESULT_COUNT_BUCKETS.includes(spec.resultCountBucket);
  }
  if (spec.operation === "funnel_search_preview_error") {
    return FUNNEL_ERROR_KINDS.includes(spec.errorKind);
  }
  return true;
}

/**
 * Writes one anonymous funnel event to the existing structured-log stream.
 * Returns whether the event was actually recorded (false when disabled,
 * GPC-opted-out, or outside the field allowlist).
 */
export function recordFunnelEvent(env: AppEnv, request: Request, spec: FunnelEventSpec): boolean {
  if (!isFunnelMeasurementEnabled(env)) {
    return false;
  }
  if (hasGpcOptOut(request)) {
    return false;
  }
  if (!validateFunnelSpec(spec)) {
    return false;
  }

  const details: Record<string, string> = {
    route: spec.route,
    account_scope: "anonymous",
  };
  if (spec.operation === "funnel_search_preview_result") {
    details.result_count_bucket = spec.resultCountBucket;
  }
  if (spec.operation === "funnel_search_preview_error") {
    details.error_kind = spec.errorKind;
  }

  logAppEvent("info", spec.operation, spec.operation, {
    eventId: crypto.randomUUID(),
    details,
  });
  return true;
}
