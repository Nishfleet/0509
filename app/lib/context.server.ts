import type { AppEnv } from "~/lib/env.server";
import { getCloudflareContext } from "~/lib/cloudflare-context";

export { cloudflareRuntimeContext, getCloudflareContext } from "~/lib/cloudflare-context";

type GlobalEnvCarrier = typeof globalThis & {
  __APP_REQUEST_ENV__?: AppEnv;
};

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
