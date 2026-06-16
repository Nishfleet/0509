import { Link, redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import type { AppEnv } from "~/lib/env.server";
import type { StytchAuthRequest } from "~/lib/stytch-b2b.server";

type CallbackMode = "login" | "signup";
type CallbackAuthMethod = "magic_link" | "oauth";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    getLiveStytchAuthRequest,
    isSameBrowserAuthRequest,
    prepareStytchPendingCallbackConfirmation,
    readStytchAuthRequestState,
    readStytchPkceVerifier,
    stytchConfirmationCookie,
    stytchAuthFailurePath,
  } = await import("~/lib/stytch-b2b.server");
  const env = getEnv(context);
  const url = new URL(request.url);
  const token =
    url.searchParams.get("token") ??
      url.searchParams.get("discovery_magic_links_token") ??
      url.searchParams.get("stytch_token") ??
      "";
  const authMethod = callbackAuthMethod(url.searchParams);
  const requestedMode: CallbackMode = url.searchParams.get("mode") === "signup" ? "signup" : "login";
  const state = url.searchParams.get("state") ?? readStytchAuthRequestState(request) ?? "";

  if (!token || !state) {
    throw redirect(stytchAuthFailurePath(requestedMode));
  }

  const authRequest = await getLiveStytchAuthRequest(env, state);
  if (!authRequest) {
    throw redirect(stytchAuthFailurePath(requestedMode));
  }
  if (authRequest.authMethod !== authMethod) {
    throw redirect(stytchAuthFailurePath(authRequest.mode));
  }

  const pkceCodeVerifier = readStytchPkceVerifier(request, authRequest.state);
  const sameBrowser = isSameBrowserAuthRequest(request, authRequest.state);
  if (authMethod === "oauth" && (!sameBrowser || !pkceCodeVerifier)) {
    throw redirect(stytchAuthFailurePath(authRequest.mode));
  }

  if (authMethod === "magic_link") {
    const confirmationSecret = await prepareStytchPendingCallbackConfirmation(
      env,
      authRequest.state,
      {
        authMethod,
        pkceCodeVerifier,
        token,
      },
    );
    throw redirect(`/auth/stytch/confirm?state=${encodeURIComponent(authRequest.state)}`, {
      headers: {
        "Set-Cookie": stytchConfirmationCookie(request, confirmationSecret),
      },
    });
  }

  await completeAuthenticatedCallback({
    authRequest,
    authMethod,
    autoComplete: sameBrowser,
    env,
    mode: authRequest.mode,
    pkceCodeVerifier,
    request,
    token,
  });
  throw new Error("Stytch callback did not redirect.");
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    getLiveStytchAuthRequest,
    isSameOriginAuthFormPost,
    stytchAuthFailurePath,
  } = await import("~/lib/stytch-b2b.server");
  const env = getEnv(context);
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");
  const authMethod = formData.get("method") === "oauth" ? "oauth" : "magic_link";
  const mode: CallbackMode = formData.get("mode") === "signup" ? "signup" : "login";
  const pkceRequired = formData.get("pkce") === "1";
  const state = String(formData.get("state") ?? "");

  if (!isSameOriginAuthFormPost(env, request)) {
    throw new Response("Invalid auth callback request.", { status: 403 });
  }
  if (!token || !state) {
    throw redirect(stytchAuthFailurePath(mode));
  }

  const authRequest = await getLiveStytchAuthRequest(env, state);
  if (!authRequest || authRequest.mode !== mode) {
    throw redirect(stytchAuthFailurePath(mode));
  }
  if (authRequest.authMethod !== authMethod) {
    throw redirect(stytchAuthFailurePath(authRequest.mode));
  }
  const { readStytchPkceVerifier } = await import("~/lib/stytch-b2b.server");
  const pkceCodeVerifier = readStytchPkceVerifier(request, authRequest.state);
  if ((pkceRequired || authMethod === "oauth") && !pkceCodeVerifier) {
    throw redirect(stytchAuthFailurePath(mode));
  }

  return completeAuthenticatedCallback({
    authRequest,
    authMethod,
    autoComplete: false,
    env,
    mode,
    pkceCodeVerifier,
    request,
    token,
  });
}

