import { logAppEvent } from "~/lib/log.server";
import type { DiscoveryFailureClass } from "~/lib/types";

import type { AppEnv } from "~/lib/env.server";
import {
  sneakerResaleMarketForSignupSource,
  type SneakerResaleLocaleId,
} from "~/lib/locale-markets";

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
  | "signup_start_locale_en"
  | "signup_start_locale_de"
  | "signup_start_locale_ja"
  | "signup_start_locale_pt_br"
  | "pricing_free_card_clicked"
  | "locale_segment_view_en"
  | "locale_segment_view_de"
  | "locale_segment_view_ja"
  | "locale_segment_view_pt_br"
  | "first_brief_viewed"
  | "activation_scan_started"
  | "first_brief_email_sent";

export type FunnelRoute =
  | "home"
  | "search_preview"
  | "magicbrief_migration"
  | "sneaker_resale"
  | "signup"
  | "activation";

/**
 * The exact signup-URL marker the migration page's CTA appends. Recognition
 * happens by comparing against this constant server-side; the marker itself is
 * never stored in a record — it only selects which allowlisted event kind is
 * emitted (`signup_start_magicbrief` instead of `signup_start`).
 */
export const MAGICBRIEF_MIGRATION_SOURCE = "magicbrief-migration";

/**
 * The exact signup-URL marker the /pricing Free card CTA appends (issue
 * #1499). Same contract as the MagicBrief marker: compared server-side
 * against this allowlisted constant, and the raw marker value is never
 * stored in a record or a funnel field. It selects the
 * `pricing_free_card_clicked` kind so scouts can measure whether surfacing
 * the Free plan as a card lifts free-tier click-through.
 */
export const PRICING_FREE_SIGNUP_SOURCE = "pricing-free";

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
  signup_start_locale_en: "signup",
  signup_start_locale_de: "signup",
  signup_start_locale_ja: "signup",
  signup_start_locale_pt_br: "signup",
  pricing_free_card_clicked: "signup",
  locale_segment_view_en: "sneaker_resale",
  locale_segment_view_de: "sneaker_resale",
  locale_segment_view_ja: "sneaker_resale",
  locale_segment_view_pt_br: "sneaker_resale",
  first_brief_viewed: "activation",
  activation_scan_started: "activation",
  first_brief_email_sent: "activation",
};

const FUNNEL_OPERATIONS: Record<FunnelEventKind, string> = {
  home_view: "funnel_home_view",
  search_preview_submit: "funnel_search_preview_submit",
  search_preview_result: "funnel_search_preview_result",
  search_preview_error: "funnel_search_preview_error",
  migration_view: "funnel_migration_view",
  signup_start: "funnel_signup_start",
  signup_start_magicbrief: "funnel_signup_start_magicbrief",
  signup_start_locale_en: "funnel_signup_start_locale_en",
  signup_start_locale_de: "funnel_signup_start_locale_de",
  signup_start_locale_ja: "funnel_signup_start_locale_ja",
  signup_start_locale_pt_br: "funnel_signup_start_locale_pt_br",
  pricing_free_card_clicked: "funnel_pricing_free_card_clicked",
  locale_segment_view_en: "funnel_locale_segment_view_en",
  locale_segment_view_de: "funnel_locale_segment_view_de",
  locale_segment_view_ja: "funnel_locale_segment_view_ja",
  locale_segment_view_pt_br: "funnel_locale_segment_view_pt_br",
  first_brief_viewed: "funnel_first_brief_viewed",
  activation_scan_started: "funnel_activation_scan_started",
  first_brief_email_sent: "funnel_first_brief_email_sent",
};

const FUNNEL_MESSAGES: Record<FunnelEventKind, string> = {
  home_view: "Anonymous homepage view",
  search_preview_submit: "Anonymous search preview submitted",
  search_preview_result: "Anonymous search preview returned results",
  search_preview_error: "Anonymous search preview failed",
  migration_view: "Anonymous MagicBrief migration page view",
  signup_start: "Anonymous signup started",
  signup_start_magicbrief: "Anonymous signup started from the MagicBrief migration page",
  signup_start_locale_en: "Anonymous signup started from the English sneaker-resale page",
  signup_start_locale_de: "Anonymous signup started from the German sneaker-resale page",
  signup_start_locale_ja: "Anonymous signup started from the Japanese sneaker-resale page",
  signup_start_locale_pt_br: "Anonymous signup started from the Brazilian Portuguese sneaker-resale page",
  pricing_free_card_clicked: "Anonymous signup started from the pricing Free card",
  locale_segment_view_en: "Anonymous English sneaker-resale page view",
  locale_segment_view_de: "Anonymous German sneaker-resale page view",
  locale_segment_view_ja: "Anonymous Japanese sneaker-resale page view",
  locale_segment_view_pt_br: "Anonymous Brazilian Portuguese sneaker-resale page view",
  first_brief_viewed: "First brief viewed in session",
  activation_scan_started: "Activation scan started for a signup workspace",
  first_brief_email_sent: "First brief email dispatched",
};

