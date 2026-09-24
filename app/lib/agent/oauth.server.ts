import type { OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { propsForApiKey } from "./keys.server";
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
    resolveExternalToken: async ({ token, request }) => {
      const props = await propsForApiKey(token);
      if (props === null) return null;
      return { props, audience: `${new URL(request.url).origin}${MCP_PATH}` };
    },
  });
}
