import type { AppEnv, CloudflareRuntimeContext } from "~/lib/env.server";

type GlobalEnvCarrier = typeof globalThis & {
  __APP_REQUEST_ENV__?: AppEnv;
};

export function getCloudflareContext(context: unknown): CloudflareRuntimeContext {
  return (context as { cloudflare: CloudflareRuntimeContext }).cloudflare;
}

export function getEnv(context: unknown): AppEnv {
  const contextEnv = getCloudflareContext(context).env;
  const requestEnv = (globalThis as GlobalEnvCarrier).__APP_REQUEST_ENV__;

  if (!requestEnv) {
    return contextEnv;
  }

  return {
    ...requestEnv,
    ...contextEnv,
  };
}
