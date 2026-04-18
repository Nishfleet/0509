import type { PricingRegion } from "~/lib/types";

export interface AppEnv {
  AI?: Ai;
  APP_NAME?: string;
  APP_REGION_DEFAULT?: PricingRegion | string;
  BETTER_AUTH_SECRET?: string;
  BROWSER?: Fetcher;
  BETTER_AUTH_URL?: string;
  DB?: D1Database;
  LANDING_PAGE_ARTIFACTS?: R2Bucket;
  META_AD_LIBRARY_TOKEN?: string;
  META_AD_LIBRARY_API_VERSION?: string;
  MONITORING_WORKFLOW?: Workflow;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
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
