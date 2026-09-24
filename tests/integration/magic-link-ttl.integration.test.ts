import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";
import { MAGIC_LINK_TTL_SECONDS } from "../../app/lib/auth/magic-link-email";

// The email promises an expiry; better-auth enforces one. They are the same
// number only if createAuth passes MAGIC_LINK_TTL_SECONDS as the plugin's
// expiresIn, so this reads the expiry better-auth actually stored.
const ORIGIN = "http://localhost:8787";
const EMAIL = "ttl@test.dev";

describe("magic link expiry", () => {
  it("stores the expiry the email tells the reader", async () => {
    const sent: string[] = [];
    const auth = createAuth({
      DB: env.DB,
      EMAIL: {
        send: async (message: { text?: string }) => {
          sent.push(message.text ?? "");
          return { messageId: "test" };
        },
      },
      BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
      BETTER_AUTH_URL: ORIGIN,
    });

    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: EMAIL, callbackURL: "/app" }),
      }),
    );
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT "expiresAt", "createdAt" FROM "verification" WHERE "value" LIKE ? ORDER BY "createdAt" DESC LIMIT 1',
    )
      .bind(`%${EMAIL}%`)
      .first<{ expiresAt: string; createdAt: string }>();
    expect(row).not.toBeNull();
    const seconds = (Date.parse(row?.expiresAt ?? "") - Date.parse(row?.createdAt ?? "")) / 1000;
    expect(Math.abs(seconds - MAGIC_LINK_TTL_SECONDS)).toBeLessThan(5);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`expires in ${String(MAGIC_LINK_TTL_SECONDS / 60)} minutes`);
  });
});
