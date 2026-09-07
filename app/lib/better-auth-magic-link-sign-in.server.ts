import { redirect } from "react-router";

import type { AppEnv } from "./env.server";
import * as betterAuth from "./better-auth.server";

type BetterAuthMagicLinkConfirmationTicket = NonNullable<
  Awaited<ReturnType<typeof betterAuth.readBetterAuthMagicLinkVerificationTicket>>
>;

function appendSetCookies(headers: Headers, cookies: string[]) {
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
}

export async function completeBetterAuthMagicLinkSignIn(
  env: AppEnv,
  request: Request,
  confirmation: BetterAuthMagicLinkConfirmationTicket,
  extraHeaders?: Headers,
): Promise<never> {
  const failureHeaders = new Headers();
  failureHeaders.set("Cache-Control", "no-store");
  appendSetCookies(failureHeaders, betterAuth.clearBetterAuthMagicLinkConfirmationCookies(request));
  appendSetCookies(failureHeaders, betterAuth.clearBetterAuthMagicLinkStateCookies(request));
  if (extraHeaders) {
    betterAuth.appendHeadersSetCookies(failureHeaders, extraHeaders);
  }

  if (betterAuth.requestHasBetterAuthSessionCookie(request)) {
    throw redirect(confirmation.callbackURL, { headers: failureHeaders });
  }

  let response: Response;
  try {
    response = await betterAuth.verifyBetterAuthMagicLink(env, request, confirmation);
  } catch (error) {
    console.warn(
      "failed to verify Better Auth magic link",
      error instanceof Error ? error.message : "unknown error",
    );
    throw redirect(`/auth/${confirmation.mode}?error=callback_failed`, { headers: failureHeaders });
  }

  const location =
    response.headers.get("Location") ??
    (confirmation.mode === "signup" && confirmation.newUserCallbackURL
      ? confirmation.newUserCallbackURL
      : confirmation.callbackURL);
  const hasSessionCookies = betterAuth.betterAuthResponseHasSessionCookies(response.headers);
  if (
    !hasSessionCookies &&
    (response.status >= 400 || betterAuth.isBetterAuthMagicLinkFailureRedirect(location, request))
  ) {
    console.warn(
      "failed to verify Better Auth magic link",
      response.status,
      location,
    );
    throw redirect(`/auth/${confirmation.mode}?error=callback_failed`, { headers: failureHeaders });
  }

  // BET 7 (issue #1862): a brand-new workspace just completed signup — the
  // magic-link verification established its session. Emit the coarse
  // workspace-scoped `signup_completed` funnel event so scouts can measure
  // the signup -> activation drop-off. Login mode never trips this, and the
  // emit is gated on `hasSessionCookies` so a non-failure response that did
  // not actually set a session never counts as a completion. Measurement is
  // gated by FUNNEL_MEASUREMENT_ENABLED and never fails the sign-in path.
  if (confirmation.mode === "signup" && hasSessionCookies) {
    try {
      const { emitFunnelSignupCompleted } = await import("~/lib/funnel-measurement.server");
      emitFunnelSignupCompleted(env, request);
    } catch {
      // Measurement must never block the sign-in redirect.
    }
  }

  try {
    await betterAuth.consumeBetterAuthMagicLinkConfirmationTicket(env, request);
  } catch (error) {
    console.warn(
      "failed to mark Better Auth magic-link ticket consumed",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  betterAuth.appendBetterAuthSetCookieHeaders(headers, response.headers);
  appendSetCookies(headers, betterAuth.clearBetterAuthMagicLinkConfirmationCookies(request));
  appendSetCookies(headers, betterAuth.clearBetterAuthMagicLinkStateCookies(request));
  if (extraHeaders) {
    betterAuth.appendHeadersSetCookies(headers, extraHeaders);
  }

  throw redirect(location, { headers });
}
