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
  | "signup_start"
  | "signup_start_locale_en"
  | "signup_start_locale_de"
  | "signup_start_locale_ja"
  | "signup_start_locale_pt_br"
  | "pricing_free_card_clicked"
  | "search_likely_confirm_signup_started"
  | "locale_segment_view_en"
  | "locale_segment_view_de"
  | "locale_segment_view_ja"
  | "locale_segment_view_pt_br"
  | "signup_completed"
  | "first_brief_generated"
  | "first_brief_viewed"
  | "activation_scan_started"
  | "first_brief_email_sent";

export type FunnelRoute =
  | "home"
  | "search_preview"
  | "sneaker_resale"
  | "signup"
  | "activation";

/**
 * The exact signup-URL marker the /pricing Free card CTA appends (issue
 * #1499). Recognition happens by comparing server-side
 * against this allowlisted constant, and the raw marker value is never
 * stored in a record or a funnel field. It selects the
 * `pricing_free_card_clicked` kind so scouts can measure whether surfacing
 * the Free plan as a card lifts free-tier click-through.
 */
export const PRICING_FREE_SIGNUP_SOURCE = "pricing-free";

/**
 * The exact signup-URL marker the /search Likely-match confirm control
 * carries (issue #3306, BET 2 finish line): a signed-out visitor's one-click
 * "Yes, that's them" on a Likely-match row starts the signup intent with the
 * confirmed brand's context carried through. Recognition happens by comparing
 * server-side against this allowlisted constant, and the raw marker value is
 * never stored in a record or a funnel field. It selects the
 * `search_likely_confirm_signup_started` kind so scouts can measure whether
 * the Likely-match confirm lifts signup starts.
 */
export const SEARCH_LIKELY_CONFIRM_SIGNUP_SOURCE = "search-likely-confirm";

export type FunnelResultBucket = "0" | "1-10" | "11-50" | "51+";

export type FunnelErrorKind = "rate_limited" | "provider" | "empty_result" | "internal";

export const FUNNEL_MEASUREMENT_ENABLED_VAR = "FUNNEL_MEASUREMENT_ENABLED";

const FUNNEL_ENABLE_VALUES = new Set(["1", "true", "yes", "on"]);

const FUNNEL_ROUTES: Record<FunnelEventKind, FunnelRoute> = {
  home_view: "home",
  search_preview_submit: "search_preview",
  search_preview_result: "search_preview",
  search_preview_error: "search_preview",
  signup_start: "signup",
  signup_start_locale_en: "signup",
  signup_start_locale_de: "signup",
  signup_start_locale_ja: "signup",
  signup_start_locale_pt_br: "signup",
  pricing_free_card_clicked: "signup",
  search_likely_confirm_signup_started: "signup",
  locale_segment_view_en: "sneaker_resale",
  locale_segment_view_de: "sneaker_resale",
  locale_segment_view_ja: "sneaker_resale",
  locale_segment_view_pt_br: "sneaker_resale",
  signup_completed: "activation",
  first_brief_generated: "activation",
  first_brief_viewed: "activation",
  activation_scan_started: "activation",
  first_brief_email_sent: "activation",
};

const FUNNEL_OPERATIONS: Record<FunnelEventKind, string> = {
  home_view: "funnel_home_view",
  search_preview_submit: "funnel_search_preview_submit",
  search_preview_result: "funnel_search_preview_result",
  search_preview_error: "funnel_search_preview_error",
  signup_start: "funnel_signup_start",
  signup_start_locale_en: "funnel_signup_start_locale_en",
  signup_start_locale_de: "funnel_signup_start_locale_de",
  signup_start_locale_ja: "funnel_signup_start_locale_ja",
  signup_start_locale_pt_br: "funnel_signup_start_locale_pt_br",
  pricing_free_card_clicked: "funnel_pricing_free_card_clicked",
  search_likely_confirm_signup_started: "funnel_search_likely_confirm_signup_started",
  locale_segment_view_en: "funnel_locale_segment_view_en",
  locale_segment_view_de: "funnel_locale_segment_view_de",
  locale_segment_view_ja: "funnel_locale_segment_view_ja",
  locale_segment_view_pt_br: "funnel_locale_segment_view_pt_br",
  signup_completed: "funnel_signup_completed",
  first_brief_generated: "funnel_first_brief_generated",
  first_brief_viewed: "funnel_first_brief_viewed",
  activation_scan_started: "funnel_activation_scan_started",
  first_brief_email_sent: "funnel_first_brief_email_sent",
};

