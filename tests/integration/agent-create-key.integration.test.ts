import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createAgentKey } from "../../app/lib/agent/access.server";
import { createAuth } from "../../app/lib/auth.server";

const ORIGIN = "http://localhost:8787";
const ADDRESS = "key-maker@0509.io";
const SECRET = "integration-test-secret";
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
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
};

const auth = createAuth(authEnv);

async function signedInRequest(): Promise<Request> {
  await auth.api.signInMagicLink({ body: { email: ADDRESS }, headers: new Headers() });
  const link = links.at(-1);
  if (link === undefined) throw new Error("no magic link was sent");
  const response = await auth.handler(new Request(link, { redirect: "manual" }));
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");
  return new Request(`${ORIGIN}/app/settings/agents`, { method: "POST", headers: { cookie, origin: ORIGIN } });
}

const keyRows = async (name: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM apikey WHERE name = ?").bind(name).first<{ n: number }>())?.n ?? -1;

describe("create-key is idempotent per submission", () => {
  beforeAll(() => {
    Object.assign(env, { BETTER_AUTH_SECRET: SECRET });
  });

  it("two submits with one submission id mint one key, and the second shows no secret", async () => {
    const request = await signedInRequest();
    const submission = crypto.randomUUID();

    const first = await createAgentKey(request, "double-click", submission);
    const second = await createAgentKey(request, "double-click", submission);

    expect(first?.startsWith("0509_")).toBe(true);
    expect(second).toBeNull();
    expect(await keyRows("double-click")).toBe(1);
  });

  it("two simultaneous submits with one submission id mint one key", async () => {
    const request = await signedInRequest();
    const submission = crypto.randomUUID();

    const settled = await Promise.all([
      createAgentKey(request, "racing", submission),
      createAgentKey(request, "racing", submission),
    ]);

    expect(settled.filter((key) => key !== null)).toHaveLength(1);
    expect(await keyRows("racing")).toBe(1);
  });

  it("a new submission id after the page reloads mints a second key", async () => {
    const request = await signedInRequest();

    await createAgentKey(request, "again", crypto.randomUUID());
    const second = await createAgentKey(request, "again", crypto.randomUUID());

    expect(second?.startsWith("0509_")).toBe(true);
    expect(await keyRows("again")).toBe(2);
  });
});
