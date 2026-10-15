import { env } from "cloudflare:workers";

import { readOwnerWorkspaceApiAccess } from "../data/plan.server";
import { clientIp, withinLimit } from "./client-limit.server";
import type { AgentProps } from "./context.server";
import { agentPreflight, forbiddenOrigin, originAllowed } from "./cors.server";
import { RATE_LIMITED, bearerToken, propsForApiKey } from "./keys.server";
import { serveMcp } from "./mcp.server";

const NO_STORE = { "cache-control": "no-store" };

interface Problem {
  error: string;
  description: string;
}

function problem(status: number, body: Problem, headers: Record<string, string> = {}): Response {
  return Response.json(
    { error: body.error, error_description: body.description },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

const RATE_LIMITED_PROBLEM: Problem = {
  error: "rate_limited",
  description: "Too many requests. Slow down and retry in a minute.",
};

async function workspaceFor(props: AgentProps): Promise<string | Response> {
  const { success } = await env.AGENT_LIMIT.limit({ key: props.userId });
  if (!success) return problem(429, RATE_LIMITED_PROBLEM, { "retry-after": "60" });
  const access = await readOwnerWorkspaceApiAccess(props.userId);
  if (access === null)
    return problem(403, { error: "no_workspace", description: "Finish signing up at 0509.io first." });
  if (!access.apiAccess) {
    return problem(403, { error: "plan", description: "This plan does not include API access." });
  }
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
    return problem(429, RATE_LIMITED_PROBLEM, { "retry-after": "60" });
  }
  const token = bearerToken(request);
  const props = token === null ? null : await propsForApiKey(token);
  if (props === RATE_LIMITED) {
    return problem(429, RATE_LIMITED_PROBLEM, { "retry-after": "60" });
  }
  if (props === null) {
    return problem(
      401,
      { error: "invalid_token", description: "Send an API key from Settings as 'Authorization: Bearer <key>'." },
      { "www-authenticate": 'Bearer realm="0509", error="invalid_token"' },
    );
  }
  const workspace = await workspaceFor(props);
  if (workspace instanceof Response) return workspace;
  return Response.json(await read(workspace), { headers: NO_STORE });
}