const FUNNEL_MESSAGES: Record<FunnelEventKind, string> = {
  home_view: "Anonymous homepage view",
  search_preview_submit: "Anonymous search preview submitted",
  search_preview_result: "Anonymous search preview returned results",
  search_preview_error: "Anonymous search preview failed",
  signup_start: "Anonymous signup started",
  signup_start_locale_en: "Anonymous signup started from the English sneaker-resale page",
  signup_start_locale_de: "Anonymous signup started from the German sneaker-resale page",
  signup_start_locale_ja: "Anonymous signup started from the Japanese sneaker-resale page",
  signup_start_locale_pt_br: "Anonymous signup started from the Brazilian Portuguese sneaker-resale page",
  pricing_free_card_clicked: "Anonymous signup started from the pricing Free card",
  search_likely_confirm_signup_started: "Anonymous signup started from the search Likely-match confirm",
  locale_segment_view_en: "Anonymous English sneaker-resale page view",
  locale_segment_view_de: "Anonymous German sneaker-resale page view",
  locale_segment_view_ja: "Anonymous Japanese sneaker-resale page view",
  locale_segment_view_pt_br: "Anonymous Brazilian Portuguese sneaker-resale page view",
  signup_completed: "Signup completed via magic-link verification",
  first_brief_generated: "First brief generated for a signup workspace",
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

/** Spec §4 field allowlist. Anything else is stripped before a record is logged. */
const FUNNEL_DETAIL_ALLOWLIST = [
  "event_id",
  "workspace_id",
  "timestamp",
  "route",
  "result_count_bucket",
  "error_kind",
  "referrer_domain",
  "account_scope",
] as const;

function allowlistedFunnelDetails(details: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FUNNEL_DETAIL_ALLOWLIST) {
    const value = details[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Account/workspace-scoped activation events. `first_brief_email_sent` can
 * fire from the async delivery path (no user request exists), so its scope is
 * resolved from the kind, never from the presence of a request.
 */
const WORKSPACE_SCOPED_KINDS = new Set<FunnelEventKind>([
  "signup_completed",
  "first_brief_generated",
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
    details: allowlistedFunnelDetails(details),
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
 * Signup attribution from an allowlisted `source=` marker (the /pricing
 * Free card or a sneaker-resale locale page). The raw query value is compared
 * to constants and never stored.
 */
export function emitFunnelSignupStartFromAllowlistedSource(
  env: AppEnv,
  request: Request,
  source: string | null,
) {
  if (source === PRICING_FREE_SIGNUP_SOURCE) {
    emitFunnelEvent(env, "pricing_free_card_clicked", {}, request);
    return;
  }
  if (source === SEARCH_LIKELY_CONFIRM_SIGNUP_SOURCE) {
    emitFunnelEvent(env, "search_likely_confirm_signup_started", {}, request);
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
 * BET 7 (issue #1862, OAuth follow-up #1872): a signup completed — a
 * brand-new workspace was created. Fires on the magic-link verification
 * request (mode `signup`) and on the Better Auth OAuth callback request that
 * created a brand-new user. Returning users sign in via the login path and
 * never trip this. Fires inside the same request that set the session
 * cookies, so the standard GPC opt-out applies. Coarse workspace-scoped
 * count only — no email, name, or user id ever reaches a record.
 */
export function emitFunnelSignupCompleted(env: AppEnv, request: Request) {
  emitFunnelEvent(env, "signup_completed", {}, request);
}

/**
 * BET 7 (issue #1862): the first-brief digest was filed for a signup
 * workspace — the activation scan's baseline capture became an on-screen
 * brief. May fire without a request from the async scan-completion path
 * (same as `first_brief_email_sent`), so GPC does not apply there; the field
 * allowlist and workspace scope are unchanged.
 */
export function emitFunnelFirstBriefGenerated(env: AppEnv) {
  emitFunnelEvent(env, "first_brief_generated");
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

/**
 * Issue #2407: did the WP-25 activation-result email actually reach status
 * `sent`? The dispatch runs inside the scan path, where a delivery failure is
 * deliberately swallowed so it can never roll back a successful scan
 * (`maybeSendFreeActivationResultEmail` in `~/lib/monitoring.server`), and
 * `claimInstantDeliveryAttempt` returns "duplicate" when an earlier attempt
 * exists. A surface that says "we've emailed this brief to you" therefore has
 * to read the durable `delivery_attempt` row instead of assuming the dispatch
 * succeeded.
 *
 * The key is the one the sender claims the email under —
 * `activation-result:<userId>:<watchlistId>` in
 * `~/lib/delivery-account-emails.server`.
 *
 * Returns false for a missing row, a pending row, and a failed row: the
 * caller renders the honest "on its way" copy instead. A read failure is
 * logged and also returns false — the honest copy is the safe direction, and
 * a delivery-state lookup must never 500 the brief surface.
 */
export async function activationResultEmailSent(
  env: AppEnv,
  input: { userId: string; watchlistId: string },
): Promise<boolean> {
  const idempotencyKey = `activation-result:${input.userId}:${input.watchlistId}`;
  try {
    const { getDeliveryAttemptByIdempotencyKey } = await import(
      "~/lib/data.server"
    );
    const attempt = await getDeliveryAttemptByIdempotencyKey(
      env,
      idempotencyKey,
    );
    return attempt?.status === "sent";
  } catch (error) {
    logAppEvent(
      "warn",
      "activation_result_delivery_state_unreadable",
      "Could not read the activation-result delivery attempt",
      {
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      },
    );
    return false;
  }
}
