import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { recordFunnelEvent } from "~/lib/funnel-measurement.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "signup" ? "signup" : "login";
  throw redirect(`/auth/${mode}`);
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { safeRedirectPath } = await import("~/lib/safe-redirect");
  const {
    appendBetterAuthSetCookieHeaders,
    isBetterAuthConfigured,
    isBetterAuthOAuthProvider,
    isBetterAuthOAuthProviderConfigured,
    isSameOriginAuthFormPost,
    startBetterAuthSocialSignIn,
  } = await import("~/lib/better-auth.server");

  const env = getEnv(context);
  const formData = await request.formData();
  const mode = String(formData.get("mode") ?? "") === "signup" ? "signup" : "login";
  const providerValue = String(formData.get("provider") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const redirectTo = safeRedirectPath(
    String(formData.get("redirectTo") ?? ""),
    mode === "signup" ? "/app#setup-checklist" : "/app",
  );

  if (
    !isBetterAuthConfigured(env) ||
    !isBetterAuthOAuthProvider(providerValue) ||
    !isBetterAuthOAuthProviderConfigured(env, providerValue)
  ) {
    throw redirect(`/auth/${mode}?error=oauth_not_configured`);
  }

  if (!isSameOriginAuthFormPost(env, request)) {
    throw redirect(`/auth/${mode}?error=request_invalid`);
  }

  if (mode === "signup") {
    recordFunnelEvent(env, request, { event: "funnel_signup_start" });
  }

  const oauthStart = await startBetterAuthSocialSignIn(env, request, {
    loginHint: email,
    mode,
    provider: providerValue,
    redirectTo,
  });
  const headers = new Headers();
  appendBetterAuthSetCookieHeaders(headers, oauthStart.headers);
  throw redirect(oauthStart.url, { headers });
}
