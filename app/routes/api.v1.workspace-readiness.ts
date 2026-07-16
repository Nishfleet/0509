import type { LoaderFunctionArgs } from "react-router";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const { getWorkspaceReadiness } = await import("~/lib/workspace-readiness.server");
  const { resolveWorkspace } = await import("~/lib/workspace.server");
  const {
    createAuthenticatedApiLimitContext,
    enforceAuthenticatedApiLimit,
  } = await import("~/lib/authenticated-api-limits.server");
  const env = getEnv(context);
  const auth = await authenticateApiKeyRequest(env, request);
  if (!auth.ok) {
    return auth.response;
  }
  const workspace = await resolveWorkspace(env, auth.apiKey.userId);
  const apiLimit = createAuthenticatedApiLimitContext(env, {
    workspaceUserId: workspace.workspaceUserId,
    actorUserId: auth.apiKey.userId,
    apiKeyId: auth.apiKey.id,
  });
  const limitResponse = await enforceAuthenticatedApiLimit({
    env,
    ...apiLimit,
    operation: "api.v1.workspace-readiness",
    actionClass: "read",
    request,
  });
  if (limitResponse) return limitResponse;
  const apiGate = await requireWorkspacePlanFeature(env, workspace.workspaceUserId, "api_access");
  if (!apiGate.ok) {
    return apiGate.response;
  }

  return Response.json(await getWorkspaceReadiness(env, workspace.workspaceUserId, {
    isMember: workspace.isMember,
    billingOwnerName: workspace.ownerName,
    canManageBilling: !workspace.isMember,
  }), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
