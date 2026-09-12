import type { BrowserWorker } from "@cloudflare/puppeteer";

export type BrowserBinding = BrowserWorker;

export interface EmailAddress {
  email: string;
  name: string;
}

export interface EmailSendingBinding {
  send(message: {
    from: string | EmailAddress;
    to: string | EmailAddress | (string | EmailAddress)[];
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string | EmailAddress;
    headers?: Record<string, string>;
  }): Promise<{ messageId: string } | undefined>;
}

// Edge Rate Limiting bindings (issue #2985) use the generated runtime type
// `RateLimit` (worker-configuration.d.ts): capacity lives ON the binding
// (wrangler.jsonc `simple: { limit, period }`), and the call is
// `limit({ key })` — there is no per-call rate override in this API
// generation. One binding per scope, so each budget is enforced by the
// platform.
export type EdgeRateLimitBindingName =
  | "RL_AUTH"
  | "RL_AUTH_GET"
  | "RL_SEARCH_ANON_BROWSER"
  | "RL_PROOF_BRIEF"
  | "RL_SEARCH_SELECTION"
  | "RL_SEARCH_IP"
  | "RL_BRAND_PAGE"
  | "RL_WRITE"
  | "RL_STATUS"
  | "RL_DELIVERY_WEBHOOK"
  | "RL_API_READ"
  | "RL_WEBHOOK";

