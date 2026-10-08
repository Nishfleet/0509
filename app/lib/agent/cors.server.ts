import { env } from "cloudflare:workers";

const FORBIDDEN = {
  error: "forbidden_origin",
  error_description: "This origin may not call the MCP server.",
};

function productOrigin(): string {
  return new URL(env.BETTER_AUTH_URL).origin;
}

export function originAllowed(origin: string | null): boolean {
  return origin === null || origin === productOrigin();
}

export function forbiddenOrigin(): Response {
  return Response.json(
    { error: FORBIDDEN.error, error_description: FORBIDDEN.error_description },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

export function agentPreflight(request: Request): Response {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== productOrigin()) return forbiddenOrigin();
  const headers = new Headers({ "cache-control": "no-store" });
  if (origin !== null) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("access-control-allow-headers", "authorization, content-type, accept, mcp-protocol-version");
    headers.set("access-control-max-age", "86400");
  }
  return new Response(null, { status: 204, headers });
}
