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
  BROWSERLESS_PROOF_ALLOWLIST_ORIGINS?: string;
  BROWSERLESS_TOKEN?: string;
  BROWSERLESS_BQL_URL?: string;
  BROWSER_RUN_ACCOUNT_ID?: string;
  BROWSER_RUN_API_TOKEN?: string;
  BROWSER_RUN_SESSION_REUSE?: string;
  CANARY_BYPASS_TOKEN?: string;
  BETTER_AUTH_URL?: string;
  DB?: D1Database;
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
  /** Local release-proof guard. Never configure this in preview or production. */
  E2E_PROVIDER_NETWORK_DENY?: string;
  E2E_TEST_MODE?: string;
  /**
   * Explicit opt-in for the first-party anonymous funnel measurement layer
   * (docs/funnel-measurement-spec.md). Absent or any non-true value means
   * collection is off; it can never be enabled accidentally by a missing
   * variable. The spec's legal-review and retention-period gates remain
   * unpassed, so production must not set this.
   */
  FUNNEL_MEASUREMENT_ENABLED?: string;
  LANDING_PAGE_ARTIFACTS?: R2Bucket;
  LAUNCH_CANARY_EMAIL?: string;
  ALLOW_PLATFORM_META_API_FALLBACK?: string;
  META_AD_LIBRARY_TOKEN?: string;
  META_AD_LIBRARY_API_VERSION?: string;
  META_TOKEN_ENCRYPTION_SECRET?: string;
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
  /**
   * Public /ads/:domain brand-page indexing brake. Unset or "1" = indexable
   * (fresh cached pages carry no robots meta); explicitly "0" = emergency
   * noindex on every /ads/* page. Cache-miss shells, demo-sourced data, and
   * cache older than 7 days are ALWAYS noindex regardless of this flag.
   */
  PUBLIC_BRAND_PAGES_INDEXABLE?: string;
  PRESENCE_WEBSITE_ROLLOUT?: string;
  PRESENCE_X_ROLLOUT?: string;
  PRESENCE_REDDIT_ROLLOUT?: string;
  PRESENCE_LINKEDIN_ROLLOUT?: string;
  /** Digest delivery rollout: disabled | internal | pilot | ga. Defaults to disabled (notifications off). */
  PRESENCE_DIGEST_ROLLOUT?: string;
  /** HMAC secret for one-time OAuth transactions (32+ bytes). Fail closed when missing. */
  PRESENCE_OAUTH_STATE_SECRET?: string;
  /** Owner-documented internal workspace user id for presence pilot (never a customer id). */
  PRESENCE_INTERNAL_WORKSPACE_ID?: string;
  PRESENCE_X_MOCK?: string;
  PRESENCE_REDDIT_MOCK?: string;
  PRESENCE_LINKEDIN_MOCK?: string;
  X_API_BEARER_TOKEN?: string;
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
}

function forwardedOrigin(request: Request) {
  const forwarded = request.headers.get("forwarded");
  if (forwarded) {
    const firstHop = forwarded.split(",")[0]?.trim();
    const protoMatch = firstHop?.match(/(?:^|;)proto=([^;]+)/i);
    const hostMatch = firstHop?.match(/(?:^|;)host=([^;]+)/i);
    const proto = protoMatch?.[1]?.trim().replace(/^"|"$/g, "");
    const host = hostMatch?.[1]?.trim().replace(/^"|"$/g, "");

    if (proto && host) {
      return `${proto}://${host}`;
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (!forwardedHost) {
    return null;
  }

  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(request.url).protocol.replace(/:$/, "");

  return `${forwardedProto}://${forwardedHost}`;
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

export function isFunnelMeasurementEnabled(env: AppEnv) {
  return parseEnvFlag(env.FUNNEL_MEASUREMENT_ENABLED);
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
