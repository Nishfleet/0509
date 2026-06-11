import { betterAuth } from "better-auth";
import { redirect } from "react-router";

import { appOrigin, type AppEnv } from "~/lib/env.server";
import type { AppSession } from "~/lib/types";

const CUSTOMER_APP_NAME = "Five to Nine";

function resolveAuthSecret(env: AppEnv) {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (secret && secret.length >= 32) {
    return secret;
  }

  throw new Error(
    "BETTER_AUTH_SECRET must be configured with a 32+ character value before auth can serve traffic.",
  );
}

function isSecureOrigin(origin: string) {
  try {
    return new URL(origin).protocol === "https:";
  } catch {
    return false;
  }
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
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: isSecureOrigin(origin),
        httpOnly: true,
      },
    },
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
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        const { sendPasswordResetEmail } = await import("~/lib/delivery.server");
        await sendPasswordResetEmail(env, {
          userId: user.id,
          email: user.email,
          name: user.name ?? null,
          resetUrl: url,
        });
      },
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
