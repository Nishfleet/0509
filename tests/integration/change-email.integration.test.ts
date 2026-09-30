import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth, requestEmailChange } from "../../app/lib/auth.server";

const OLD = "before@0509.io";
const NEW = "after@0509.io";
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
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  BETTER_AUTH_SECRET: "integration-test-secret",
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
};

function firstLink(to: string): string {
  const message = sent.find((entry) => entry.to === to);
  const link = /https?:\/\/\S+/.exec(message?.text ?? "")?.[0];
  if (link === undefined) throw new Error(`no link was sent to ${to}`);
  return link;
}

async function emailOf(address: string): Promise<{ email_verified: number } | null> {
  return env.DB.prepare('SELECT "emailVerified" AS email_verified FROM "user" WHERE email = ?')
    .bind(address)
    .first<{ email_verified: number }>();
}

describe("change sign-in email", () => {
  it("mails the new address and changes nothing until its link is opened", async () => {
    const auth = createAuth(authEnv);
    await auth.api.signInMagicLink({ body: { email: OLD }, headers: new Headers() });
    const signedIn = await auth.handler(new Request(firstLink(OLD), { redirect: "manual" }));
    const cookie = signedIn.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");

    await requestEmailChange(authEnv, new Request("http://localhost/app/settings", { headers: { cookie } }), NEW);

    expect(sent.some((entry) => entry.to === NEW)).toBe(true);
    expect(sent.some((entry) => entry.to === OLD && entry.text.includes("Confirm"))).toBe(false);
    expect(await emailOf(NEW)).toBeNull();
    expect(await emailOf(OLD)).not.toBeNull();

    await auth.handler(new Request(firstLink(NEW), { redirect: "manual", headers: { cookie } }));

    expect(await emailOf(NEW)).not.toBeNull();
    expect(await emailOf(OLD)).toBeNull();
  });
});
