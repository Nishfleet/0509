import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createExecutionContext, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { decideConsent, readConsent } from "../../app/lib/agent/consent.server";
import { createOAuthProvider } from "../../app/lib/agent/oauth.server";

const ORIGIN = "http://localhost";
const REDIRECT = "https://app.example/callback";
const VERIFIER = "a-long-enough-pkce-code-verifier-for-this-test-0123456789";

type TestEnv = typeof env & { OAUTH_PROVIDER?: OAuthHelpers };

const captured: { helpers?: OAuthHelpers } = {};

const provider = createOAuthProvider<TestEnv>({
  apiHandler: { fetch: (_request, _env, ctx) => Response.json(ctx.props) },
  defaultHandler: {
    fetch: (_request, handlerEnv) => {
      captured.helpers = handlerEnv.OAUTH_PROVIDER;
      return new Response("default");
    },
  },
});

function send(request: Request): Promise<Response> {
  return provider.fetch(request, { ...env }, createExecutionContext());
}

async function challenge(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

let helpers: OAuthHelpers;
let clientId: string;
let authorizeUrl: string;

beforeAll(async () => {
  await send(new Request(`${ORIGIN}/`));
  if (!captured.helpers) throw new Error("the provider did not hand over its helpers");
  helpers = captured.helpers;
  const client = await helpers.createClient({
    redirectUris: [REDIRECT],
    clientName: "Test App",
    tokenEndpointAuthMethod: "none",
  });
  clientId = client.clientId;
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: "s1",
    code_challenge: await challenge(),
    code_challenge_method: "S256",
    resource: `${ORIGIN}/mcp`,
  });
  authorizeUrl = `${ORIGIN}/oauth/authorize?${query.toString()}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, 1, ?4, ?4)').bind(
      "u_oauth",
      "OAuth Owner",
      "oauth@test.dev",
      now,
    ),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES ('ws_oauth', 'oauth', 'u_oauth', 'UTC', ?1)").bind(now),
  ]);
});

describe("an AI app signing in to 0509", () => {
  it("names the app and where the user goes back to before asking", async () => {
    expect(await readConsent(helpers, new Request(authorizeUrl))).toEqual({
      kind: "ask",
      appName: "Test App",
      returnsTo: "app.example",
    });
  });

  it("renders a broken link locally instead of redirecting to an unregistered address", async () => {
    const tampered = authorizeUrl.replace(encodeURIComponent(REDIRECT), encodeURIComponent("https://evil.example/cb"));
    expect(await readConsent(helpers, new Request(tampered))).toMatchObject({ kind: "error" });
  });

  it("sends a refusal back to the app with its state and no code", async () => {
    const response = await decideConsent(helpers, new Request(authorizeUrl, { method: "POST" }), {
      userId: "u_oauth",
      allow: false,
    });
    expect(response).toBeInstanceOf(Response);
    const location = new URL((response as Response).headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("s1");
    expect(location.searchParams.has("code")).toBe(false);
  });

  it("issues a read-only token after a yes, and /mcp sees only the user who said yes", async () => {
    const response = await decideConsent(helpers, new Request(authorizeUrl, { method: "POST" }), {
      userId: "u_oauth",
      allow: true,
    });
    const location = new URL((response as Response).headers.get("location") ?? "");
    const code = location.searchParams.get("code") ?? "";
    expect(code).not.toBe("");
    expect(location.searchParams.get("state")).toBe("s1");

    const token = await send(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT,
          client_id: clientId,
          code_verifier: VERIFIER,
          resource: `${ORIGIN}/mcp`,
        }),
      }),
    );
    expect(token.status).toBe(200);
    const tokens: { access_token: string; scope: string } = await token.json();
    expect(tokens.scope).toBe("read");

    const mcp = await send(new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } }));
    expect(mcp.status).toBe(200);
    expect(await mcp.json()).toEqual({ userId: "u_oauth", clientId });

    const grants = await helpers.listUserGrants("u_oauth");
    expect(grants.items.map((grant) => grant.metadata)).toEqual([{ appName: "Test App" }]);
    await helpers.revokeGrant(grants.items[0]?.id ?? "", "u_oauth");
    const revoked = await send(new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } }));
    expect(revoked.status).toBe(401);
  });

  it("refuses an authorization request without PKCE, even from a confidential app", async () => {
    const withoutPkce = new URL(authorizeUrl);
    withoutPkce.searchParams.delete("code_challenge");
    withoutPkce.searchParams.delete("code_challenge_method");
    const response = await decideConsent(helpers, new Request(withoutPkce, { method: "POST" }), {
      userId: "u_oauth",
      allow: true,
    });
    expect(response).toBeInstanceOf(Response);
    const location = new URL((response as Response).headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.has("code")).toBe(false);
  });

  it("stops one address registering app after app", async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await send(
        new Request(`${ORIGIN}/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.77" },
          body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: `Flood ${String(attempt)}`, token_endpoint_auth_method: "none" }),
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
