import { env } from "cloudflare:workers";
import type { OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { ExternalTokenError, OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { clientIp, withinLimit } from "./client-limit.server";
import { RATE_LIMITED, propsForApiKey } from "./keys.server";
import { AUTHORIZE_PATH, MCP_PATH, READ_SCOPE } from "./paths";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

type Handlers<E> = Pick<OAuthProviderOptions<E>, "apiHandler" | "defaultHandler">;

export function createOAuthProvider<E>(handlers: Handlers<E>): OAuthProvider<E> {
  return new OAuthProvider<E>({
    ...handlers,
    apiRoute: MCP_PATH,
    authorizeEndpoint: AUTHORIZE_PATH,
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
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
    clientRegistrationCallback: async ({ request }) => {
      if (await withinLimit(env.AGENT_REGISTER_LIMIT, clientIp(request))) return;
      return { code: "temporarily_unavailable", description: "Too many app registrations. Retry in a minute.", status: 429 };
    },
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
  });
}
