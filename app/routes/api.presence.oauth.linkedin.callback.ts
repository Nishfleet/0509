import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { credentialFingerprint, encryptCredential } from "~/lib/credential-crypto.server";
import { upsertSourceConnection } from "~/lib/presence-data.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const [userId, entityId] = state.split(":");

  if (!code || userId !== session.user.id) {
    return redirect("/app/presence?oauth=linkedin_failed");
  }

  const clientId = env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirect("/app/presence?oauth=linkedin_unconfigured");
  }

  const redirectUri = `${env.BETTER_AUTH_URL?.replace(/\/$/, "") ?? "https://0509.io"}/api/presence/oauth/linkedin/callback`;
  const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenResponse.ok) {
    return redirect("/app/presence?oauth=linkedin_token_failed");
  }

  const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
  const accessToken = tokenPayload.access_token?.trim();
  if (!accessToken) {
    return redirect("/app/presence?oauth=linkedin_token_missing");
  }

  const encrypted = await encryptCredential(env, accessToken);
  const fingerprint = await credentialFingerprint(accessToken);
  await upsertSourceConnection(env, {
    userId: session.user.id,
    trackedEntityId: entityId || null,
    connectorId: "linkedin",
    encryptedCredentials: encrypted,
    credentialFingerprint: fingerprint,
    status: "healthy",
    scopes: ["r_organization_social", "r_basicprofile"],
    externalAccountId: fingerprint,
    externalAccountLabel: "LinkedIn account",
    lastHealthAt: new Date().toISOString(),
  });

  const destination = entityId ? `/app/presence/${entityId}?oauth=linkedin_connected` : "/app/presence?oauth=linkedin_connected";
  return redirect(destination);
}
