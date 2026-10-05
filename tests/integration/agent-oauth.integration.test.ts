import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { createExecutionContext, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { decideConsent, readConsent } from "../../app/lib/agent/consent.server";
import { createOAuthProvider } from "../../app/lib/agent/oauth.server";

const ORIGIN = "http://localhost";
const REDIRECT = "https://app.example/callback";
const VERIFIER = "a-long-enough-pkce-code-verifier-for-this-test-0123456789";
const REGISTER_OVERSIZE = 1_048_576;

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
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
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
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind("u_oauth", "OAuth Owner", "oauth@test.dev", now),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES ('ws_oauth', 'oauth', 'u_oauth', 'UTC', ?1)",
    ).bind(now),
  ]);
});

describe("an AI app signing in to 0509", () => {
  it("leads with the address and marks the app's own name as unchecked", async () => {
    expect(await readConsent(helpers, new Request(authorizeUrl))).toEqual({
      kind: "ask",
      host: "app.example",
      claimedName: "Test App",
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

  it("refuses cleanly when the app's details fail to load between the page and Allow", async () => {
    const failing: OAuthHelpers = {
      ...helpers,
      parseAuthRequest: (request) => helpers.parseAuthRequest(request),
      lookupClient: () => Promise.reject(new CimdFetchError("https://cimd.example/gone.json", new Error("HTTP 503"))),
    };
    const message = "This app's details could not be loaded. Go back and try connecting again.";
    expect(await readConsent(failing, new Request(authorizeUrl))).toEqual({ kind: "error", message });
    expect(
      await decideConsent(failing, new Request(authorizeUrl, { method: "POST" }), { userId: "u_oauth", allow: true }),
    ).toEqual({ kind: "error", message });
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

    const mcp = await send(
      new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } }),
    );
    expect(mcp.status).toBe(200);
    expect(await mcp.json()).toEqual({ userId: "u_oauth", clientId });

    const grants = await helpers.listUserGrants("u_oauth");
    expect(grants.items.map((grant) => grant.metadata)).toEqual([{ appName: "Test App", host: "app.example" }]);
    await helpers.revokeGrant(grants.items[0]?.id ?? "", "u_oauth");
    const revoked = await send(
      new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } }),
    );
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
          body: JSON.stringify({
            redirect_uris: [REDIRECT],
            client_name: `Flood ${String(attempt)}`,
            token_endpoint_auth_method: "none",
          }),
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("registers through DCR, then issues a token that /mcp accepts", async () => {
    const registered = await send(
      new Request(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.80" },
        body: JSON.stringify({
          redirect_uris: [REDIRECT],
          client_name: "DCR App",
          token_endpoint_auth_method: "none",
        }),
      }),
    );
    expect(registered.status).toBe(201);
    const body: { client_id: string } = await registered.json();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: body.client_id,
      redirect_uri: REDIRECT,
      state: "dcr",
      code_challenge: await challenge(),
      code_challenge_method: "S256",
      resource: `${ORIGIN}/mcp`,
    });
    const allowed = await decideConsent(
      helpers,
      new Request(`${ORIGIN}/oauth/authorize?${query.toString()}`, { method: "POST" }),
      { userId: "u_oauth", allow: true },
    );
    const code = new URL((allowed as Response).headers.get("location") ?? "").searchParams.get("code") ?? "";
    const token = await send(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT,
          client_id: body.client_id,
          code_verifier: VERIFIER,
          resource: `${ORIGIN}/mcp`,
        }),
      }),
    );
    expect(token.status).toBe(200);
    const tokens: { access_token: string } = await token.json();
    const mcp = await send(
      new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } }),
    );
    expect(mcp.status).toBe(200);
    expect(await mcp.json()).toEqual({ userId: "u_oauth", clientId: body.client_id });
  });

  it("refuses remote http and custom-scheme redirect URIs at registration", async () => {
    for (const [ip, uri] of [
      ["198.51.100.81", "http://evil.example/callback"],
      ["198.51.100.82", "cursor://callback"],
    ] as const) {
      const response = await send(
        new Request(`${ORIGIN}/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": ip },
          body: JSON.stringify({
            redirect_uris: [uri],
            client_name: "Bad redirect",
            token_endpoint_auth_method: "none",
          }),
        }),
      );
      expect(response.status, uri).toBe(400);
    }
  });

  it("refuses a registration body over 1 MiB before the provider stores a client", async () => {
    const response = await send(
      new Request(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.83" },
        body: JSON.stringify({
          redirect_uris: [REDIRECT],
          client_name: "x".repeat(REGISTER_OVERSIZE),
          token_endpoint_auth_method: "none",
        }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("treats GET /MCP as /mcp so a missing token is 401", async () => {
    const response = await send(new Request(`${ORIGIN}/MCP`));
    expect(response.status).toBe(401);
  });

  it("refuses a foreign-origin MCP preflight and allows the product origin", async () => {
    const foreign = await send(
      new Request(`${ORIGIN}/mcp`, {
        method: "OPTIONS",
        headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
      }),
    );
    expect(foreign.status).toBe(403);
    const own = await send(
      new Request(`${ORIGIN}/mcp`, {
        method: "OPTIONS",
        headers: { origin: new URL(env.BETTER_AUTH_URL).origin, "access-control-request-method": "POST" },
      }),
    );
    expect(own.status).toBe(204);
    expect(own.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(own.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
    const noOrigin = await send(new Request(`${ORIGIN}/mcp`, { method: "OPTIONS" }));
    expect(noOrigin.status).toBe(204);
  });

  it("shows a clean refusal when CIMD metadata cannot be fetched", async () => {
    const metadataUrl = "https://cimd.example/missing.json";
    const previous = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === metadataUrl) return new Response("gone", { status: 404 });
      return previous(input, init);
    };
    try {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: metadataUrl,
        redirect_uri: REDIRECT,
        state: "s1",
        code_challenge: await challenge(),
        code_challenge_method: "S256",
        resource: `${ORIGIN}/mcp`,
      });
      expect(await readConsent(helpers, new Request(`${ORIGIN}/oauth/authorize?${query.toString()}`))).toEqual({
        kind: "error",
        message: "This app's details could not be loaded. Go back and try connecting again.",
      });
    } finally {
      globalThis.fetch = previous;
    }
  });

  it("signs in a CIMD client whose metadata document fetches", async () => {
    const metadataUrl = "https://cimd.example/oauth-client.json";
    const document = {
      client_id: metadataUrl,
      client_name: "CIMD App",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    };
    const previous = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === metadataUrl) return Response.json(document);
      return previous(input, init);
    };
    try {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: metadataUrl,
        redirect_uri: REDIRECT,
        state: "cimd",
        code_challenge: await challenge(),
        code_challenge_method: "S256",
        resource: `${ORIGIN}/mcp`,
      });
      expect(await readConsent(helpers, new Request(`${ORIGIN}/oauth/authorize?${query.toString()}`))).toEqual({
        kind: "ask",
        host: "app.example",
        claimedName: "CIMD App",
      });
      const allowed = await decideConsent(
        helpers,
        new Request(`${ORIGIN}/oauth/authorize?${query.toString()}`, { method: "POST" }),
        { userId: "u_oauth", allow: true },
      );
      const code = new URL((allowed as Response).headers.get("location") ?? "").searchParams.get("code") ?? "";
      const token = await send(
        new Request(`${ORIGIN}/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT,
            client_id: metadataUrl,
            code_verifier: VERIFIER,
            resource: `${ORIGIN}/mcp`,
          }),
        }),
      );
      expect(token.status).toBe(200);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
