import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

const MCP_INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
};

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

test("/mcp refuses an unsigned request with a challenge that points at its sign-in metadata", async ({ request }) => {
  const response = await request.post("/mcp", { data: MCP_INIT, headers: MCP_HEADERS });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toMatch(
    /^Bearer .*resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/,
  );
});

test("/mcp refuses a made-up bearer token", async ({ request }) => {
  const response = await request.post("/mcp", {
    data: MCP_INIT,
    headers: { ...MCP_HEADERS, authorization: "Bearer 0509_not-a-real-key" },
  });
  expect(response.status()).toBe(401);
});

test("the MCP server publishes its protected-resource and authorization-server metadata", async ({ request }) => {
  const resource = await request.get("/.well-known/oauth-protected-resource/mcp");
  expect(resource.status()).toBe(200);
  const resourceBody: { resource: string; authorization_servers: string[]; scopes_supported: string[] } =
    await resource.json();
  const origin = resourceBody.authorization_servers[0] ?? "";
  expect(origin).toMatch(/^https?:\/\/[^/]+$/);
  expect(resourceBody.resource).toBe(`${origin}/mcp`);
  expect(resourceBody.scopes_supported).toEqual(["read"]);

  const server = await request.get("/.well-known/oauth-authorization-server");
  expect(server.status()).toBe(200);
  const serverBody: {
    authorization_endpoint: string;
    token_endpoint: string;
    code_challenge_methods_supported: string[];
    client_id_metadata_document_supported?: boolean;
  } = await server.json();
  expect(serverBody.authorization_endpoint).toBe(`${origin}/oauth/authorize`);
  expect(serverBody.token_endpoint).toBe(`${origin}/oauth/token`);
  expect(serverBody.code_challenge_methods_supported).toEqual(["S256"]);
  expect(serverBody.client_id_metadata_document_supported).toBe(true);
});

test("the consent screen sends a signed-out visitor to sign in and back", async ({ request }) => {
  const response = await request.get("/oauth/authorize?client_id=https%3A%2F%2Fexample.com%2Fclient.json", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  const location = new URL(response.headers().location ?? "", "http://x");
  expect(location.pathname).toBe("/login");
  expect(location.searchParams.get("next")).toMatch(/^\/oauth\/authorize\?/);
});

test("the REST API refuses a request without a key and never caches the answer", async ({ request }) => {
  for (const path of ["/api/v1/brief", "/api/v1/competitors", "/api/v1/alerts", "/api/v1/standing"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    expect(response.headers()["cache-control"], path).toBe("no-store");
    expect(response.headers()["www-authenticate"], path).toMatch(/^Bearer /);
  }
});

test("the API reference is public OpenAPI 3.1", async ({ request }) => {
  const response = await request.get("/api/v1/openapi.json");
  expect(response.status()).toBe(200);
  const body: { openapi: string; paths: Record<string, unknown> } = await response.json();
  expect(body.openapi).toBe("3.1.0");
  expect(Object.keys(body.paths).sort()).toEqual([
    "/api/v1/alerts",
    "/api/v1/brief",
    "/api/v1/competitors",
    "/api/v1/standing",
  ]);
});

test.describe("a signed-in customer's key", () => {
  test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "needs the production mail path to sign in");

  test("reads only its owner's workspace over MCP and REST, and stops working once deleted", async ({ page }) => {
    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
    await signInWithMagicLink(page, email, requireInboxToken());

    await page.goto("/app/settings/agents");
    await page.getByLabel("Name").fill("e2e agent");
    await page.getByRole("button", { name: "Make a key" }).click();
    const key = (await page.getByTestId("new-api-key").textContent()) ?? "";
    expect(key).toMatch(/^0509_/);

    const auth = { authorization: `Bearer ${key}` };
    const listed = await page.request.post("/mcp", { data: MCP_INIT, headers: { ...MCP_HEADERS, ...auth } });
    expect(listed.status()).toBe(200);
    expect(await listed.text()).toContain("get_brief");

    const competitors = await page.request.get("/api/v1/competitors", { headers: auth });
    expect(competitors.status()).toBe(200);
    expect(await competitors.json()).toEqual({ tracked: [], suggested: [] });

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("api-key")).toHaveCount(0);
    expect((await page.request.get("/api/v1/competitors", { headers: auth })).status()).toBe(401);
  });
});
