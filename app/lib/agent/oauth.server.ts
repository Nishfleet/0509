import { env } from "cloudflare:workers";
import type { OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { ExternalTokenError, OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { clientIp, withinLimit } from "./client-limit.server";
import { RATE_LIMITED, propsForApiKey } from "./keys.server";
import { denyInsecureRedirects, fetchOAuth } from "./oauth-fetch.server";
import { AUTHORIZE_PATH, MCP_PATH, READ_SCOPE, REGISTER_PATH } from "./paths";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

type Handlers<E> = Pick<OAuthProviderOptions<E>, "apiHandler" | "defaultHandler">;

function oauthOptions<E>(handlers: Handlers<E>): OAuthProviderOptions<E> {
  return {
    ...handlers,
    apiRoute: MCP_PATH,
    authorizeEndpoint: AUTHORIZE_PATH,
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: REGISTER_PATH,
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [READ_SCOPE],
    resourceMetadata: {
      scopes_supported: [READ_SCOPE],
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

export function createOAuthProvider<E>(handlers: Handlers<E>): OAuthProvider<E> {
  const provider = new OAuthProvider<E>(oauthOptions(handlers));
  const inner = provider.fetch.bind(provider);
  const wrapped = Object.create(provider) as OAuthProvider<E>;
  wrapped.fetch = (request, workerEnv, ctx) => fetchOAuth({ inner, request, env: workerEnv, ctx });
  return wrapped;
}
