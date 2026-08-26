import { logAppEvent } from "~/lib/log.server";
import type { DiscoveryFailureClass } from "~/lib/types";

import type { AppEnv } from "~/lib/env.server";

/**
 * Anonymous first-party funnel measurement (docs/funnel-measurement-spec.md).
 *
 * This module is the ONLY code that may emit `funnel_*` records. It enforces
 * the spec's §4 field allowlist by construction: callers pass typed coarse
 * inputs only, and the emitted record is assembled here from server-generated
 * values (event id, timestamp, route label, account scope) plus the coarse
 * bucket/error kind. There is no path from a caller-controlled string to a
 * record field.
 *
 * Default-off: no environment variable set means no measurement. The gate
 * turns true only for the exact explicit values "1"/"true"/"yes"/"on".
 * GPC: a request carrying the Global Privacy Control signal (`Sec-GPC: 1`,
 * per the W3C GPC spec) is treated as opted out and records nothing.
 */

export type FunnelEventKind =
  | "home_view"
  | "search_preview_submit"
  | "search_preview_result"
  | "search_preview_error"
  | "migration_view"
  | "signup_start"
  | "signup_start_magicbrief"
  | "first_brief_viewed";

export type FunnelRoute =
  | "home"
  | "search_preview"
  | "magicbrief_migration"
  | "signup"
  | "activation";

/**
 * The exact signup-URL marker the migration page's CTA appends. Recognition
 * happens by comparing against this constant server-side; the marker itself is
 * never stored in a record — it only selects which allowlisted event kind is
 * emitted (`signup_start_magicbrief` instead of `signup_start`).
 */
export const MAGICBRIEF_MIGRATION_SOURCE = "magicbrief-migration";

export type FunnelResultBucket = "0" | "1-10" | "11-50" | "51+";

export type FunnelErrorKind = "rate_limited" | "provider" | "empty_result" | "internal";

export const FUNNEL_MEASUREMENT_ENABLED_VAR = "FUNNEL_MEASUREMENT_ENABLED";

const FUNNEL_ENABLE_VALUES = new Set(["1", "true", "yes", "on"]);

const FUNNEL_ROUTES: Record<FunnelEventKind, FunnelRoute> = {
  home_view: "home",
  search_preview_submit: "search_preview",
  search_preview_result: "search_preview",
  search_preview_error: "search_preview",
  migration_view: "magicbrief_migration",
  signup_start: "signup",
  signup_start_magicbrief: "signup",
  first_brief_viewed: "activation",
};

const FUNNEL_OPERATIONS: Record<FunnelEventKind, string> = {
  home_view: "funnel_home_view",
  search_preview_submit: "funnel_search_preview_submit",
  search_preview_result: "funnel_search_preview_result",
  search_preview_error: "funnel_search_preview_error",
  migration_view: "funnel_migration_view",
  signup_start: "funnel_signup_start",
  signup_start_magicbrief: "funnel_signup_start_magicbrief",
  first_brief_viewed: "funnel_first_brief_viewed",
};

const FUNNEL_MESSAGES: Record<FunnelEventKind, string> = {
  home_view: "Anonymous homepage view",
  search_preview_submit: "Anonymous search preview submitted",
  search_preview_result: "Anonymous search preview returned results",
  search_preview_error: "Anonymous search preview failed",
  migration_view: "Anonymous MagicBrief migration page view",
  signup_start: "Anonymous signup started",
  signup_start_magicbrief: "Anonymous signup started from the MagicBrief migration page",
  first_brief_viewed: "First brief viewed in session",
};

export function funnelMeasurementEnabled(env: AppEnv): boolean {
  const value = env.FUNNEL_MEASUREMENT_ENABLED?.trim().toLowerCase();
  return Boolean(value && FUNNEL_ENABLE_VALUES.has(value));
}

/**
 * Global Privacy Control: `Sec-GPC` header with value exactly "1" (W3C GPC
 * spec). Multiple `Sec-GPC` headers count as opted out when at least one is
 * exactly "1"; any other value is ignored, per the spec.
 */
