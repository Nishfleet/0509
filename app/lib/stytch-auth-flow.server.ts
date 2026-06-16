import type { AppEnv } from "~/lib/env.server";
import { safeRedirectPath } from "~/lib/safe-redirect";
import { storeStytchSession, upsertStytchAuthenticatedUser } from "~/lib/data.server";
import {
  clearAuthRequestStateCookie,
  clearAuthRequestPkceCookie,
  clearStytchConfirmationCookie,
  consumeStytchAuthRequest,
  createOrganizationViaDiscovery,
  exchangeIntermediateSession,
  stytchSessionCookie,
  type StytchAuthRequest,
  type StytchOrganization,
  type StytchWorkspaceCreationReason,
} from "~/lib/stytch-b2b.server";

export class StytchUnsupportedAuthPolicyError extends Error {
  constructor() {
    super("Stytch returned an additional auth requirement that Five to Nine does not support yet.");
    this.name = "StytchUnsupportedAuthPolicyError";
  }
}

export async function completeStytchAuthRequest(
  env: AppEnv,
  request: Request,
  authRequest: StytchAuthRequest,
  input:
    | {
        kind: "organization";
        organizationId: string;
      }
    | {
        kind: "create";
        reason: StytchWorkspaceCreationReason;
      },
) {
  if (!authRequest.intermediateSessionToken) {
    throw new Error("Stytch intermediate session token is missing.");
  }

  const session =
    input.kind === "create"
      ? await createOrganizationViaDiscovery(env, {
          intermediateSessionToken: authRequest.intermediateSessionToken,
          organizationName: authRequest.organizationName ?? workspaceNameFromEmail(authRequest.email),
        })
      : await exchangeIntermediateSession(env, {
          intermediateSessionToken: authRequest.intermediateSessionToken,
          organizationId: input.organizationId,
        });

  if (session.member_authenticated === false || !session.session_token || !session.member_session) {
    throw new StytchUnsupportedAuthPolicyError();
  }

  const organization: StytchOrganization = session.organization ?? {
    organization_id: session.member.organization_id,
    organization_name: authRequest.organizationName ?? workspaceNameFromEmail(authRequest.email),
    organization_slug: null,
  };

  const user = await upsertStytchAuthenticatedUser(env, {
    email: session.member.email_address || authRequest.email,
    name: session.member.name || authRequest.name || null,
    stytchMemberId: session.member.member_id,
    stytchOrganizationId: session.member.organization_id,
    stytchOrganizationName: organization.organization_name,
    stytchOrganizationSlug: organization.organization_slug ?? null,
  });
  await storeStytchSession(env, {
    sessionToken: session.session_token,
    userId: user.id,
    memberSessionId: session.member_session.member_session_id,
    expiresAt: session.member_session.expires_at,
  });
  await consumeStytchAuthRequest(env, authRequest.state);

  const headers = new Headers();
  headers.append("Set-Cookie", stytchSessionCookie(env, request, session.session_token));
  headers.append("Set-Cookie", clearAuthRequestStateCookie(request));
  headers.append("Set-Cookie", clearAuthRequestPkceCookie(request));
  headers.append("Set-Cookie", clearStytchConfirmationCookie(request));

  return {
    headers,
    redirectTo: safeRedirectPath(authRequest.redirectTo, "/app"),
  };
}

function workspaceNameFromEmail(email: string) {
  const domain = email.split("@")[1]?.trim();
  if (!domain) {
    return "Five to Nine workspace";
  }

  const rootDomain = domain.split(".").filter(Boolean)[0];
  if (!rootDomain) {
    return "Five to Nine workspace";
  }

  return `${rootDomain.slice(0, 1).toUpperCase()}${rootDomain.slice(1)} workspace`;
}
