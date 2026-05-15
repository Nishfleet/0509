import type { PricingRegion } from "~/lib/types";

export interface AppEnv {
  AI?: Ai;
  APP_NAME?: string;
  APP_REGION_DEFAULT?: PricingRegion | string;
  BETTER_AUTH_SECRET?: string;
  BROWSER?: Fetcher;
  BROWSERLESS_TOKEN?: string;
  BROWSERLESS_BQL_URL?: string;
  BROWSER_RUN_ACCOUNT_ID?: string;
  BROWSER_RUN_API_TOKEN?: string;
  CANARY_BYPASS_TOKEN?: string;
  BETTER_AUTH_URL?: string;
  DB?: D1Database;
  DODO_0509_BRAND_ID?: string;
  DODO_0509_ENVIRONMENT?: string;
  DODO_0509_PAYMENTS_API_KEY?: string;
  DODO_0509_PAYMENTS_WEBHOOK_KEY?: string;
  DODO_0509_PRODUCT_AGENCY_MONTHLY?: string;
  DODO_0509_PRODUCT_AGENCY_YEARLY?: string;
  DODO_0509_PRODUCT_STARTER_MONTHLY?: string;
  DODO_0509_PRODUCT_STARTER_YEARLY?: string;
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
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_DELIVERY_ENABLED?: string;
  WHATSAPP_GRAPH_API_VERSION?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_TEMPLATE_NAMESPACE?: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
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
  return env.BETTER_AUTH_URL ?? forwardedOrigin(request) ?? new URL(request.url).origin;
}

function parseEnvFlag(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isResendConfigured(env: AppEnv) {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

export function isWhatsAppProviderConfigured(env: AppEnv) {
  return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

export function isCustomerWhatsAppReady(env: AppEnv) {
  return isWhatsAppProviderConfigured(env) && parseEnvFlag(env.WHATSAPP_DELIVERY_ENABLED);
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
