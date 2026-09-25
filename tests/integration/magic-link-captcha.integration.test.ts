import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";
const PASSING_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

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
    const response = await createAuth(authEnv([])).handler(magicLinkPost());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Missing CAPTCHA response");
  });

  it("sends the link when the published test token passes", async () => {
    const sent: string[] = [];
    const response = await createAuth(authEnv(sent)).handler(magicLinkPost(PASSING_TOKEN));
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("refuses a token the secret rejects", async () => {
    const sent: string[] = [];
    const response = await createAuth(authEnv(sent, "2x0000000000000000000000000000000AA")).handler(
      magicLinkPost(PASSING_TOKEN),
    );
    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});
