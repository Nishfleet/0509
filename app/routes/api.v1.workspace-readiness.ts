import type { LoaderFunctionArgs } from "react-router";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getWorkspaceReadiness } = await import("~/lib/workspace-readiness.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const env = getEnv(context);
  const auth = await authenticateApiKeyRequest(env, request);
  if (!auth.ok) {
    return auth.response;
  }
  const workspaceUserId = await resolveWorkspaceDataUserId(env, auth.apiKey.userId);
  const apiGate = await requireWorkspacePlanFeature(env, workspaceUserId, "api_access");
  if (!apiGate.ok) {
    return apiGate.response;
  }

  return Response.json(await getWorkspaceReadiness(env, auth.apiKey.userId), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
