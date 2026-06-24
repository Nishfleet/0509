import type { BrowserWorker } from "@cloudflare/puppeteer";

export type BrowserBinding = BrowserWorker;

export interface EmailAddress {
  email: string;
  name?: string;
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
  LANDING_PAGE_ARTIFACTS?: R2Bucket;
  LAUNCH_CANARY_EMAIL?: string;
  ALLOW_PLATFORM_META_API_FALLBACK?: string;
  META_AD_LIBRARY_TOKEN?: string;
  META_AD_LIBRARY_API_VERSION?: string;
  META_TOKEN_ENCRYPTION_SECRET?: string;
  MONITORING_WORKFLOW?: Workflow;
  OPS_ALLOWLIST_EMAILS?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_PLAN_AGENCY_MONTHLY?: string;
  RAZORPAY_PLAN_AGENCY_YEARLY?: string;
  RAZORPAY_PLAN_STARTER_MONTHLY?: string;
  RAZORPAY_PLAN_STARTER_YEARLY?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
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
  MONITORING_CONCURRENCY_SLOT_LEASE_MS?: string;
  SEARCH_ROLLOUT_MODE?: string;
  PRESENCE_WEBSITE_ROLLOUT?: string;
  PRESENCE_X_ROLLOUT?: string;
  PRESENCE_REDDIT_ROLLOUT?: string;
  PRESENCE_LINKEDIN_ROLLOUT?: string;
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
