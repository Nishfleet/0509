import type { AppEnv } from "~/lib/env.server";
import { safeRedirectPath } from "~/lib/safe-redirect";

export const EMAIL_UNVERIFIED_ERROR = "email_unverified" as const;

export const EMAIL_UNVERIFIED_MESSAGE =
  "Verify your email before creating a watchlist or receiving digests. Check your inbox for a verification link, or request a new one from account settings.";

/**
 * Better Auth stores `user.emailVerified` as an integer boolean in D1.
 * Magic-link completion sets this true; OAuth follows the provider claim;
 * otherwise the dedicated verification email flow must flip it.
 */
export async function isUserEmailVerified(env: AppEnv, userId: string): Promise<boolean> {
  if (!env.DB || !userId.trim() || typeof env.DB.prepare !== "function") {
    return false;
  }

  // DB errors intentionally propagate: a transient D1 failure must surface as
  // a failed delivery attempt (retryable) or a failed action, never be
  // silently treated as "unverified" — that shape drops paid digests with no
  // retry signal.
  const row = await env.DB.prepare(
    "SELECT emailVerified FROM user WHERE id = ? LIMIT 1",
  )
    .bind(userId)
    .first<{ emailVerified: number | boolean | null }>();

  if (!row) {
    return false;
  }

  return row.emailVerified === 1 || row.emailVerified === true;
}

export async function requireVerifiedEmailForRetention(
  env: AppEnv,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: typeof EMAIL_UNVERIFIED_ERROR; message: string }> {
  if (await isUserEmailVerified(env, userId)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: EMAIL_UNVERIFIED_ERROR,
    message: EMAIL_UNVERIFIED_MESSAGE,
  };
}

export function emailUnverifiedActionResult() {
  return {
    ok: false as const,
    error: EMAIL_UNVERIFIED_ERROR,
    message: EMAIL_UNVERIFIED_MESSAGE,
  };
}

/**
 * Trigger Better Auth's documented sendVerificationEmail path for a signed-in
 * user. callbackURL/redirectTo are always sanitized with safeRedirectPath.
 * Returns a generic ok so unauthenticated callers cannot enumerate accounts.
 */
export async function requestEmailVerification(
  env: AppEnv,
  request: Request,
  input: {
    email: string;
    callbackURL?: string | null;
  },
): Promise<{ ok: true }> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    return { ok: true };
  }

  try {
    const { getBetterAuth, isBetterAuthConfigured } = await import("~/lib/better-auth.server");
    if (!isBetterAuthConfigured(env)) {
      return { ok: true };
    }

    const callbackURL = safeRedirectPath(input.callbackURL, "/app");
    const auth = getBetterAuth(env, request);
    await auth.api.sendVerificationEmail({
      body: {
        email,
        callbackURL,
      },
      headers: request.headers,
    });
  } catch {
    // Anti-enumeration: identical success whether the user exists, is already
    // verified, or the provider rejects the send.
  }

  return { ok: true };
}
