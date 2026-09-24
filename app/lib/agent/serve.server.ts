import { env } from "cloudflare:workers";

import { readWorkspaceIdForOwner } from "../data/workspace.server";
import type { AgentProps } from "./context.server";
import { bearerToken, propsForApiKey } from "./keys.server";
import { serveMcp } from "./mcp.server";

const NO_STORE = { "cache-control": "no-store" };

function problem(status: number, error: string, description: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error, error_description: description }, { status, headers: { ...NO_STORE, ...headers } });
}

async function workspaceFor(props: AgentProps): Promise<string | Response> {
  const { success } = await env.AGENT_LIMIT.limit({ key: props.userId });
  if (!success) return problem(429, "rate_limited", "Too many requests. Slow down and retry in a minute.", { "retry-after": "60" });
  const workspaceId = await readWorkspaceIdForOwner(props.userId);
  if (workspaceId === null) return problem(403, "no_workspace", "Finish signing up at 0509.io first.");
  return workspaceId;
}

export async function mcpResponse(request: Request, props: AgentProps): Promise<Response> {
  const workspace = await workspaceFor(props);
  if (workspace instanceof Response) return workspace;
  return serveMcp(request, workspace);
}

export async function apiResponse<T>(request: Request, read: (workspaceId: string) => Promise<T>): Promise<Response> {
  const token = bearerToken(request);
  const props = token === null ? null : await propsForApiKey(token);
  if (props === null) {
    return problem(401, "invalid_token", "Send an API key from Settings as 'Authorization: Bearer <key>'.", {
      "www-authenticate": 'Bearer realm="0509", error="invalid_token"',
    });
  }
  const workspace = await workspaceFor(props);
  if (workspace instanceof Response) return workspace;
  return Response.json(await read(workspace), { headers: NO_STORE });
}
