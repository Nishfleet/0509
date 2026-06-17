import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { StytchOAuthProvider } from "~/lib/stytch-b2b.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`/auth/login?redirectTo=${encodeURIComponent(url.searchParams.get("redirectTo") ?? "/app")}`);
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { isStytchAuthEnabled } = await import("~/lib/env.server");
  const { safeRedirectPath } = await import("~/lib/safe-redirect");
  const {
    authRequestPkceCookie,
    authRequestStateCookie,
    consumeStytchAuthRequest,
    createStytchAuthRequest,
    createStytchPkcePair,
    isSameOriginAuthFormPost,
    isStytchOAuthProviderConfigured,
    stytchOAuthDiscoveryStartUrl,
  } = await import("~/lib/stytch-b2b.server");
  const env = getEnv(context);
  const formData = await request.formData();
  const mode = formData.get("mode") === "signup" ? "signup" : "login";
  const failurePath = mode === "signup" ? "/auth/signup" : "/auth/login";
  const provider = parseProvider(formData.get("provider"));
  const redirectTo = safeRedirectPath(
    String(formData.get("redirectTo") ?? ""),
    mode === "signup" ? "/app/onboard" : "/app",
  );

  if (!provider) {
    throw redirect(`${failurePath}?error=request_invalid`);
  }
  if (!isStytchAuthEnabled(env) || !isStytchOAuthProviderConfigured(env, provider)) {
    throw redirect(`${failurePath}?error=oauth_not_configured`);
  }
  if (!isSameOriginAuthFormPost(env, request)) {
    throw redirect(`${failurePath}?error=request_invalid`);
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const state = await createStytchAuthRequest(env, {
    authMethod: "oauth",
    email,
    mode,
    name,
    organizationName,
    redirectTo,
  });
  const pkce = await createStytchPkcePair();

  let startUrl: string;
  try {
    startUrl = stytchOAuthDiscoveryStartUrl(env, {
      loginHint: email,
      mode,
      pkceCodeChallenge: pkce.challenge,
      provider,
      redirectOrigin: new URL(request.url).origin,
      state,
    });
  } catch (error) {
    await consumeStytchAuthRequest(env, state).catch((consumeError) => {
      console.warn("failed to consume unstarted Stytch OAuth request", consumeError);
    });
    console.warn("failed to start Stytch OAuth", error);
    throw redirect(`${failurePath}?error=oauth_not_configured`);
  }

  const headers = new Headers();
  headers.append("Set-Cookie", authRequestStateCookie(request, state));
  headers.append("Set-Cookie", authRequestPkceCookie(request, state, pkce.verifier));
  throw redirect(startUrl, { headers });
}

function parseProvider(value: FormDataEntryValue | null): StytchOAuthProvider | null {
  if (value === "google" || value === "microsoft") {
    return value;
  }
  return null;
}
