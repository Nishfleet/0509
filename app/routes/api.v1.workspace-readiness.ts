import type { LoaderFunctionArgs } from "react-router";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getWorkspaceReadiness } = await import("~/lib/workspace-readiness.server");
  const env = getEnv(context);
  const auth = await authenticateApiKeyRequest(env, request);
  if (!auth.ok) {
    return auth.response;
  }

  return Response.json(await getWorkspaceReadiness(env, auth.apiKey.userId), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