export function isGpcOptOut(request: Request): boolean {
  const header = request.headers.get("sec-gpc");
  if (!header) {
    return false;
  }
  return header.split(",").some((part) => part.trim() === "1");
}

export function bucketForResultCount(count: number): FunnelResultBucket {
  if (!Number.isFinite(count) || count <= 0) {
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

const COARSE_FAILURE_CLASSES: Record<DiscoveryFailureClass, FunnelErrorKind> = {
  provider_unavailable: "provider",
  browser_unavailable: "provider",
  browser_launch_failed: "provider",
  timeout: "provider",
  login_wall: "provider",
  selector_drift: "provider",
  rate_limited: "rate_limited",
  empty_result: "empty_result",
};

/**
 * Coarse error classification for search-preview failures. Only the allowlist
 * in FunnelErrorKind can ever be returned; error text and stack traces are
 * never part of a funnel record. The discovery-error marker is recognized by
 * its stable name instead of a runtime import so this module (and the
 * homepage route that imports it) stays free of the browser provider module.
 */
export function funnelErrorKindFromUnknown(error: unknown): FunnelErrorKind {
  if (error instanceof Response && error.status === 429) {
    return "rate_limited";
  }
  const candidate = error as { name?: unknown; failureClass?: unknown } | null;
  if (
    candidate &&
    typeof candidate === "object" &&
    candidate.name === "CommercialDiscoveryError" &&
    typeof candidate.failureClass === "string"
  ) {
    return COARSE_FAILURE_CLASSES[candidate.failureClass as DiscoveryFailureClass] ?? "internal";
  }
  return "internal";
}

interface FunnelEventExtra {
  resultCount?: number;
  errorKind?: FunnelErrorKind;
}

function emitFunnelEvent(env: AppEnv, request: Request, kind: FunnelEventKind, extra: FunnelEventExtra = {}) {
  if (!funnelMeasurementEnabled(env)) {
    return;
  }
  if (isGpcOptOut(request)) {
    return;
  }

  const details: Record<string, string> = {
    event_id: crypto.randomUUID(),
    route: FUNNEL_ROUTES[kind],
    account_scope: kind === "first_brief_viewed" ? "workspace" : "anonymous",
  };
  if (extra.resultCount !== undefined) {
    details.result_count_bucket = bucketForResultCount(extra.resultCount);
  }
  if (extra.errorKind !== undefined) {
    details.error_kind = extra.errorKind;
  }

  logAppEvent("info", FUNNEL_OPERATIONS[kind], FUNNEL_MESSAGES[kind], {
    details,
  });
}

export function emitFunnelHomeView(env: AppEnv, request: Request) {
  emitFunnelEvent(env, request, "home_view");
}

export function emitFunnelSearchSubmit(env: AppEnv, request: Request) {
  emitFunnelEvent(env, request, "search_preview_submit");
}

export function emitFunnelSearchResult(env: AppEnv, request: Request, resultCount: number) {
  emitFunnelEvent(env, request, "search_preview_result", { resultCount });
}

export function emitFunnelSearchError(env: AppEnv, request: Request, errorKind: FunnelErrorKind) {
  emitFunnelEvent(env, request, "search_preview_error", { errorKind });
}

export function emitFunnelSignupStart(env: AppEnv, request: Request) {
  emitFunnelEvent(env, request, "signup_start");
}

export function emitFunnelMigrationView(env: AppEnv, request: Request) {
  emitFunnelEvent(env, request, "migration_view");
}

/**
 * Signup attribution for the MagicBrief wind-down blitz. The caller resolves
 * the URL marker to a boolean; the boolean selects the allowlisted event kind.
 * The raw query value never enters this module, so it can never reach a record
 * field (same invariant as every other coarse input).
 */
export function emitFunnelSignupStartFromMigrationReferrer(
  env: AppEnv,
  request: Request,
  fromMigrationReferrer: boolean,
) {
  emitFunnelEvent(
    env,
    request,
    fromMigrationReferrer ? "signup_start_magicbrief" : "signup_start",
  );
}

export function emitFunnelFirstBriefViewed(env: AppEnv, request: Request) {
  emitFunnelEvent(env, request, "first_brief_viewed");
}