export interface AppEnv {
  AI?: Ai;
  APP_NAME?: string;
  APP_ORIGIN?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  AUTH_PROVIDER?: string;
  BETTER_AUTH_GOOGLE_CLIENT_ID?: string;
  BETTER_AUTH_GOOGLE_CLIENT_SECRET?: string;
  BETTER_AUTH_MICROSOFT_CLIENT_ID?: string;
  BETTER_AUTH_MICROSOFT_CLIENT_SECRET?: string;
  BETTER_AUTH_MICROSOFT_ACCOUNT_LINKING_TRUSTED?: string;
  BETTER_AUTH_MICROSOFT_TENANT_ID?: string;
  BETTER_AUTH_OAUTH_BRANDED_PROVIDERS?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  BROWSER?: BrowserBinding;
  BROWSERLESS_TOKEN?: string;
  BROWSERLESS_BQL_URL?: string;
  BROWSER_RUN_ACCOUNT_ID?: string;
  BROWSER_RUN_API_TOKEN?: string;
  BROWSER_RUN_SESSION_REUSE?: string;
  CANARY_BYPASS_TOKEN?: string;
  BETTER_AUTH_URL?: string;
  DB?: D1Database;
  /**
   * Native Cloudflare Rate Limiting bindings (issue #2985): counting for the
   * public hot-path scopes happens at the edge, off D1 — one binding per
   * scope, with the capacity configured on the binding (wrangler.jsonc
   * `simple: { limit, period }`). Declared optional only because e2e-mode
   * fixtures and unit tests build env objects by hand; production
   * wrangler.jsonc declares them all, and the limiter fails closed
   * (429 + Retry-After) when a production-like runtime runs without one.
   */
  RL_AUTH?: RateLimit;
  RL_SEARCH_ANON_BROWSER?: RateLimit;
  RL_PROOF_BRIEF?: RateLimit;
  RL_SEARCH_SELECTION?: RateLimit;
  RL_SEARCH_IP?: RateLimit;
  RL_BRAND_PAGE?: RateLimit;
  RL_WRITE?: RateLimit;
  RL_STATUS?: RateLimit;
  RL_DELIVERY_WEBHOOK?: RateLimit;
  RL_API_READ?: RateLimit;
  RL_WEBHOOK?: RateLimit;
  DODO_0509_ADAPTIVE_CURRENCY?: string;
  DODO_0509_ADAPTIVE_CURRENCY_FEES_INCLUSIVE?: string;
  DODO_0509_API_KEY?: string;
  DODO_0509_BRAND_ID?: string;
  DODO_0509_ENVIRONMENT?: string;
  DODO_0509_MODE?: string;
  DODO_0509_PRODUCT_AGENCY_MONTHLY_ID?: string;
  DODO_0509_PRODUCT_AGENCY_YEARLY_ID?: string;
  DODO_0509_PRODUCT_SCOUT_MONTHLY_ID?: string;
  DODO_0509_PRODUCT_SCOUT_YEARLY_ID?: string;
  DODO_0509_PRODUCT_PROOF_PACK_500_ID?: string;
  DODO_0509_PRODUCT_PROOF_PACK_2000_ID?: string;
  DODO_0509_PRODUCT_PROOF_PACK_7500_ID?: string;
  DODO_0509_PRODUCT_STARTER_MONTHLY_ID?: string;
  DODO_0509_PRODUCT_STARTER_YEARLY_ID?: string;
  DODO_0509_WEBHOOK_SECRET?: string;
  DODO_API_KEY?: string;
  DODO_PAYMENTS_API_KEY?: string;
  EMAIL?: EmailSendingBinding;
  EMAIL_FROM_EMAIL?: string;
  /** Full-Site Watch: sitemap discovery + bounded crawl + per-class cadence
   * for competitor websites. Off by default; when off, zero behavior change,
   * zero site-scan writes, zero events. */
  FULLSITE_WATCH_ENABLED?: string;
  /**
   * Optional host allowlist for the first Full-Site Watch canary. Space- or
   * comma-separated hostnames (www. is ignored). When set, only matching
   * advertiser websites are scanned; when empty, every watchlist with a
   * public website URL participates. Rollback of the canary is emptying this
   * list or flipping FULLSITE_WATCH_ENABLED off.
   */
  FULLSITE_WATCH_CANARY_HOSTS?: string;
  /** Local release-proof guard. Never configure this in preview or production. */
  E2E_PROVIDER_NETWORK_DENY?: string;
  E2E_TEST_MODE?: string;
  /** Google Search Console ownership verification token. Rendered as a
   * <meta name="google-site-verification"> head tag when set; unset means no
   * tag and no behavior change. The value comes from the owner's Search
   * Console property (wrangler secret), never from the repo. */
  GOOGLE_SITE_VERIFICATION?: string;
  /**
   * Explicit server-side gate for anonymous funnel measurement (see
   * docs/funnel-measurement-spec.md). Absent or any value other than
   * "1"/"true"/"yes"/"on" leaves measurement disabled; it can never be
   * accidentally true from an absent variable. Collection is NOT live in
   * production until the spec's rollout gates pass and this variable is
   * deliberately set.
   */
  FUNNEL_MEASUREMENT_ENABLED?: string;
  LANDING_PAGE_ARTIFACTS?: R2Bucket;
  /**
   * Explicit gate for the R2 -> D1 orphan reconciliation delete path. Absent or
   * any value other than "1"/"true"/"yes"/"on" leaves the step in dry-run
   * mode (counts only, no deletes). Set deliberately only after the dry-run
   * has been exercised against production.
   */
  R2_ORPHAN_RECONCILE_ENABLED?: string;
  LAUNCH_CANARY_EMAIL?: string;
  /**
   * Optional override for the Gate C billing canary's *dedicated* identity
   * (issue #2646). The billing canary never borrows LAUNCH_CANARY_EMAIL: it
   * runs on its own non-customer account so the release gate cannot be held
   * red by the live billing state of a real customer.
   */
  BILLING_CANARY_EMAIL?: string;
  ALLOW_PLATFORM_META_API_FALLBACK?: string;
  META_AD_LIBRARY_TOKEN?: string;
  META_AD_LIBRARY_API_VERSION?: string;
  META_TOKEN_ENCRYPTION_SECRET?: string;
  // Serp provider for the Google Search source (#2181, seam #2218). Accepted
  // values: "decodo" (default) or "gateway". When unset, the registry defaults
  // to "decodo". DECODO_SCRAPER_AUTH is the optional bearer token for the
  // Decodo scraper API; store as a secret (see wrangler.jsonc secret list).
  SERP_PROVIDER?: string;
  DECODO_SCRAPER_AUTH?: string;
  // KV namespace for the Decodo monthly budget counters (#2181, seam #2218).
  // Optional until #2181 wires the binding in wrangler.jsonc; the budget
  // helper treats an absent binding as "no quota enforced".
  DECODO_BUDGET?: KVNamespace;
  MONITORING_WORKFLOW?: Workflow;
  OPS_ALLOWLIST_EMAILS?: string;
  UNSUBSCRIBE_SIGNING_SECRET?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_DELIVERY_ENABLED?: string;
  WHATSAPP_GRAPH_API_VERSION?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_TEMPLATE_NAMESPACE?: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  MONITORING_FANOUT_MODE?: string;
  MONITORING_FANOUT_ALLOWLIST?: string;
  MONITORING_FANOUT_GLOBAL?: string;
  /** Owner-documented internal workspace user id for fan-out pilot proof (never a customer id). */
  MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID?: string;
  MONITORING_FANOUT_MAX_INFLIGHT?: string;
  MONITORING_ORCHESTRATION_LEASE_MS?: string;
  MONITORING_ORCHESTRATION_MAX_AGE_MS?: string;
  MONITORING_CONCURRENCY_SLOT_LEASE_MS?: string;
  MONITORING_SCHEDULED_BROWSER_ALLOWLIST?: string;
  MONITORING_SCHEDULED_BROWSER_MODE?: string;
  SEARCH_ROLLOUT_MODE?: string;
  ADS_DOMAIN_PUBLISHER_CAP?: string;
  /**
   * Public /ads/:domain brand-page indexing brake. Unset or "1" = indexable
   * (fresh cached pages carry no robots meta); explicitly "0" = emergency
   * noindex on every /ads/* page. Cache-miss shells, demo-sourced data, and
   * cache older than 7 days are ALWAYS noindex regardless of this flag.
   */
  PUBLIC_BRAND_PAGES_INDEXABLE?: string;
  /**
   * Public Offer Timeline share-link chrome. Unset or any value other than
   * "0" shows the copyable `/timeline/:domain` URL. Explicit "0" hides it
   * (rollback for #967 share-link generation). The timeline route itself
   * still renders logged out.
   */
  PUBLIC_OFFER_TIMELINE_SHARE?: string;
  PRESENCE_WEBSITE_ROLLOUT?: string;
  PRESENCE_X_ROLLOUT?: string;
  PRESENCE_REDDIT_ROLLOUT?: string;
  PRESENCE_LINKEDIN_ROLLOUT?: string;
  /** RSS/Atom/JSON Feed mention connector rollout: disabled | internal | pilot | ga. Defaults to disabled (gated, off by default). */
  PRESENCE_RSS_ROLLOUT?: string;
  /** GDELT mainstream-news mention connector rollout: disabled | internal | pilot | ga. Defaults to disabled (gated, off by default). */
  PRESENCE_GDELT_ROLLOUT?: string;
  /** Digest delivery rollout: disabled | internal | pilot | ga. Defaults to disabled (notifications off). */
  PRESENCE_DIGEST_ROLLOUT?: string;
  /**
   * BET 7 — same-session first brief. When true, the onboarding watchlist
   * creation queues the activation scan with a `signup_first_brief` reason and
   * redirects to `/app/onboard?step=first-brief`, which renders the captured
   * brief inline. Default off for the first 48h post-merge (rollback is a flag
   * flip, not a code revert). See issue #1276.
   */
  SIGNUP_FIRST_BRIEF_ENABLED?: string;
  /**
   * Agency mode org-keyed ownership gate (issue #2176). When true, new
   * watchlists, rooms, share links and API keys are dual-written with an
   * org_id. Default off until Nish flips it — the Agency plan stays fiction
   * until the data model is organization-scoped.
   */
  AGENCY_ORG_MODE_ENABLED?: string;
  /** HMAC secret for one-time OAuth transactions (32+ bytes). Fail closed when missing. */
  PRESENCE_OAUTH_STATE_SECRET?: string;
  /** Owner-documented internal workspace user id for presence pilot (never a customer id). */
  PRESENCE_INTERNAL_WORKSPACE_ID?: string;
  PRESENCE_X_MOCK?: string;
  PRESENCE_REDDIT_MOCK?: string;
  PRESENCE_LINKEDIN_MOCK?: string;
  X_API_BEARER_TOKEN?: string;
  PRESENCE_BLUESKY_MOCK?: string;
  /** Fleet-owned Bluesky app-password credential (issue #3252). Never logged,
   *  never persisted outside source_connection.encrypted_credentials. */
  BSKY_IDENTIFIER?: string;
  BSKY_APP_PASSWORD?: string;
  /** Integration-test overrides for the XRPC endpoints (IP-literal fixture
   *  hosts skip the SSRF DNS hop). Unset in production. */
  PRESENCE_BSKY_PDS_URL?: string;
  PRESENCE_BSKY_APPVIEW_URL?: string;
  PRESENCE_BLUESKY_ROLLOUT?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  REDDIT_COMMERCIAL_ACCESS?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
}