export default function StytchCallbackRoute() {
  return (
    <main className="f9-auth-page">
      <div className="f9-auth-gradient" aria-hidden="true" />
      <div className="f9-container f9-auth-layout">
        <section className="f9-auth-story">
          <Link className="f9-brand f9-auth-brand" to="/" aria-label="Five to Nine home">
            <BrandWordmark />
          </Link>

          <div>
            <span>Secure link</span>
            <h1>Continue with this email link.</h1>
            <p>Confirm before we verify the one-time link and prepare your Five to Nine session.</p>
          </div>
        </section>

        <div className="f9-auth-card">
          <span>Secure sign-in</span>
          <h2>Checking this sign-in.</h2>
          <p>We are verifying the one-time sign-in response before opening Five to Nine.</p>

          <p className="f9-auth-switch">
            Not your sign-in? <Link to="/auth/login">Use another email</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

async function completeAuthenticatedCallback(input: {
  authRequest: StytchAuthRequest;
  authMethod: CallbackAuthMethod;
  autoComplete: boolean;
  env: AppEnv;
  mode: CallbackMode;
  pkceCodeVerifier?: string | null;
  request: Request;
  token: string;
}) {
  const { getUserIdByEmail } = await import("~/lib/data.server");
  const { completeStytchAuthRequest, StytchUnsupportedAuthPolicyError } = await import(
    "~/lib/stytch-auth-flow.server"
  );
  const {
    authenticateDiscoveryOAuth,
    authenticateDiscoveryMagicLink,
    prepareStytchConfirmation,
    storeStytchIntermediateSession,
    stytchAuthFailurePath,
    stytchAuthRequestMatchesEmail,
    stytchConfirmationCookie,
    stytchMultipleWorkspacesPath,
    stytchNoWorkspacePath,
    stytchWorkspaceCreationReason,
    stytchUnsupportedPolicyPath,
  } = await import("~/lib/stytch-b2b.server");

  try {
    const discovery =
      input.authMethod === "oauth"
        ? await authenticateDiscoveryOAuth(input.env, input.token, input.pkceCodeVerifier)
        : await authenticateDiscoveryMagicLink(input.env, input.token, input.pkceCodeVerifier);
    if (!stytchAuthRequestMatchesEmail(input.authRequest, discovery.email_address)) {
      throw redirect(stytchAuthFailurePath(input.mode));
    }

    await storeStytchIntermediateSession(input.env, input.authRequest.state, {
      email: discovery.email_address,
      intermediateSessionToken: discovery.intermediate_session_token,
    });

    const refreshedAuthRequest = {
      ...input.authRequest,
      email: discovery.email_address.trim().toLowerCase(),
      intermediateSessionToken: discovery.intermediate_session_token,
      name: input.authRequest.name ?? discovery.full_name ?? null,
    };
    const discovered = discovery.discovered_organizations ?? [];
    const firstOrganization = discovered[0]?.organization;
    if (discovered.length > 1) {
      throw redirect(stytchMultipleWorkspacesPath(input.mode));
    }

    const hasExistingLocalUser =
      !firstOrganization && input.mode === "login"
        ? Boolean(await getUserIdByEmail(input.env, discovery.email_address))
        : false;
    const creationReason = stytchWorkspaceCreationReason(input.authRequest, {
      hasExistingLocalUser,
    });
    const organizationSelection = firstOrganization
      ? {
          kind: "organization" as const,
          organizationId: firstOrganization.organization_id,
        }
      : creationReason
        ? {
            kind: "create" as const,
            reason: creationReason,
          }
        : null;
    if (!organizationSelection) {
      throw redirect(stytchNoWorkspacePath(input.mode));
    }

    if (!input.autoComplete) {
      const confirmationSecret = await prepareStytchConfirmation(
        input.env,
        input.authRequest.state,
      );
      throw redirect(`/auth/stytch/confirm?state=${encodeURIComponent(input.authRequest.state)}`, {
        headers: {
          "Set-Cookie": stytchConfirmationCookie(input.request, confirmationSecret),
        },
      });
    }

    const result = await completeStytchAuthRequest(
      input.env,
      input.request,
      refreshedAuthRequest,
      organizationSelection,
    );
    throw redirect(result.redirectTo, { headers: result.headers });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    if (error instanceof StytchUnsupportedAuthPolicyError) {
      throw redirect(stytchUnsupportedPolicyPath(input.mode));
    }
    console.error("stytch callback failed", error);
    throw redirect(stytchAuthFailurePath(input.mode));
  }
}

function callbackAuthMethod(searchParams: URLSearchParams): CallbackAuthMethod {
  if (
    searchParams.get("method") === "oauth" ||
    searchParams.get("stytch_token_type") === "discovery_oauth"
  ) {
    return "oauth";
  }

  return "magic_link";
}
