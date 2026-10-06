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

function createForm(name: string, submission: string): FormData {
  const form = new FormData();
  form.set("name", name);
  form.set("submission", submission);
  return form;
}

describe("create-key is idempotent per submission", () => {
  beforeAll(() => {
    Object.assign(env, { BETTER_AUTH_SECRET: SECRET });
  });

  it("two submits with one submission id mint one key, and the second reports a duplicate with no secret", async () => {
    const request = await signedInRequest();
    const submission = crypto.randomUUID();

    const first = await createAgentKey(request, createForm("double-click", submission));
    const second = await createAgentKey(request, createForm("double-click", submission));

    expect(first.newKey?.startsWith("0509_")).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ newKey: null, duplicate: true });
    expect(await keyRows("double-click")).toBe(1);
  });

  it("two simultaneous submits with one submission id mint one key", async () => {
    const request = await signedInRequest();
    const submission = crypto.randomUUID();

    const settled = await Promise.all([
      createAgentKey(request, createForm("racing", submission)),
      createAgentKey(request, createForm("racing", submission)),
    ]);

    expect(settled.filter((result) => result.newKey !== null)).toHaveLength(1);
    expect(settled.filter((result) => result.duplicate)).toHaveLength(1);
    expect(await keyRows("racing")).toBe(1);
  });

  it("a new submission id after the page reloads mints a second key", async () => {
    const request = await signedInRequest();

    await createAgentKey(request, createForm("again", crypto.randomUUID()));
    const second = await createAgentKey(request, createForm("again", crypto.randomUUID()));

    expect(second.newKey?.startsWith("0509_")).toBe(true);
    expect(await keyRows("again")).toBe(2);
  });

  it("a form with no submission id still mints a key, named My agent by default", async () => {
    const request = await signedInRequest();

    const result = await createAgentKey(request, new FormData());

    expect(result.newKey?.startsWith("0509_")).toBe(true);
    expect(await keyRows("My agent")).toBeGreaterThan(0);
  });

  it("refuses the create, minting nothing, when the plan does not include API access", async () => {
    const request = await signedInRequest();
    const owner = await env.DB.prepare(
      'SELECT w.id AS id FROM workspace w JOIN "user" u ON u.id = w.owner_user_id WHERE u.email = ?',
    )
      .bind(ADDRESS)
      .first<{ id: string }>();
    if (owner === null) throw new Error("sign-in created no workspace");
    await env.DB.prepare(
      "INSERT INTO plan (id, workspace_id, tier, status, limits_json, updated_at) VALUES (?1, ?2, 'scout', 'active', ?3, ?4)",
    )
      .bind("plan_create_key_no_api", owner.id, JSON.stringify({ api_access: false }), "2026-10-06T00:00:00.000Z")
      .run();
    try {
      const result = await createAgentKey(request, createForm("refused", crypto.randomUUID()));

      expect(result).toEqual({ newKey: null, duplicate: false });
      expect(await keyRows("refused")).toBe(0);
    } finally {
      await env.DB.prepare("DELETE FROM plan WHERE id = ?").bind("plan_create_key_no_api").run();
    }
  });

  it("refuses a signed-out create with an error and mints no key", async () => {
    const signedOut = new Request(`${ORIGIN}/app/settings/agents`, { method: "POST", headers: { origin: ORIGIN } });

    const failure = await createAgentKey(signedOut, createForm("nobody", crypto.randomUUID())).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(await keyRows("nobody")).toBe(0);
  });
});
