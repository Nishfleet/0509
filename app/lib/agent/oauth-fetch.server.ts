import type { ClientRegistrationCallbackOptions } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";

import { cappedBody } from "../fetch/outbound.server";
import { clientIp, withinLimit } from "./client-limit.server";
import { agentPreflight } from "./cors.server";
import { MCP_PATH, REGISTER_MAX_BYTES, REGISTER_PATH } from "./paths";
import { allowedRedirectUri } from "./redirect-uri";

type OAuthFetch<E> = (request: Request, env: E, ctx: ExecutionContext) => Promise<Response>;

const TOO_MANY = {
  error: "temporarily_unavailable",
  error_description: "Too many app registrations. Retry in a minute.",
};

const TOO_LARGE = {
  error: "invalid_request",
  error_description: "Request payload too large, must be under 1 MiB",
};

function jsonError(status: number, body: { error: string; error_description: string }): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function withCanonicalMcp(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === MCP_PATH || url.pathname.toLowerCase() !== MCP_PATH) return request;
  url.pathname = MCP_PATH;
  return new Request(url, request);
}

export function denyInsecureRedirects({
  clientMetadata,
}: ClientRegistrationCallbackOptions): { code: string; description: string; status: number } | undefined {
  const uris = clientMetadata.redirect_uris;
  if (!Array.isArray(uris) || uris.some((uri) => typeof uri !== "string" || !allowedRedirectUri(uri))) {
    return {
      code: "invalid_redirect_uri",
      description: "Redirect URIs must be https or loopback http.",
      status: 400,
    };
  }
  return undefined;
}

interface OAuthCall<E> {
  inner: OAuthFetch<E>;
  request: Request;
  env: E;
  ctx: ExecutionContext;
}

async function gatedRegister<E>(call: OAuthCall<E>): Promise<Response> {
  if (!(await withinLimit(env.AGENT_REGISTER_LIMIT, clientIp(call.request)))) return jsonError(429, TOO_MANY);
  const bytes = await cappedBody(
    new Response(call.request.body, { headers: call.request.headers }),
    REGISTER_MAX_BYTES,
  );
  if (bytes === null) return jsonError(413, TOO_LARGE);
  const body = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  body.set(bytes);
  return call.inner(
    new Request(call.request.url, { method: call.request.method, headers: call.request.headers, body }),
    call.env,
    call.ctx,
  );
}

export function fetchOAuth<E>(call: OAuthCall<E>): Promise<Response> {
  const request = withCanonicalMcp(call.request);
  const path = new URL(request.url).pathname;
  const next = { ...call, request };
  if (request.method === "OPTIONS" && path === MCP_PATH) return Promise.resolve(agentPreflight(request));
  if (request.method === "POST" && path === REGISTER_PATH) return gatedRegister(next);
  return call.inner(request, call.env, call.ctx);
}
