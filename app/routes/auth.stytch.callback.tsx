import { Form, Link, redirect, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import type { AppEnv } from "~/lib/env.server";
import type { StytchAuthRequest } from "~/lib/stytch-b2b.server";

type CallbackMode = "login" | "signup";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    getLiveStytchAuthRequest,
    isSameBrowserAuthRequest,
    stytchAuthFailurePath,
  } = await import("~/lib/stytch-b2b.server");
  const env = getEnv(context);
  const url = new URL(request.url);
  const token =
    url.searchParams.get("token") ??
    url.searchParams.get("discovery_magic_links_token") ??
    url.searchParams.get("stytch_token") ??
    "";
  const mode: CallbackMode = url.searchParams.get("mode") === "signup" ? "signup" : "login";
  const state = url.searchParams.get("state") ?? "";

  if (!token || !state) {
    throw redirect(stytchAuthFailurePath(mode));
  }

  const authRequest = await getLiveStytchAuthRequest(env, state);
  if (!authRequest || authRequest.mode !== mode) {
    throw redirect(stytchAuthFailurePath(mode));
  }

  if (!isSameBrowserAuthRequest(request, authRequest.state)) {
    return { mode, state, token };
  }

  await completeAuthenticatedCallback({
    authRequest,
    autoComplete: true,
    env,
    mode,
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
  const mode: CallbackMode = formData.get("mode") === "signup" ? "signup" : "login";
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

  return completeAuthenticatedCallback({
    authRequest,
    autoComplete: false,
    env,
    mode,
    request,
    token,
  });
}

export default function StytchCallbackRoute() {
  const { mode, state, token } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";

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
          <span>{mode === "signup" ? "Workspace setup" : "Sign in"}</span>
          <h2>Open Five to Nine?</h2>
          <p>Use this only if you expected a Five to Nine email link.</p>

          <Form className="f9-auth-form" method="post">
            <input name="mode" type="hidden" value={mode} />
            <input name="state" type="hidden" value={state} />
            <input name="token" type="hidden" value={token} />
            <button className="f9-primary-button" disabled={pending} type="submit">
              {pending ? "Checking..." : "Continue"}
            </button>
          </Form>

          <p className="f9-auth-switch">
            Not your link? <Link to="/auth/login">Use another email</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

async function completeAuthenticatedCallback(input: {
  authRequest: StytchAuthRequest;
  autoComplete: boolean;
  env: AppEnv;
  mode: CallbackMode;
  request: Request;
  token: string;
}) {
  const { getUserIdByEmail } = await import("~/lib/data.server");
  const { completeStytchAuthRequest, StytchUnsupportedAuthPolicyError } = await import(
    "~/lib/stytch-auth-flow.server"
  );
  const {
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
    const discovery = await authenticateDiscoveryMagicLink(input.env, input.token);
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