export interface CloudflareRuntimeContext {
  env: AppEnv;
  ctx: ExecutionContext;
  country: string | null;
  requestCf?: Record<string, unknown>;
  // Per-request CSP nonce (issue #2348). The worker generates one nonce per
  // fetch, threads it here so app/root.tsx can stamp it onto React Router's
  // <Scripts>/<Links>/<ScrollRestoration> and the two boot scripts, and passes
  // the same value to withSecurityHeaders for the script-src 'nonce-…' entry.
  cspNonce?: string;
}

// Client-supplied proto must be http(s) and the host a bare hostname (optional
// port, no credentials or path); anything else fails closed to request.url so a
// spoofed header cannot steer token-bearing links to an attacker origin.
const FORWARDED_PROTO_PATTERN = /^https?$/i;
const FORWARDED_HOST_PATTERN = /^[a-z0-9.-]+(?::\d+)?$/i;

function forwardedOrigin(request: Request) {
  const forwarded = request.headers.get("forwarded");
  if (forwarded) {
    const firstHop = forwarded.split(",")[0]?.trim();
    const protoMatch = firstHop?.match(/(?:^|;)proto=([^;]+)/i);
    const hostMatch = firstHop?.match(/(?:^|;)host=([^;]+)/i);
    const proto = protoMatch?.[1]?.trim().replace(/^"|"$/g, "");
    const host = hostMatch?.[1]?.trim().replace(/^"|"$/g, "");

    if (proto && host) {
      if (!FORWARDED_PROTO_PATTERN.test(proto) || !FORWARDED_HOST_PATTERN.test(host)) {
        return null;
      }
      return `${proto.toLowerCase()}://${host}`;
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (!forwardedHost || !FORWARDED_HOST_PATTERN.test(forwardedHost)) {
    return null;
  }

  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(request.url).protocol.replace(/:$/, "");
  if (!FORWARDED_PROTO_PATTERN.test(forwardedProto)) {
    return null;
  }

  return `${forwardedProto.toLowerCase()}://${forwardedHost}`;
}

export function appOrigin(env: AppEnv, request: Request) {
  return env.APP_ORIGIN ?? env.BETTER_AUTH_URL ?? forwardedOrigin(request) ?? new URL(request.url).origin;
}

export function isBetterAuthEnabled(env: AppEnv) {
  return (env.AUTH_PROVIDER ?? "").trim().toLowerCase() === "better-auth";
}

function parseEnvFlag(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/** Full-Site Watch gate. When false, no site scans run and nothing writes. */
export function isFullSiteWatchEnabled(env: AppEnv) {
  return parseEnvFlag(env.FULLSITE_WATCH_ENABLED);
}

function normalizeFullSiteWatchHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** Hosts allowed while the production canary is in force. Empty = every host. */
export function parseFullSiteWatchCanaryHosts(env: AppEnv): string[] {
  const raw = env.FULLSITE_WATCH_CANARY_HOSTS?.trim();
  if (!raw) {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map(normalizeFullSiteWatchHost)
        .filter(Boolean),
    ),
  ];
}

/**
 * True when Full-Site Watch may scan this website URL. The feature flag is
 * still required; a canary host list, when present, further restricts to
 * those hostnames (and their subdomains).
 */
export function isFullSiteWatchAllowedForHost(env: AppEnv, websiteUrl: string): boolean {
  if (!isFullSiteWatchEnabled(env)) {
    return false;
  }
  const canary = parseFullSiteWatchCanaryHosts(env);
  if (canary.length === 0) {
    return true;
  }
  let host: string;
  try {
    host = normalizeFullSiteWatchHost(new URL(websiteUrl).hostname);
  } catch {
    return false;
  }
  if (!host) {
    return false;
  }
  return canary.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/** BET 7 — same-session first brief gate (issue #1276). Default off. */
export function isSignupFirstBriefEnabled(env: AppEnv) {
  return parseEnvFlag(env.SIGNUP_FIRST_BRIEF_ENABLED);
}

/** Agency mode org-keyed ownership gate (issue #2176). Default off. */
export function isAgencyOrgModeEnabled(env: AppEnv) {
  return parseEnvFlag(env.AGENCY_ORG_MODE_ENABLED);
}

export function emailFromAddress(env: AppEnv) {
  return env.EMAIL_FROM_EMAIL?.trim() || "";
}

// The one customer-facing sender identity. Configuration detection stays
// string-based (isEmailSendingConfigured depends on emailFromAddress), so the
// display name lives in this separate object-returning helper.
export const EMAIL_FROM_NAME = "Five to Nine";

export function emailFromSender(env: AppEnv): EmailAddress {
	return { email: emailFromAddress(env), name: EMAIL_FROM_NAME };
}

export function isEmailSendingConfigured(env: AppEnv) {
  return Boolean(env.EMAIL && emailFromAddress(env));
}

export function isWhatsAppProviderConfigured(env: AppEnv) {
  return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

export function isCustomerWhatsAppReady(env: AppEnv) {
  return isWhatsAppProviderConfigured(env) && parseEnvFlag(env.WHATSAPP_DELIVERY_ENABLED);
}

export function isWhatsAppWebhookConfigured(env: AppEnv) {
  return Boolean(env.WHATSAPP_APP_SECRET?.trim() && env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim());
}

export function whatsappGraphApiVersion(env: AppEnv) {
  return env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v23.0";
}

export function operatorAllowlistEmails(env: AppEnv) {
  return (env.OPS_ALLOWLIST_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isOpsUserAllowed(env: AppEnv, email: string | null | undefined) {
  if (!email) {
    return false;
  }

  const allowlist = operatorAllowlistEmails(env);
  if (allowlist.length === 0) {
    return false;
  }

  return allowlist.includes(email.trim().toLowerCase());
}
