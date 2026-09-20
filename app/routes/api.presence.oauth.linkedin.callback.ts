import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { credentialFingerprint, encryptCredential } from "~/lib/credential-crypto.server";
import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { upsertSourceConnection } from "~/lib/presence-data.server";
import { LINKEDIN_OAUTH_SCOPES } from "~/lib/presence-connectors/linkedin.server";

/**
 * The provider redirect completed inside `/api/auth/callback/linkedin`: Better
 * Auth consumed the single-use state, ran the PKCE token exchange and linked
 * an `account` row to this session's user. This route only finalizes the
 * connector — it never trusts the `code`/`state` params on the URL (they are
 * plugin-owned), requires a fresh linked row, then copies the grant into
 * source_connection for the polling path.
 */
const LINKEDIN_LINKED_ACCOUNT_TTL_MS = 10 * 60 * 1000;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getBetterAuthLinkedAccountToken, isBetterAuthConfigured } = await import(
    "~/lib/better-auth.server"
  );
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entity") ?? "";

  const gate = await evaluateConnectorAccessGate(env, "linkedin", "self", workspaceUserId);
  if (!gate.allowed) {
    return redirect("/app/presence?oauth=linkedin_failed");
  }
  if (!isBetterAuthConfigured(env) || !env.DB) {
    return redirect("/app/presence?oauth=linkedin_failed");
  }

  if (entityId) {
    const { getTrackedEntity } = await import("~/lib/presence-data.server");
    const entity = await getTrackedEntity(env, workspaceUserId, entityId);
    if (!entity) {
      return redirect("/app/presence?oauth=linkedin_failed");
    }
  }
  const returnPath = entityId ? `/app/presence/${entityId}` : "/app/presence";

  const account = await env.DB.prepare(
    `SELECT id, accountId, updatedAt FROM account
     WHERE userId = ? AND providerId = 'linkedin'
     ORDER BY updatedAt DESC LIMIT 1`,
  )
    .bind(session.user.id)
    .first<{ id: string; accountId: string; updatedAt: string }>();
  if (
    !account?.id ||
    !Number.isFinite(Date.parse(account.updatedAt)) ||
    Date.now() - Date.parse(account.updatedAt) > LINKEDIN_LINKED_ACCOUNT_TTL_MS
  ) {
    return redirect("/app/presence?oauth=linkedin_failed");
  }

  const accessToken = await getBetterAuthLinkedAccountToken(env, request, {
    accountId: account.id,
  });
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
    scopes: [...LINKEDIN_OAUTH_SCOPES],
    externalAccountId: account.accountId,
    externalAccountLabel: "LinkedIn account",
    lastHealthAt: new Date().toISOString(),
  });

  return redirect(`${returnPath}?oauth=linkedin_connected`);
}
