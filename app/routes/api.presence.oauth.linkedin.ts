import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import {
  createPresenceOAuthTransaction,
  presenceOAuthConfigured,
} from "~/lib/presence-oauth-transaction.server";
import { buildLinkedInOAuthAuthorizeUrl } from "~/lib/presence-connectors/linkedin.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);

  const gate = await evaluateConnectorAccessGate(env, "linkedin", "self", workspaceUserId);
  if (!gate.allowed) {
    return new Response(gate.reasonMessage ?? "LinkedIn connector is not available.", { status: 403 });
  }

  if (!presenceOAuthConfigured(env)) {
    return new Response("Presence OAuth is not configured.", { status: 503 });
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entity") ?? "";
  if (entityId) {
    const { getTrackedEntity } = await import("~/lib/presence-data.server");
    const entity = await getTrackedEntity(env, workspaceUserId, entityId);
    if (!entity) {
      return redirect("/app/presence?oauth=linkedin_failed");
    }
  }
  const returnPath = entityId ? `/app/presence/${entityId}` : "/app/presence";
  const callbackUri = `${env.BETTER_AUTH_URL?.replace(/\/$/, "") ?? "https://0509.io"}/api/presence/oauth/linkedin/callback`;

  const transaction = await createPresenceOAuthTransaction(env, {
    userId: session.user.id,
    workspaceUserId,
    connectorId: "linkedin",
    callbackUri,
    returnPath,
  });

  const authorizeUrl = buildLinkedInOAuthAuthorizeUrl(env, transaction.state, transaction.pkceChallenge);
  if (!authorizeUrl) {
    return new Response("LinkedIn OAuth is not configured.", { status: 503 });
  }
  return redirect(authorizeUrl);
}
