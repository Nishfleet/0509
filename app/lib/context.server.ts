import type { AppEnv, CloudflareRuntimeContext } from "~/lib/env.server";

export function getCloudflareContext(context: unknown): CloudflareRuntimeContext {
  return (context as { cloudflare: CloudflareRuntimeContext }).cloudflare;
}

export function getEnv(context: unknown): AppEnv {
  return getCloudflareContext(context).env;
}
