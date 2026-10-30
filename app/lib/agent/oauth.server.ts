import { env } from "cloudflare:workers";
import type { OAuthHelpers, OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { ExternalTokenError, getOAuthApi, OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { clientIp, withinLimit } from "./client-limit.server";
import { RATE_LIMITED, propsForApiKey } from "./keys.server";
import { denyInsecureRedirects, fetchOAuth } from "./oauth-fetch.server";
import { AUTHORIZE_PATH, MCP_PATH, READ_SCOPE, REGISTER_PATH } from "./paths";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export type OAuthHandlers<E> = Pick<OAuthProviderOptions<E>, "apiHandler" | "defaultHandler">;

function oauthOptions<E>(handlers: OAuthHandlers<E>, resource: string): OAuthProviderOptions<E> {
  return {
    ...handlers,
    apiRoute: MCP_PATH,
    authorizeEndpoint: AUTHORIZE_PATH,
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: REGISTER_PATH,
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [READ_SCOPE],
    requiredScopes: [READ_SCOPE],
    resourceMetadata: {
      resource,
      bearer_methods_supported: ["header"],
      resource_name: "Five to Nine",
    },
    accessTokenTTL: HOUR,
    refreshTokenTTL: 30 * DAY,
    clientRegistrationTTL: 30 * DAY,
    clientRegistrationCallback: denyInsecureRedirects,
    resolveExternalToken: async ({ token, request }) => {
      if (!(await withinLimit(env.AGENT_LIMIT, clientIp(request)))) {
        throw new ExternalTokenError("temporarily_unavailable", {
          description: "Too many requests. Slow down and retry in a minute.",
          statusCode: 429,
          headers: { "retry-after": "60" },
        });
      }
      const props = await propsForApiKey(token);
      if (props === RATE_LIMITED) {
        throw new ExternalTokenError("temporarily_unavailable", {
          description: "Too many requests. Slow down and retry in a minute.",
          statusCode: 429,
          headers: { "retry-after": "60" },
        });
      }
      if (props === null) return null;
      return { props, audience: `${new URL(request.url).origin}${MCP_PATH}` };
    },
  };
}

export function createOAuthProvider<E>(handlers: OAuthHandlers<E>, resource: string): OAuthProvider<E> {
  const provider = new OAuthProvider<E>(oauthOptions(handlers, resource));
  const inner = provider.fetch.bind(provider);
  const wrapped = Object.create(provider) as OAuthProvider<E>;
  wrapped.fetch = (request, workerEnv, ctx) => fetchOAuth({ inner, request, env: workerEnv, ctx });
  return wrapped;
}

const NO_ROUTE = { fetch: () => Promise.resolve(new Response(null, { status: 404 })) };

export function oauthHelpers(workerEnv: Env): OAuthHelpers {
  const resource = `${new URL(workerEnv.BETTER_AUTH_URL).origin}${MCP_PATH}`;
  return getOAuthApi<Env>(oauthOptions<Env>({ apiHandler: NO_ROUTE, defaultHandler: NO_ROUTE }, resource), workerEnv);
}
