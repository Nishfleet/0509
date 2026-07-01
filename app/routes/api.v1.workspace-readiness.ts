import type { LoaderFunctionArgs } from "react-router";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getWorkspaceReadiness } = await import("~/lib/workspace-readiness.server");
  const { resolveWorkspace } = await import("~/lib/workspace.server");
  const env = getEnv(context);
  const auth = await authenticateApiKeyRequest(env, request);
  if (!auth.ok) {
    return auth.response;
  }
  const workspace = await resolveWorkspace(env, auth.apiKey.userId);

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
