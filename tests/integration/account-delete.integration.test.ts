import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createAuth, deleteSignedInUser } from "../../app/lib/auth.server";
import { firstWorkspaceId } from "../../app/lib/workspace.server";

const ORIGIN = "http://localhost:8787";
const ADDRESS = "leaving@0509.io";
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
  BETTER_AUTH_URL: ORIGIN,
};

const auth = createAuth(authEnv);

async function signIn(): Promise<{ cookie: string; userId: string }> {
  await auth.api.signInMagicLink({ body: { email: ADDRESS }, headers: new Headers() });
  const link = links.at(-1);
  if (link === undefined) throw new Error("no magic link was sent");
  const response = await auth.handler(new Request(link, { redirect: "manual" }));
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");
  const user = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(ADDRESS).first<{ id: string }>();
  if (user === null) throw new Error("sign-in created no user");
  return { cookie, userId: user.id };
}

const settingsRequest = (cookie: string) =>
  new Request(`${ORIGIN}/app/settings`, { method: "POST", headers: { cookie, origin: ORIGIN } });

const count = async (sql: string, ...values: unknown[]) =>
  (await env.DB.prepare(sql).bind(...values).first<{ n: number }>())?.n ?? -1;

describe("delete my account", () => {
  beforeEach(async () => {
    links.length = 0;
    await env.DB.exec("DELETE FROM apikey");
    await env.DB.exec("DELETE FROM verification");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
  });

  it("deletes the user, their sessions, API keys, workspace and every owned row", async () => {
    const { cookie, userId } = await signIn();
    const workspaceId = firstWorkspaceId(userId);
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
       VALUES ('ent-leaving', ?, 'competitor', 'rival.example', 'Rival', 'on', '2026-09-24T00:00:00Z')`,
    )
      .bind(workspaceId)
      .run();
    await auth.api.createApiKey({ body: { name: "script" }, headers: new Headers({ cookie }) });
    expect(await count("SELECT COUNT(*) AS n FROM apikey WHERE referenceId = ?", userId)).toBe(1);

    const headers = await deleteSignedInUser(authEnv, settingsRequest(cookie), new Date());

    expect(headers).not.toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM "user" WHERE id = ?', userId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM session WHERE userId = ?", userId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM apikey WHERE referenceId = ?", userId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM workspace WHERE id = ?", workspaceId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ?", workspaceId)).toBe(0);
  });

  it("asks for a fresh sign-in when the session is older than a day, and deletes nothing", async () => {
    const { cookie, userId } = await signIn();
    const twoDaysOn = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

    expect(await deleteSignedInUser(authEnv, settingsRequest(cookie), twoDaysOn)).toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM "user" WHERE id = ?', userId)).toBe(1);
  });

  it("the Workflow empties the account's stored files and leaves everyone else's", async () => {
    await env.SNAPSHOTS.put("card/ws-leaving/share.png", "a");
    await env.SNAPSHOTS.put("snapshot/site/watch-leaving/1.txt", "b");
    await env.SNAPSHOTS.put("snapshot/site/watch-leaving/1.png", "c");
    await env.SNAPSHOTS.put("snapshot/site/watch-staying/1.txt", "d");

    const id = "account-delete-test";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await env.ACCOUNT_DELETE.create({
      id,
      params: { prefixes: ["card/ws-leaving/", "snapshot/site/watch-leaving/"] },
    });
    await introspector.waitForStatus("complete");

    expect(await introspector.getOutput()).toEqual({ deleted: 3 });
    const left = await env.SNAPSHOTS.list();
    expect(left.objects.map((object) => object.key)).toEqual(["snapshot/site/watch-staying/1.txt"]);
  });
});