const LOCALE_SEGMENT_VIEW_KIND: Record<SneakerResaleLocaleId, FunnelEventKind> = {
  en: "locale_segment_view_en",
  de: "locale_segment_view_de",
  ja: "locale_segment_view_ja",
  "pt-br": "locale_segment_view_pt_br",
};

const LOCALE_SIGNUP_KIND: Record<SneakerResaleLocaleId, FunnelEventKind> = {
  en: "signup_start_locale_en",
  de: "signup_start_locale_de",
  ja: "signup_start_locale_ja",
  "pt-br": "signup_start_locale_pt_br",
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

/**
 * Account/workspace-scoped activation events. `first_brief_email_sent` can
 * fire from the async delivery path (no user request exists), so its scope is
 * resolved from the kind, never from the presence of a request.
 */
const WORKSPACE_SCOPED_KINDS = new Set<FunnelEventKind>([
  "first_brief_viewed",
  "activation_scan_started",
  "first_brief_email_sent",
]);

function emitFunnelEvent(
  env: AppEnv,
  kind: FunnelEventKind,
  extra: FunnelEventExtra = {},
  request?: Request,
) {
  if (!funnelMeasurementEnabled(env)) {
    return;
  }
  // GPC is a request-header signal. A server-initiated background event
  // (async delivery) carries no request, so there is no header to honor; the
  // field allowlist and account-scope rules still apply unchanged.
  if (request && isGpcOptOut(request)) {
    return;
  }

  const details: Record<string, string> = {
    event_id: crypto.randomUUID(),
    route: FUNNEL_ROUTES[kind],
    account_scope: WORKSPACE_SCOPED_KINDS.has(kind) ? "workspace" : "anonymous",
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
  emitFunnelEvent(env, "home_view", {}, request);
}

export function emitFunnelSearchSubmit(env: AppEnv, request: Request) {
  emitFunnelEvent(env, "search_preview_submit", {}, request);
}

export function emitFunnelSearchResult(env: AppEnv, request: Request, resultCount: number) {
  emitFunnelEvent(env, "search_preview_result", { resultCount }, request);
}

export function emitFunnelSearchError(env: AppEnv, request: Request, errorKind: FunnelErrorKind) {
  emitFunnelEvent(env, "search_preview_error", { errorKind }, request);
}

export function emitFunnelSignupStart(env: AppEnv, request: Request) {
  emitFunnelEvent(env, "signup_start", {}, request);
}

export function emitFunnelMigrationView(env: AppEnv, request: Request) {
  emitFunnelEvent(env, "migration_view", {}, request);
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
    fromMigrationReferrer ? "signup_start_magicbrief" : "signup_start",
    {},
    request,
  );
}

/**
 * Locale sneaker-resale page view. Locale is an allowlisted id, never a
 * caller-controlled string, so it can only select which event kind fires.
 */
export function emitFunnelLocaleSegmentView(
  env: AppEnv,
  request: Request,
  locale: SneakerResaleLocaleId,
) {
  emitFunnelEvent(env, LOCALE_SEGMENT_VIEW_KIND[locale], {}, request);
}

/**
 * Signup attribution from an allowlisted `source=` marker (MagicBrief
 * migration or a sneaker-resale locale page). The raw query value is compared
 * to constants and never stored.
 */
export function emitFunnelSignupStartFromAllowlistedSource(
  env: AppEnv,
  request: Request,
  source: string | null,
) {
  if (source === MAGICBRIEF_MIGRATION_SOURCE) {
    emitFunnelEvent(env, "signup_start_magicbrief", {}, request);
    return;
  }
  if (source === PRICING_FREE_SIGNUP_SOURCE) {
    emitFunnelEvent(env, "pricing_free_card_clicked", {}, request);
    return;
  }
  const localeMarket = sneakerResaleMarketForSignupSource(source);
  if (localeMarket) {
    emitFunnelEvent(env, LOCALE_SIGNUP_KIND[localeMarket.id], {}, request);
    return;
  }
  emitFunnelEvent(env, "signup_start", {}, request);
}

export function emitFunnelFirstBriefViewed(env: AppEnv, request: Request) {
  emitFunnelEvent(env, "first_brief_viewed", {}, request);
}

/**
 * BET 7 (issue #1487): the onboarding flow queued the first activation scan
 * for a signup workspace. Fires inside the same request that created the
 * watchlist, so the standard GPC opt-out applies. Coarse workspace-scoped
 * count only — no watchlist id, competitor name, or URL ever reaches a record.
 */
export function emitFunnelActivationScanStarted(env: AppEnv, request: Request) {
  emitFunnelEvent(env, "activation_scan_started", {}, request);
}

/**
 * BET 7 (issue #1487): the "Your first brief" email was dispatched (digest
 * path with firstBrief: true). May fire without a request from the async
 * scan-completion delivery path, so GPC does not apply there (no request
 * header exists); the field allowlist and workspace scope are unchanged.
 */
export function emitFunnelFirstBriefEmailSent(env: AppEnv) {
  emitFunnelEvent(env, "first_brief_email_sent");
}
