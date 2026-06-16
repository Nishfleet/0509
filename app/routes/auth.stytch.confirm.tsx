import { Form, Link, redirect, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

export const links: LinksFunction = () => canonicalLinks("/auth/stytch/confirm");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Confirm sign-in | Five to Nine",
    description: "Confirm the Five to Nine workspace you want to open.",
    pathname: "/auth/stytch/confirm",
  });

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserIdByEmail } = await import("~/lib/data.server");
  const {
    getLiveStytchAuthRequest,
    listDiscoveredOrganizations,
    rotateStytchConfirmationNonce,
    stytchAuthFailurePath,
    stytchMultipleWorkspacesPath,
    stytchNoWorkspacePath,
    stytchWorkspaceCreationReason,
    verifyStytchConfirmationSecret,
  } = await import("~/lib/stytch-b2b.server");
  const env = getEnv(context);
  const currentSession = await getOptionalSession(env, request);

  if (currentSession) {
    throw redirect("/app");
  }

  const state = new URL(request.url).searchParams.get("state") ?? "";
  const authRequest = state ? await getLiveStytchAuthRequest(env, state) : null;
  if (!authRequest?.intermediateSessionToken || !verifyStytchConfirmationSecret(request, authRequest)) {
    throw redirect("/auth/login?error=callback_failed");
  }

  try {
    const discovery = await listDiscoveredOrganizations(env, {
      intermediateSessionToken: authRequest.intermediateSessionToken,
    });
    const organizations = discovery.discovered_organizations;
    if (organizations.length > 1) {
      throw redirect(stytchMultipleWorkspacesPath(authRequest.mode));
    }

    const organization = organizations[0]?.organization;
    const hasExistingLocalUser =
      !organization && authRequest.mode === "login"
        ? Boolean(await getUserIdByEmail(env, discovery.email_address || authRequest.email))
        : false;
    const creationReason = stytchWorkspaceCreationReason(authRequest, { hasExistingLocalUser });
    if (!organization && !creationReason) {
      throw redirect(stytchNoWorkspacePath(authRequest.mode));
    }

    const nonce = await rotateStytchConfirmationNonce(env, authRequest.state);
    return {
      email: discovery.email_address || authRequest.email,
      nonce,
      organizationName: organization?.organization_name ?? authRequest.organizationName ?? "Five to Nine workspace",
      state: authRequest.state,
    };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("stytch confirm loader failed", error);
    throw redirect(stytchAuthFailurePath(authRequest.mode));
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { getUserIdByEmail } = await import("~/lib/data.server");
  const { completeStytchAuthRequest, StytchUnsupportedAuthPolicyError } = await import(
    "~/lib/stytch-auth-flow.server"
  );
  const {
    getLiveStytchAuthRequest,
    listDiscoveredOrganizations,
    stytchAuthFailurePath,
    stytchMultipleWorkspacesPath,
    stytchNoWorkspacePath,
    stytchWorkspaceCreationReason,
    stytchUnsupportedPolicyPath,
    verifyStytchConfirmationNonce,
    verifyStytchConfirmationSecret,
  } = await import("~/lib/stytch-b2b.server");
  const env = getEnv(context);
  const formData = await request.formData();
  const state = String(formData.get("state") ?? "");
  const authRequest = state ? await getLiveStytchAuthRequest(env, state) : null;

  if (
    !authRequest?.intermediateSessionToken ||
    !verifyStytchConfirmationSecret(request, authRequest) ||
    !verifyStytchConfirmationNonce(authRequest, String(formData.get("nonce") ?? ""))
  ) {
    throw redirect("/auth/login?error=callback_failed");
  }

  try {
    const discovery = await listDiscoveredOrganizations(env, {
      intermediateSessionToken: authRequest.intermediateSessionToken,
    });
    const organizations = discovery.discovered_organizations;
    if (organizations.length > 1) {
      throw redirect(stytchMultipleWorkspacesPath(authRequest.mode));
    }

    const organization = organizations[0]?.organization;
    const hasExistingLocalUser =
      !organization && authRequest.mode === "login"
        ? Boolean(await getUserIdByEmail(env, discovery.email_address || authRequest.email))
        : false;
    const creationReason = stytchWorkspaceCreationReason(authRequest, { hasExistingLocalUser });
    const organizationSelection = organization
      ? {
          kind: "organization" as const,
          organizationId: organization.organization_id,
        }
      : creationReason
        ? {
            kind: "create" as const,
            reason: creationReason,
          }
        : null;
    if (!organizationSelection) {
      throw redirect(stytchNoWorkspacePath(authRequest.mode));
    }

    const result = await completeStytchAuthRequest(
      env,
      request,
      authRequest,
      organizationSelection,
    );
    throw redirect(result.redirectTo, { headers: result.headers });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    if (error instanceof StytchUnsupportedAuthPolicyError) {
      throw redirect(stytchUnsupportedPolicyPath(authRequest.mode));
    }
    console.error("stytch confirm failed", error);
    throw redirect(stytchAuthFailurePath(authRequest.mode));
  }
}

export default function StytchConfirmRoute() {
  const { email, nonce, organizationName, state } = useLoaderData<typeof loader>();
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
            <span>Confirm sign-in</span>
            <h1>Open this workspace?</h1>
            <p>This link was opened outside the browser that requested it, so confirm before we start a session.</p>
          </div>
        </section>

        <div className="f9-auth-card">
          <span>{email}</span>
          <h2>{organizationName}</h2>
          <p>Continue only if you expected this Five to Nine sign-in link.</p>

          <Form className="f9-auth-form" method="post">
            <input name="state" type="hidden" value={state} />
            <input name="nonce" type="hidden" value={nonce} />
            <button className="f9-primary-button" disabled={pending} type="submit">
              {pending ? "Opening..." : "Continue"}
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
