import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);

  const gate = await evaluateConnectorAccessGate(env, "linkedin", "self", workspaceUserId);
  if (!gate.allowed) {
    return new Response(gate.reasonMessage ?? "LinkedIn connector is not available.", { status: 403 });
  }

  const { betterAuthBaseURL, isBetterAuthConfigured, startBetterAuthAccountLink } =
    await import("~/lib/better-auth.server");
  const linkedinConfigured = Boolean(
    env.LINKEDIN_CLIENT_ID?.trim() && env.LINKEDIN_CLIENT_SECRET?.trim(),
  );
  if (!isBetterAuthConfigured(env) || !linkedinConfigured) {
    return new Response("LinkedIn OAuth is not configured.", { status: 503 });
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

  // The entity rides to the finalize step inside the server-set callbackURL —
  // Better Auth stores it in the signed state and returns us there after the
  // link completes. Nothing client-supplied is trusted for it.
  const baseURL = betterAuthBaseURL(env, request);
  const callbackURL = new URL(`${baseURL}/api/presence/oauth/linkedin/callback`);
  if (entityId) {
    callbackURL.searchParams.set("entity", entityId);
  }

  const linked = await startBetterAuthAccountLink(env, request, {
    provider: "linkedin",
    callbackURL: callbackURL.toString(),
    errorCallbackURL: `${baseURL}/app/presence?oauth=linkedin_failed`,
  });
  return redirect(linked.url);
}
