import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";

const auth = createAuth({
  DB: env.DB,
  EMAIL: { send: async () => ({ messageId: "disabled-auth" }) },
  SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  BETTER_AUTH_SECRET: "integration-test-secret",
  BETTER_AUTH_URL: ORIGIN,
});

const OPEN = new Set([
  "/get-session",
  "/sign-in/magic-link",
  "/magic-link/verify",
  "/verify-email",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
]);

function methodOf(endpoint: object | ((...args: never[]) => unknown)): "GET" | "POST" {
  if (!("options" in endpoint) || typeof endpoint.options !== "object" || endpoint.options === null) return "POST";
  if (!("method" in endpoint.options)) return "POST";
  const raw = endpoint.options.method;
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first === "GET" ? "GET" : "POST";
}

function registeredRoutes(): { path: string; method: "GET" | "POST" }[] {
  const rows: { path: string; method: "GET" | "POST" }[] = [];
  for (const endpoint of Object.values(auth.api)) {
    if (typeof endpoint !== "function" || !("path" in endpoint)) continue;
    if (typeof endpoint.path !== "string" || endpoint.path.includes(":")) continue;
    rows.push({ path: endpoint.path, method: methodOf(endpoint) });
  }
  return rows;
}

function hit(path: string, method: "GET" | "POST"): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method,
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    }),
  );
}

describe("raw better-auth HTTP paths the UI does not call", () => {
  const routes = registeredRoutes();
  const closed = routes.filter((route) => !OPEN.has(route.path));
  const kept = routes.filter((route) => OPEN.has(route.path));

  it("registers every path the UI and email links still need", () => {
    expect(new Set(kept.map((route) => route.path))).toEqual(OPEN);
  });

  it.each(closed)("$method $path returns 404", async ({ path, method }) => {
    const response = await hit(path, method);
    expect(response.status).toBe(404);
  });

  it.each(kept)("$method $path is not 404", async ({ path, method }) => {
    const response = await hit(path, method);
    expect(response.status).not.toBe(404);
  });
});
