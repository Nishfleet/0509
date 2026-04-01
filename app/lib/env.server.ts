import type { PricingRegion } from "~/lib/types";

export interface AppEnv {
  AI?: Ai;
  APP_NAME?: string;
  APP_REGION_DEFAULT?: PricingRegion | string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  DB?: D1Database;
  LANDING_PAGE_ARTIFACTS?: R2Bucket;
  META_AD_LIBRARY_TOKEN?: string;
  META_AD_LIBRARY_API_VERSION?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

export interface CloudflareRuntimeContext {
  env: AppEnv;
  ctx: ExecutionContext;
  country: string | null;
  requestCf?: Record<string, unknown>;
}

export function appOrigin(env: AppEnv, request: Request) {
  return env.BETTER_AUTH_URL ?? new URL(request.url).origin;
}
