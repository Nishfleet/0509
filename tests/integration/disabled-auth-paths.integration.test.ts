import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";

const auth = createAuth({
  DB: env.DB,
  EMAIL: { send: async () => ({ ok: true }) },
  SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  BETTER_AUTH_SECRET: "integration-test-secret",
  BETTER_AUTH_URL: ORIGIN,
});

const DISABLED: { path: string; method: "GET" | "POST" }[] = [
  { path: "/delete-user", method: "POST" },
  { path: "/delete-user/callback", method: "GET" },
  { path: "/change-email", method: "POST" },
  { path: "/update-user", method: "POST" },
  { path: "/change-password", method: "POST" },
  { path: "/list-sessions", method: "GET" },
  { path: "/revoke-session", method: "POST" },
  { path: "/revoke-sessions", method: "POST" },
  { path: "/revoke-other-sessions", method: "POST" },
  { path: "/sign-out", method: "POST" },
  { path: "/sign-up/email", method: "POST" },
  { path: "/sign-in/email", method: "POST" },
  { path: "/sign-in/social", method: "POST" },
  { path: "/send-verification-email", method: "POST" },
  { path: "/request-password-reset", method: "POST" },
  { path: "/reset-password", method: "POST" },
  { path: "/verify-password", method: "POST" },
  { path: "/update-session", method: "POST" },
  { path: "/link-social", method: "POST" },
  { path: "/unlink-account", method: "POST" },
  { path: "/list-accounts", method: "GET" },
  { path: "/refresh-token", method: "POST" },
  { path: "/get-access-token", method: "POST" },
  { path: "/account-info", method: "GET" },
  { path: "/ok", method: "GET" },
  { path: "/error", method: "GET" },
  { path: "/passkey/delete-passkey", method: "POST" },
  { path: "/passkey/update-passkey", method: "POST" },
  { path: "/passkey/list-user-passkeys", method: "GET" },
  { path: "/api-key/create", method: "POST" },
  { path: "/api-key/delete", method: "POST" },
  { path: "/api-key/update", method: "POST" },
  { path: "/api-key/get", method: "GET" },
  { path: "/api-key/list", method: "GET" },
];

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
  it.each(DISABLED)("$method $path returns 404", async ({ path, method }) => {
    const response = await hit(path, method);
    expect(response.status).toBe(404);
  });

  it("still answers get-session over HTTP", async () => {
    const response = await hit("/get-session", "GET");
    expect(response.status).toBe(200);
  });
});
