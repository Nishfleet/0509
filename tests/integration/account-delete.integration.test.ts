import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { createAuth, deleteSignedInUser } from "../../app/lib/auth.server";
import { firstWorkspaceId } from "../../app/lib/workspace.server";
import {
  deleteAccount,
  readAccountDeleteProgress,
  sealAccountDeleteInstanceId,
} from "../../app/lib/account-delete.server";
import { loader as loginLoader } from "../../app/routes/login";

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
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
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

const loginArgs = (request: Request): Parameters<typeof loginLoader>[0] => ({
  request,
  url: new URL(request.url),
  params: {},
  pattern: "/login",
  context: new RouterContextProvider(),
});

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

  it("reports the Workflow's own progress for the deleted account", async () => {
    await env.SNAPSHOTS.put("card/ws-leaving/share.png", "a");
    await env.SNAPSHOTS.put("snapshot/site/watch-leaving/1.txt", "b");
    await env.SNAPSHOTS.put("snapshot/site/watch-leaving/1.png", "c");

    const id = "account-delete-progress";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await env.ACCOUNT_DELETE.create({
      id,
      params: { prefixes: ["card/ws-leaving/", "snapshot/site/watch-leaving/"] },
    });
    await introspector.waitForStatus("complete");

    expect(await readAccountDeleteProgress(id)).toEqual({ rows: "removed", files: "removed", deleted: 3 });
    expect(await readAccountDeleteProgress("no-such-instance")).toBeNull();
  });

  it("reports the Workflow still removing while the deletion step is retrying", async () => {
    const id = "account-delete-removing";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await introspector.modify(async (modifier) => {
      await modifier.mockStepError(
        { name: "delete card/ws-leaving/ page 0" },
        new Error("R2 is slow"),
      );
    });
    await env.ACCOUNT_DELETE.create({
      id,
      params: { prefixes: ["card/ws-leaving/"] },
    });

    await introspector.waitForStatus("running");
    expect(await readAccountDeleteProgress(id)).toEqual({ rows: "removed", files: "removing", deleted: null });
  });

  it("reports the Workflow stopped when the instance errored out", async () => {
    const id = "account-delete-failed";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await introspector.modify(async (modifier) => {
      await modifier.disableRetryDelays();
      await modifier.mockStepError(
        { name: "delete card/ws-leaving/ page 0" },
        new Error("R2 blew up"),
      );
    });
    await env.ACCOUNT_DELETE.create({
      id,
      params: { prefixes: ["card/ws-leaving/"] },
    });

    await introspector.waitForStatus("errored");
    expect(await readAccountDeleteProgress(id)).toEqual({ rows: "removed", files: "failed", deleted: null });
  });

  it("reports the Workflow stopped when the instance was terminated", async () => {
    const id = "account-delete-terminated";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await introspector.modify(async (modifier) => {
      await modifier.mockStepError(
        { name: "delete card/ws-leaving/ page 0" },
        new Error("R2 is slow"),
      );
    });
    await env.ACCOUNT_DELETE.create({
      id,
      params: { prefixes: ["card/ws-leaving/"] },
    });
    await introspector.waitForStatus("running");

    const instance = await env.ACCOUNT_DELETE.get(id);
    await instance.terminate();
    await introspector.waitForStatus("terminated");

    expect(await readAccountDeleteProgress(id)).toEqual({ rows: "removed", files: "failed", deleted: null });
  });

  it("shows the instance status only to the browser the delete ran in", async () => {
    await env.SNAPSHOTS.put("card/ws-leaving/share.png", "a");
    const id = "account-delete-sealed";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await env.ACCOUNT_DELETE.create({
      id,
      params: { prefixes: ["card/ws-leaving/"] },
    });
    await introspector.waitForStatus("complete");

    const page = `${ORIGIN}/login?deleted=${id}`;
    const anonymous = await loginLoader(loginArgs(new Request(page)));
    expect(anonymous).toMatchObject({ id: null, progress: null });

    const forged = await loginLoader(
      loginArgs(new Request(page, { headers: { cookie: `account-delete=${id}` } })),
    );
    expect(forged).toMatchObject({ id: null, progress: null });

    const other = (await sealAccountDeleteInstanceId("a-different-instance", new Request(page))).split(";")[0];
    const wrongSeal = await loginLoader(
      loginArgs(new Request(page, { headers: { cookie: other } })),
    );
    expect(wrongSeal).toMatchObject({ id: null, progress: null });

    const sealed = (await sealAccountDeleteInstanceId(id, new Request(page))).split(";")[0];
    const owned = await loginLoader(
      loginArgs(new Request(page, { headers: { cookie: sealed } })),
    );
    expect(owned.id).toBe(id);
    expect(owned.progress).toEqual({ rows: "removed", files: "removed", deleted: 1 });
  });

  it("seals the Workflow instance id on the headers the deleting browser leaves with", async () => {
    const { cookie, userId } = await signIn();
    const helpers: Pick<OAuthHelpers, "listUserGrants" | "revokeGrant"> = {
      listUserGrants: async () => ({ items: [] }),
      revokeGrant: async () => undefined,
    };

    const deleted = await deleteAccount(helpers, settingsRequest(cookie), userId);

    if (deleted === null) throw new Error("deleteAccount refused a fresh session");
    const baked = deleted.headers.getSetCookie().find((header) => header.startsWith("account-delete="));
    if (baked === undefined) throw new Error("no account-delete cookie on the delete headers");
    expect(baked).toContain("HttpOnly");
    expect(baked).toContain("Max-Age=86400");
    expect(baked).toContain("Path=/login");
    expect(baked).toContain("SameSite=Lax");

    const secure = await sealAccountDeleteInstanceId(deleted.instanceId, new Request("https://0509.io/login"));
    expect(secure).toContain("; Secure");

    const pair = baked.split(";")[0];
    if (!pair) throw new Error("the account-delete cookie carried no pair");
    const page = `${ORIGIN}/login?deleted=${deleted.instanceId}`;
    const shown = await loginLoader(loginArgs(new Request(page, { headers: { cookie: pair } })));
    expect(shown.id).toBe(deleted.instanceId);
    expect(shown.progress).toMatchObject({ rows: "removed" });
  });
});
