import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";

const ADDRESS = "cache@0509.io";
const links: string[] = [];

const authEnv = {
  DB: env.DB,
  EMAIL: {
    send: async (message: { text?: string }) => {
      const link = /https?:\/\/\S+/.exec(message.text ?? "")?.[0];
      if (link) links.push(link);
      return { ok: true };
    },
  } as unknown as SendEmail,
  SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  BETTER_AUTH_SECRET: "integration-test-secret",
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
};

const auth = createAuth(authEnv);

async function signIn(): Promise<Headers> {
  await auth.api.signInMagicLink({ body: { email: ADDRESS }, headers: new Headers() });
  const link = links.at(-1);
  if (link === undefined) throw new Error("no magic link was sent");
  const response = await auth.handler(new Request(link, { redirect: "manual" }));
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

describe("the five-minute session cookie cache", () => {
  beforeEach(async () => {
    links.length = 0;
    await env.DB.exec("DELETE FROM apikey");
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM verification");
    await env.DB.exec('DELETE FROM "user"');
  });

  it("still answers a revoked session from the cookie, and a fresh read refuses it", async () => {
    const headers = await signIn();
    await env.DB.exec("DELETE FROM session");

    expect(await auth.api.getSession({ headers })).not.toBeNull();
    expect(await auth.api.getSession({ headers, query: { disableCookieCache: true } })).toBeNull();
  });

  it("does not mint an API key for a revoked session when the cache is bypassed", async () => {
    const headers = await signIn();
    await env.DB.exec("DELETE FROM session");

    await expect(
      auth.api.createApiKey({ body: { name: "revoked" }, headers, query: { disableCookieCache: true } }),
    ).rejects.toThrow();
    const keys = await env.DB.prepare("SELECT COUNT(*) AS n FROM apikey").first<{ n: number }>();
    expect(keys?.n).toBe(0);
  });
});
