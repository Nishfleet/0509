import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuth, deleteSignedInUser } from "../../app/lib/auth.server";
import { firstWorkspaceId } from "../../app/lib/workspace.server";
import {
  deleteAccount,
  deleteStoredPage,
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

const loginPage = async (request: Request) => {
  const result = await loginLoader(loginArgs(request));
  return { body: result.data, setCookie: new Headers(result.init?.headers).get("set-cookie") };
};

const count = async (sql: string, ...values: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...values)
      .first<{ n: number }>()
  )?.n ?? -1;

describe("delete my account", () => {
  beforeEach(async () => {
    links.length = 0;
    await env.DB.exec("DELETE FROM email_suppression");
    await env.DB.exec("DELETE FROM apikey");
    await env.DB.exec("DELETE FROM verification");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
  });

  it("suppresses and cancels first, then deletes the user, sessions, API keys, workspace and every owned row", async () => {
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
    await env.DB.exec("DROP TABLE IF EXISTS delete_probe");
    await env.DB.exec("CREATE TABLE delete_probe (suppressed INTEGER, digest_status TEXT)");
    await env.DB.exec(
      "CREATE TRIGGER delete_probe_trigger BEFORE DELETE ON workspace BEGIN INSERT INTO delete_probe SELECT (SELECT COUNT(*) FROM email_suppression WHERE address = 'to@0509.io'), (SELECT status FROM digest WHERE id = 'dig-leaving'); END",
    );
    await env.DB.exec("INSERT OR IGNORE INTO channel (id, key) VALUES ('chan-leaving', 'email-leaving')");
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES ('tgt-leaving', ?, 'chan-leaving', 'to@0509.io', 1, '2026-09-24T00:00:00Z')`,
    )
      .bind(workspaceId)
      .run();
    await env.DB.prepare(
      `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json)
       VALUES ('dig-leaving', ?, 'weekly', '2026-09-15', '2026-09-22', 'pending', 'brief', '{}')`,
    )
      .bind(workspaceId)
      .run();

    const twoDaysOn = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(await deleteSignedInUser(authEnv, settingsRequest(cookie), twoDaysOn)).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM email_suppression")).toBe(0);
    expect(await env.DB.prepare("SELECT status FROM digest WHERE id = 'dig-leaving'").first()).toEqual({
      status: "pending",
    });

    const headers = await deleteSignedInUser(authEnv, settingsRequest(cookie), new Date());

    expect(headers).not.toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM "user" WHERE id = ?', userId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM session WHERE userId = ?", userId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM apikey WHERE referenceId = ?", userId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM workspace WHERE id = ?", workspaceId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ?", workspaceId)).toBe(0);
  });

  it("pages the stored files with a cursor and the Workflow deletes every page", async () => {
    const keys = Array.from(
      { length: 1005 },
      (_, index) => `snapshot/site/watch-big/${String(index).padStart(5, "0")}`,
    );
    await Promise.all(keys.map((key) => env.SNAPSHOTS.put(key, "x")));

    const first = await deleteStoredPage("snapshot/site/watch-big/", null);
    expect(first.deleted).toBe(1000);
    expect(first.cursor).not.toBeNull();
    const second = await deleteStoredPage("snapshot/site/watch-big/", first.cursor);
    expect(second).toEqual({ deleted: 5, cursor: null });
    expect((await env.SNAPSHOTS.list({ prefix: "snapshot/site/watch-big/" })).objects).toHaveLength(0);

    await Promise.all(keys.map((key) => env.SNAPSHOTS.put(key, "x")));
    const id = "account-delete-pages";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await env.ACCOUNT_DELETE.create({ id, params: { prefixes: ["snapshot/site/watch-big/"] } });
    await introspector.waitForStatus("complete");

    expect(await introspector.getOutput()).toEqual({ deleted: 1005 });
    expect((await env.SNAPSHOTS.list({ prefix: "snapshot/site/watch-big/" })).objects).toHaveLength(0);
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
    await env.SNAPSHOTS.put("snapshot/hiring/watch-leaving/1.json", "e");
    await env.SNAPSHOTS.put("snapshot/hiring/watch-staying/1.json", "f");
    await env.SNAPSHOTS_BACKUP.put("card/ws-leaving/share.png", "a");
    await env.SNAPSHOTS_BACKUP.put("snapshot/site/watch-leaving/1.png", "c");
    await env.SNAPSHOTS_BACKUP.put("snapshot/site/watch-staying/1.txt", "d");
    await env.SNAPSHOTS_BACKUP.put("snapshot/hiring/watch-staying/1.json", "f");

    const id = "account-delete-test";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await env.ACCOUNT_DELETE.create({
      id,
      params: { prefixes: ["card/ws-leaving/", "snapshot/site/watch-leaving/", "snapshot/hiring/watch-leaving/"] },
    });
    await introspector.waitForStatus("complete");

    expect(await introspector.getOutput()).toEqual({ deleted: 4 });
    const left = await env.SNAPSHOTS.list();
    expect(left.objects.map((object) => object.key)).toEqual([
      "snapshot/hiring/watch-staying/1.json",
      "snapshot/site/watch-staying/1.txt",
    ]);
    const backedUp = await env.SNAPSHOTS_BACKUP.list();
    expect(backedUp.objects.map((object) => object.key)).toEqual([
      "snapshot/hiring/watch-staying/1.json",
      "snapshot/site/watch-staying/1.txt",
    ]);
  });

  it("reports the Workflow's own progress for the deleted account", async () => {
    await env.SNAPSHOTS.put("card/ws-leaving/share.png", "a");
    await env.SNAPSHOTS.put("snapshot/site/watch-leaving/1.txt", "b");
    await env.SNAPSHOTS.put("snapshot/site/watch-leaving/1.png", "c");
    await env.SNAPSHOTS.put("snapshot/hiring/watch-leaving/1.json", "e");
    await env.SNAPSHOTS.put("snapshot/hiring/watch-staying/1.json", "f");

    const id = "account-delete-progress";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await env.ACCOUNT_DELETE.create({
      id,
      params: { prefixes: ["card/ws-leaving/", "snapshot/site/watch-leaving/", "snapshot/hiring/watch-leaving/"] },
    });
    await introspector.waitForStatus("complete");

    expect(await readAccountDeleteProgress(id)).toEqual({ rows: "removed", files: "removed", deleted: 4 });
    expect(await readAccountDeleteProgress("no-such-instance")).toBeNull();
  });

  it("reports the Workflow still removing while the deletion step is retrying", async () => {
    const id = "account-delete-removing";
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, id);
    await introspector.modify(async (modifier) => {
      await modifier.mockStepError({ name: "delete card/ws-leaving/ page 0" }, new Error("R2 is slow"));
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
      await modifier.mockStepError({ name: "delete card/ws-leaving/ page 0" }, new Error("R2 blew up"));
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
      await modifier.mockStepError({ name: "delete card/ws-leaving/ page 0" }, new Error("R2 is slow"));
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
    const anonymous = (await loginPage(new Request(page))).body;
    expect(anonymous).toMatchObject({ id: null, progress: null });

    const forged = (await loginPage(new Request(page, { headers: { cookie: `account-delete=${id}` } }))).body;
    expect(forged).toMatchObject({ id: null, progress: null });

    const other = (await sealAccountDeleteInstanceId("a-different-instance")).split(";")[0];
    const wrongSeal = (await loginPage(new Request(page, { headers: { cookie: other } }))).body;
    expect(wrongSeal).toMatchObject({ id: null, progress: null });

    const sealed = (await sealAccountDeleteInstanceId(id)).split(";")[0];
    const owned = await loginPage(new Request(page, { headers: { cookie: sealed } }));
    expect(owned.body.id).toBe(id);
    expect(owned.body.progress).toEqual({ rows: "removed", files: "removed", deleted: 1 });
    expect(owned.setCookie).toContain("account-delete=");
    expect(owned.setCookie).toContain("Max-Age=0");
    expect(owned.setCookie).toContain("Path=/login");
  });

  it("seals the Workflow instance id on the headers the deleting browser leaves with", async () => {
    const { cookie, userId } = await signIn();
    const revoked: string[] = [];
    const pages: Record<string, { items: { id: string }[]; cursor?: string }> = {
      first: { items: [{ id: "grant-1" }], cursor: "second" },
      second: { items: [{ id: "grant-2" }] },
    };
    const helpers: Pick<OAuthHelpers, "listUserGrants" | "revokeGrant"> = {
      listUserGrants: async (_user, options) =>
        pages[options?.cursor ?? "first"] as Awaited<ReturnType<OAuthHelpers["listUserGrants"]>>,
      revokeGrant: async (grantId) => {
        revoked.push(grantId);
      },
    };

    const deleted = await deleteAccount(helpers, settingsRequest(cookie), userId);

    if (deleted === null) throw new Error("deleteAccount refused a fresh session");
    expect(revoked).toEqual(["grant-1", "grant-2"]);
    const baked = deleted.headers.getSetCookie().find((header) => header.startsWith("account-delete="));
    if (baked === undefined) throw new Error("no account-delete cookie on the delete headers");
    expect(baked).toContain("HttpOnly");
    expect(baked).toContain("Max-Age=3600");
    expect(baked).toContain("Path=/login");
    expect(baked).toContain("SameSite=Lax");

    expect(baked).toContain("Secure");

    const pair = baked.split(";")[0];
    if (!pair) throw new Error("the account-delete cookie carried no pair");
    const page = `${ORIGIN}/login?deleted=${deleted.instanceId}`;
    const shown = await loginPage(new Request(page, { headers: { cookie: pair } }));
    expect(shown.body.id).toBe(deleted.instanceId);
    expect(shown.body.progress).toMatchObject({ rows: "removed" });
  });

  it("rejects a cookie whose signature was tampered with", async () => {
    const id = "account-delete-tampered";
    const page = `${ORIGIN}/login?deleted=${id}`;
    const pair = (await sealAccountDeleteInstanceId(id)).split(";")[0];
    if (!pair) throw new Error("the sealed cookie carried no pair");
    const flipped = `${pair.slice(0, pair.lastIndexOf(".") + 1)}${"A".repeat(43)}`;

    const shown = await loginPage(new Request(page, { headers: { cookie: flipped } }));

    expect(shown.body).toMatchObject({ id: null, progress: null });
    expect(shown.setCookie).toBeNull();
  });

  it("deletes nothing when the cookie secret is missing", async () => {
    const { cookie, userId } = await signIn();
    const helpers: Pick<OAuthHelpers, "listUserGrants" | "revokeGrant"> = {
      listUserGrants: async () => ({ items: [] }),
      revokeGrant: async () => undefined,
    };
    const held = env.BETTER_AUTH_SECRET;
    const created: unknown[] = [];
    const create = env.ACCOUNT_DELETE.create.bind(env.ACCOUNT_DELETE);
    env.ACCOUNT_DELETE.create = (async (options: never) => {
      created.push(options);
      return create(options);
    }) as typeof env.ACCOUNT_DELETE.create;
    env.BETTER_AUTH_SECRET = "";
    try {
      await expect(deleteAccount(helpers, settingsRequest(cookie), userId)).rejects.toThrow(
        "BETTER_AUTH_SECRET is not configured",
      );
    } finally {
      env.BETTER_AUTH_SECRET = held;
      env.ACCOUNT_DELETE.create = create as typeof env.ACCOUNT_DELETE.create;
    }

    expect(created).toEqual([]);
    expect(await count('SELECT COUNT(*) AS n FROM "user" WHERE id = ?', userId)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM session WHERE userId = ?", userId)).toBe(1);
  });

  it("still hands back the headers and cookie when revoking a grant fails, and keeps revoking later pages", async () => {
    const { cookie, userId } = await signIn();
    const revoked: string[] = [];
    const pages: Record<string, { items: { id: string }[]; cursor?: string }> = {
      first: { items: [{ id: "grant-1" }], cursor: "second" },
      second: { items: [{ id: "grant-2" }] },
    };
    const helpers: Pick<OAuthHelpers, "listUserGrants" | "revokeGrant"> = {
      listUserGrants: async (_user, options) =>
        pages[options?.cursor ?? "first"] as Awaited<ReturnType<OAuthHelpers["listUserGrants"]>>,
      revokeGrant: async (grantId) => {
        if (grantId === "grant-1") throw new Error("KV is down for grant-1");
        revoked.push(grantId);
      },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const deleted = await deleteAccount(helpers, settingsRequest(cookie), userId);

    if (deleted === null) throw new Error("deleteAccount refused a fresh session");
    expect(await count('SELECT COUNT(*) AS n FROM "user" WHERE id = ?', userId)).toBe(0);
    expect(deleted.headers.getSetCookie().some((header) => header.startsWith("account-delete="))).toBe(true);
    expect(revoked).toEqual(["grant-2"]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toEqual({
      event: "account_delete.grant_revoke_failed",
      failed: 1,
    });
    errors.mockRestore();
  });
});
