import { betterAuth } from "better-auth";
import { redirect } from "react-router";

import { appOrigin, type AppEnv } from "~/lib/env.server";
import type { AppSession } from "~/lib/types";

const DEV_FALLBACK_SECRET = "0509-dev-secret-that-is-at-least-32-characters";
const CUSTOMER_APP_NAME = "Five to Nine";

function isDevelopment() {
  // `nodejs_compat` surfaces process.env.NODE_ENV in Workers; in Vitest it's
  // "test". In production Cloudflare deploys it is "production".
  const mode = (typeof process !== "undefined" ? process.env?.NODE_ENV : undefined) ?? "production";
  return mode === "development" || mode === "test";
}

function resolveAuthSecret(env: AppEnv) {
  if (env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32) {
    return env.BETTER_AUTH_SECRET;
  }

  if (!isDevelopment()) {
    // Fail loudly in production rather than silently signing sessions with a
    // hardcoded dev secret. If this throws, it means the secret was never
    // uploaded to the Worker (`wrangler secret put BETTER_AUTH_SECRET`).
    throw new Error(
      "BETTER_AUTH_SECRET is missing or too short in a non-development environment. " +
        "Upload a 32+ char secret to the Worker before serving traffic.",
    );
  }

  return DEV_FALLBACK_SECRET;
}

export function createAuth(env: AppEnv, request: Request) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  const origin = appOrigin(env, request);

  return betterAuth({
    appName: env.APP_NAME && env.APP_NAME !== "0509" ? env.APP_NAME : CUSTOMER_APP_NAME,
    baseURL: origin,
    trustedOrigins: [origin],
    secret: resolveAuthSecret(env),
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
