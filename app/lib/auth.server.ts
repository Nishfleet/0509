import { betterAuth } from "better-auth";
import { redirect } from "react-router";

import { appOrigin, type AppEnv } from "~/lib/env.server";
import type { AppSession } from "~/lib/types";

function fallbackSecret() {
  return "0509-dev-secret-that-is-at-least-32-characters";
}

export function createAuth(env: AppEnv, request: Request) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  const origin = appOrigin(env, request);

  return betterAuth({
    appName: env.APP_NAME ?? "0509",
    baseURL: origin,
    trustedOrigins: [origin],
    secret: env.BETTER_AUTH_SECRET ?? fallbackSecret(),
    database: env.DB,
    user: {
      additionalFields: {
        onboardedAt: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
  });
}

export async function getOptionalSession(
  env: AppEnv,
  request: Request,
): Promise<AppSession | null> {
  if (!env.DB) {
    return null;
  }

  const auth = createAuth(env, request);
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return session as AppSession | null;
}

export async function requireSession(env: AppEnv, request: Request) {
  const session = await getOptionalSession(env, request);

  if (!session) {
    const url = new URL(request.url);
    throw redirect(`/auth/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }

  return session;
}
