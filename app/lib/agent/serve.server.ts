import { env } from "cloudflare:workers";

import { readOwnerWorkspaceApiAccess } from "../data/plan.server";
import { clientIp, withinLimit } from "./client-limit.server";
import type { AgentProps } from "./context.server";
import { agentPreflight, forbiddenOrigin, originAllowed } from "./cors.server";
import { RATE_LIMITED, bearerToken, propsForApiKey } from "./keys.server";
import { serveMcp } from "./mcp.server";
import { PROBLEMS, type ProblemCode } from "./problems";

const NO_STORE = { "cache-control": "no-store" };

function problem(code: ProblemCode, headers: Record<string, string> = {}): Response {
  const { status, description } = PROBLEMS[code];
  return Response.json(
    { error: code, error_description: description },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

async function workspaceFor(props: AgentProps): Promise<string | Response> {
  const { success } = await env.AGENT_LIMIT.limit({ key: props.userId });
  if (!success) return problem("rate_limited", { "retry-after": "60" });
  const access = await readOwnerWorkspaceApiAccess(props.userId);
  if (access === null) return problem("no_workspace");
  if (!access.apiAccess) return problem("plan");
  return access.workspaceId;
}

function refuseOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  return originAllowed(origin) ? null : forbiddenOrigin();
}

export async function mcpResponse(request: Request, props: AgentProps): Promise<Response> {
  if (request.method === "OPTIONS") return agentPreflight(request);
  const blocked = refuseOrigin(request);
  if (blocked) return blocked;
  const workspace = await workspaceFor(props);
  if (workspace instanceof Response) return workspace;
  return serveMcp(request, workspace);
}

export async function apiResponse<T>(request: Request, read: (workspaceId: string) => Promise<T>): Promise<Response> {
  if (request.method === "OPTIONS") return agentPreflight(request);
  const blocked = refuseOrigin(request);
  if (blocked) return blocked;
  if (!(await withinLimit(env.AGENT_LIMIT, clientIp(request)))) {
    return problem("rate_limited", { "retry-after": "60" });
  }
  const token = bearerToken(request);
  const props = token === null ? null : await propsForApiKey(token);
  if (props === RATE_LIMITED) {
    return problem("rate_limited", { "retry-after": "60" });
  }
  if (props === null) {
    return problem("invalid_token", { "www-authenticate": 'Bearer realm="0509", error="invalid_token"' });
  }
  const workspace = await workspaceFor(props);
  if (workspace instanceof Response) return workspace;
  return Response.json(await read(workspace), { headers: NO_STORE });
}
