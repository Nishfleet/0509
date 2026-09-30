import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuth, requestEmailChange } from "../../app/lib/auth.server";

const sent: { to: string; text: string }[] = [];

const authEnv = {
  DB: env.DB,
  EMAIL: {
    send: async (message: { to: string; text?: string }) => {
      sent.push({ to: message.to, text: message.text ?? "" });
      return { ok: true };
    },
  } as unknown as SendEmail,
  SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
  CHANGE_EMAIL_LIMIT: env.CHANGE_EMAIL_LIMIT,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  BETTER_AUTH_SECRET: "integration-test-secret",
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
};

const auth = createAuth(authEnv);

function linkTo(address: string): string {
  const message = sent.findLast((entry) => entry.to === address);
  const link = /https?:\/\/\S+/.exec(message?.text ?? "")?.[0];
  if (link === undefined) throw new Error(`no link was sent to ${address}`);
  return link;
}

function mailCount(address: string): number {
  return sent.filter((entry) => entry.to === address).length;
}

async function signIn(address: string): Promise<{ cookie: string; userId: string }> {
  await auth.api.signInMagicLink({ body: { email: address }, headers: new Headers() });
  const response = await auth.handler(new Request(linkTo(address), { redirect: "manual" }));
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");
  const user = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(address).first<{ id: string }>();
  if (user === null) throw new Error("sign-in created no user");
  return { cookie, userId: user.id };
}

function asRequest(cookie: string): Request {
  return new Request("http://localhost/app/settings", { headers: { cookie } });
}

async function exists(address: string): Promise<boolean> {
  return (await env.DB.prepare('SELECT 1 AS present FROM "user" WHERE email = ?').bind(address).first()) !== null;
}

function open(link: string, cookie: string) {
  return auth.handler(new Request(link, { redirect: "manual", headers: { cookie } }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("change sign-in email", () => {
  it("asks the old address first, then the new one, and changes nothing before the last link", async () => {
    const old = "old-a@0509.io";
    const next = "new-a@0509.io";
    const { cookie } = await signIn(old);

    expect(await requestEmailChange(authEnv, asRequest(cookie), next)).toBe("sent");
    expect(mailCount(next)).toBe(0);
    expect(linkTo(old)).toContain("verify-email");
    expect(await exists(old)).toBe(true);

    await open(linkTo(old), cookie);
    expect(mailCount(next)).toBe(1);
    expect(await exists(next)).toBe(false);

    await open(linkTo(next), cookie);
    expect(await exists(next)).toBe(true);
    expect(await exists(old)).toBe(false);
  });

  it("answers a taken address exactly like a free one and mails no one", async () => {
    const old = "old-b@0509.io";
    const taken = "taken-b@0509.io";
    await signIn(taken);
    const { cookie } = await signIn(old);
    const before = sent.length;

    expect(await requestEmailChange(authEnv, asRequest(cookie), taken)).toBe("sent");

    expect(sent.length).toBe(before);
    expect(await exists(old)).toBe(true);
    expect(await exists(taken)).toBe(true);
  });

  it("refuses a session older than a day", async () => {
    const { cookie, userId } = await signIn("old-c@0509.io");
    await env.DB.prepare('UPDATE session SET "createdAt" = ? WHERE "userId" = ?')
      .bind(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), userId)
      .run();
    const before = sent.length;

    await expect(requestEmailChange(authEnv, asRequest(cookie), "new-c@0509.io")).rejects.toBeDefined();
    expect(sent.length).toBe(before);
  });

  it("stops honouring the approval link after an hour", async () => {
    const old = "old-d@0509.io";
    const { cookie } = await signIn(old);
    await requestEmailChange(authEnv, asRequest(cookie), "new-d@0509.io");
    const link = linkTo(old);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    await open(link, cookie);

    expect(mailCount("new-d@0509.io")).toBe(0);
    expect(await exists("new-d@0509.io")).toBe(false);
  });

  it("still needs the new address's link when the old one was never verified", async () => {
    const old = "old-e@0509.io";
    const { cookie, userId } = await signIn(old);
    await env.DB.prepare('UPDATE "user" SET "emailVerified" = 0 WHERE id = ?').bind(userId).run();

    await requestEmailChange(authEnv, asRequest(cookie), "new-e@0509.io");

    expect(mailCount("new-e@0509.io")).toBe(1);
    expect(await exists("new-e@0509.io")).toBe(false);
    expect(await exists(old)).toBe(true);
  });

  it("limits requests per user", async () => {
    const { cookie } = await signIn("old-f@0509.io");
    const outcomes: string[] = [];
    for (const n of [1, 2, 3, 4]) {
      outcomes.push(await requestEmailChange(authEnv, asRequest(cookie), `new-f${String(n)}@0509.io`));
    }
    expect(outcomes.at(-1)).toBe("limited");
  });

  it("does not expose better-auth's own send-verification endpoint", async () => {
    const before = sent.length;
    const response = await auth.handler(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/send-verification-email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: env.BETTER_AUTH_URL },
        body: JSON.stringify({ email: "anyone@0509.io" }),
      }),
    );
    expect(response.status).toBe(404);
    expect(sent.length).toBe(before);
  });
});
