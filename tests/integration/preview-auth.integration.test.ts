import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

/**
 * A Worker Preview has no single origin (#4262), so wrangler.jsonc gives it
 * BETTER_AUTH_ALLOWED_HOSTS instead of BETTER_AUTH_URL. This drives the real
 * Better Auth against real D1: the emailed link must point back at the host
 * the sign-in came from, and a host outside the pattern must get no link.
 */
const PREVIEW_HOSTS = "*-0509-preview.nishant345.workers.dev";

function previewAuth(sent: string[]) {
  return createAuth({
    DB: env.DB,
    EMAIL: {
      send: async (message: { text?: string }) => {
        sent.push(message.text ?? "");
        return { messageId: "test" };
      },
    },
    BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
    BETTER_AUTH_ALLOWED_HOSTS: PREVIEW_HOSTS,
    PASSKEY_RP_ID: "nishant345.workers.dev",
  });
}

function requestLink(origin: string, email: string) {
  return new Request(`${origin}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, callbackURL: "/app" }),
  });
}

describe("auth on a Worker Preview", () => {
  it("emails a link on the preview host the sign-in came from", async () => {
    const sent: string[] = [];
    const origin = "https://1a2b3c4d-0509-preview.nishant345.workers.dev";
    const response = await previewAuth(sent).handler(requestLink(origin, "preview-host@test.dev"));
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`${origin}/api/auth/magic-link/verify?`);
  });

  it("refuses a host outside the preview pattern and sends nothing", async () => {
    const sent: string[] = [];
    const origin = "https://attacker.example";
    await expect(previewAuth(sent).handler(requestLink(origin, "other-host@test.dev"))).rejects.toThrow(
      /not in the allowed hosts list/,
    );
    expect(sent).toHaveLength(0);
  });
});
