import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuth } from "../../app/lib/auth.server";
import { FIXTURE_MAGIC_LINKS_PER_DAY, FIXTURE_SIGNUPS_PER_DAY } from "../../app/lib/auth/fixture-signup-cap.server";

const ORIGIN = "http://localhost:8787";

const sent: string[] = [];

const authEnv = {
  DB: env.DB,
  EMAIL: {
    send: async (message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> => {
      sent.push("to" in message ? String(message.to) : "");
      return { messageId: "test" };
    },
  },
  SIGN_IN_EMAIL_LIMIT: { limit: async () => ({ success: true }) },
  SIGN_IN_IP_LIMIT: { limit: async () => ({ success: true }) },
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
  BETTER_AUTH_URL: ORIGIN,
} satisfies Parameters<typeof createAuth>[0];

let day = 0;

async function signUp(email: string) {
  const context = await createAuth(authEnv).$context;
  return context.internalAdapter.createUser({ email, name: email, emailVerified: true }, { method: "magic-link" });
}

async function requestLink(email: string): Promise<Response> {
  const request = new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, callbackURL: "/app" }),
  });
  return createAuth(authEnv, { captcha: false }).handler(request);
}

async function userExists(email: string): Promise<boolean> {
  return (await env.DB.prepare(`SELECT id FROM "user" WHERE email = ?1`).bind(email).first()) !== null;
}

async function signUpAndDelete(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const email = `e2e+cap${String(index)}@0509.io`;
    await signUp(email);
    await env.DB.prepare(`DELETE FROM "user" WHERE email = ?1`).bind(email).run();
  }
}

beforeEach(() => {
  day += 3;
  sent.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2031, 0, day, 12)));
});

afterEach(async () => {
  vi.useRealTimers();
  await env.DB.prepare(`DELETE FROM "user" WHERE email LIKE 'e2e+%' OR email = 'person@example.com'`).run();
});

describe("per-run fixture sign-up cap", () => {
  it("refuses the next fixture user once the cap is reached, even though every earlier user was deleted", async () => {
    await signUpAndDelete(FIXTURE_SIGNUPS_PER_DAY);

    await expect(signUp("e2e+extra@0509.io")).rejects.toMatchObject({ statusCode: 429 });
    expect(await userExists("e2e+extra@0509.io")).toBe(false);
  });

  it("admits the last user under the cap", async () => {
    await signUpAndDelete(FIXTURE_SIGNUPS_PER_DAY - 1);

    await signUp("e2e+extra@0509.io");
    expect(await userExists("e2e+extra@0509.io")).toBe(true);
  });

  it("starts a fresh count on the next UTC day", async () => {
    await signUpAndDelete(FIXTURE_SIGNUPS_PER_DAY);
    vi.setSystemTime(new Date(Date.UTC(2031, 0, day, 12) + 24 * 3_600_000));

    await signUp("e2e+extra@0509.io");
    expect(await userExists("e2e+extra@0509.io")).toBe(true);
  });

  it("still signs a normal email up at the cap and never charges it", async () => {
    await signUpAndDelete(FIXTURE_SIGNUPS_PER_DAY);

    await signUp("person@example.com");
    expect(await userExists("person@example.com")).toBe(true);
  });

  it("never refuses or charges a kept account", async () => {
    await signUpAndDelete(FIXTURE_SIGNUPS_PER_DAY - 1);
    await signUp("e2e+j7@0509.io");

    await signUp("e2e+extra@0509.io");
    expect(await userExists("e2e+extra@0509.io")).toBe(true);
  });
});

describe("per-run fixture magic-link cap", () => {
  async function requestLinks(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      expect((await requestLink(`e2e+link${String(index)}@0509.io`)).status).toBe(200);
    }
  }

  it("refuses the next fixture link before any email goes out", async () => {
    await requestLinks(FIXTURE_MAGIC_LINKS_PER_DAY);
    expect(sent).toHaveLength(FIXTURE_MAGIC_LINKS_PER_DAY);

    const refused = await requestLink("e2e+extra@0509.io");

    expect(refused.status).toBe(429);
    expect(sent).toHaveLength(FIXTURE_MAGIC_LINKS_PER_DAY);
  });

  it("still sends to a normal email and a kept account at the cap", async () => {
    await requestLinks(FIXTURE_MAGIC_LINKS_PER_DAY);

    expect((await requestLink("person@example.com")).status).toBe(200);
    expect((await requestLink("e2e+j7@0509.io")).status).toBe(200);
    expect(sent).toHaveLength(FIXTURE_MAGIC_LINKS_PER_DAY + 2);
  });
});
