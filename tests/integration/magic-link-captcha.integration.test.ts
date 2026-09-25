import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleAuthRequest } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";

function authEnv(sent: string[], secret = "1x0000000000000000000000000000000AA") {
  return {
    DB: env.DB,
    EMAIL: {
      send: async (message: { text?: string }) => {
        sent.push(message.text ?? "");
        return { messageId: "test" };
      },
    },
    SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
    SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
    TURNSTILE_SECRET_KEY: secret,
    BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
    BETTER_AUTH_URL: ORIGIN,
  };
}

function magicLinkPost(token?: string): Request {
  const headers = new Headers({ "content-type": "application/json", origin: ORIGIN });
  if (token !== undefined) headers.set("x-captcha-response", token);
  return new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "captcha@test.dev", callbackURL: "/app" }),
  });
}

describe("magic-link captcha", () => {
  it("refuses a post with no turnstile token", async () => {
    const response = await handleAuthRequest(authEnv([]), magicLinkPost(), async () => false);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Missing CAPTCHA response");
  });

  it("sends the link when an access service token clears an empty widget", async () => {
    const sent: string[] = [];
    const response = await handleAuthRequest(authEnv(sent), magicLinkPost(), async () => true);
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("checks a presented token even when access would clear", async () => {
    const sent: string[] = [];
    const response = await handleAuthRequest(
      authEnv(sent, "2x0000000000000000000000000000000AA"),
      magicLinkPost("not-a-turnstile-token"),
      async () => true,
    );
    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});
