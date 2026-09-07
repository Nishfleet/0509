import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { credentialFingerprint, encryptCredential } from "~/lib/credential-crypto.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { upsertSourceConnection } from "~/lib/presence-data.server";
import {
  consumePresenceOAuthTransaction,
  verifyPresenceOAuthState,
} from "~/lib/presence-oauth-transaction.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";

const LINKEDIN_TOKEN_TIMEOUT_MS = 10_000;
const LINKEDIN_TOKEN_JSON_MAX_BYTES = 64_000;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const callbackUri = `${env.BETTER_AUTH_URL?.replace(/\/$/, "") ?? "https://0509.io"}/api/presence/oauth/linkedin/callback`;

  if (!code) {
    return redirect("/app/presence?oauth=linkedin_failed");
  }

  const gate = await evaluateConnectorAccessGate(env, "linkedin", "self", workspaceUserId);
  if (!gate.allowed) {
    return redirect("/app/presence?oauth=linkedin_failed");
  }

  const verified = await verifyPresenceOAuthState(env, state);
  if (!verified.ok) {
    return redirect("/app/presence?oauth=linkedin_failed");
  }

  const consumed = await consumePresenceOAuthTransaction(env, {
    transactionId: verified.transactionId,
    userId: session.user.id,
    workspaceUserId,
    connectorId: "linkedin",
    callbackUri,
  });
  if (!consumed.ok) {
    return redirect("/app/presence?oauth=linkedin_failed");
  }

  const clientId = env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirect("/app/presence?oauth=linkedin_unconfigured");
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetchWithTimeout(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: callbackUri,
          client_id: clientId,
          client_secret: clientSecret,
          code_verifier: consumed.transaction.pkceVerifier,
        }),
      },
      { timeoutMs: LINKEDIN_TOKEN_TIMEOUT_MS },
    );
  } catch {
    return redirect("/app/presence?oauth=linkedin_token_failed");
  }

  if (!tokenResponse.ok) {
    releaseFetchTimeout(tokenResponse);
    return redirect("/app/presence?oauth=linkedin_token_failed");
  }

  const tokenPayload =
    (await readResponseJsonWithinLimit<{ access_token?: string }>(
      tokenResponse,
      LINKEDIN_TOKEN_JSON_MAX_BYTES,
    )) ?? {};
  const accessToken = tokenPayload.access_token?.trim();
  if (!accessToken) {
    return redirect("/app/presence?oauth=linkedin_token_missing");
  }

  const encrypted = await encryptCredential(env, accessToken);
  const fingerprint = await credentialFingerprint(accessToken);
  const entityId = consumed.transaction.returnPath.startsWith("/app/presence/")
    ? consumed.transaction.returnPath.split("/").pop() ?? null
    : null;

  await upsertSourceConnection(env, {
    userId: session.user.id,
    trackedEntityId: entityId,
    connectorId: "linkedin",
    encryptedCredentials: encrypted,
    credentialFingerprint: fingerprint,
    status: "healthy",
    scopes: ["r_organization_social", "r_basicprofile"],
    externalAccountId: fingerprint,
    externalAccountLabel: "LinkedIn account",
    lastHealthAt: new Date().toISOString(),
  });

  const destination = entityId
    ? `/app/presence/${entityId}?oauth=linkedin_connected`
    : "/app/presence?oauth=linkedin_connected";
  return redirect(destination);
}
