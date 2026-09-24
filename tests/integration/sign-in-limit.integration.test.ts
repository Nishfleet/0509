import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";

function authSending(sent: string[]) {
  return createAuth({
    DB: env.DB,
    EMAIL: {
      send: async (message: { text?: string }) => {
        sent.push(message.text ?? "");
        return { messageId: "test" };
      },
    },
    SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
    SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
    BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
    BETTER_AUTH_URL: ORIGIN,
  });
}

function requestLink(auth: ReturnType<typeof createAuth>, email: string, ip: string) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip },
      body: JSON.stringify({ email, callbackURL: "/app" }),
    }),
  );
}

describe("sign-in link limits", () => {
  it("stops the sixth link to one address within a minute, whatever the sender", async () => {
    const sent: string[] = [];
    const auth = authSending(sent);
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await requestLink(auth, "flood-target@test.dev", `198.51.100.${String(attempt)}`);
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(sent).toHaveLength(5);
  });

  it("stops one sender spraying many addresses", async () => {
    const sent: string[] = [];
    const auth = authSending(sent);
    const statuses = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await requestLink(auth, `spray-${String(attempt)}@test.dev`, "203.0.113.9");
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect(sent).toHaveLength(20);
  });

  it("keeps only a hash of the link's token", async () => {
    const sent: string[] = [];
    const auth = authSending(sent);
    const response = await requestLink(auth, "hashed@test.dev", "192.0.2.44");
    expect(response.status).toBe(200);
    const token = /token=([^&\s"]+)/.exec(sent[0] ?? "")?.[1];
    expect(token).toBeDefined();
    const stored = await env.DB.prepare('SELECT "identifier" FROM "verification" WHERE "value" LIKE ?')
      .bind("%hashed@test.dev%")
      .first<{ identifier: string }>();
    expect(stored?.identifier).toBeDefined();
    expect(stored?.identifier).not.toBe(token);
  });
});
