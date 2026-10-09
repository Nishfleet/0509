import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  backfillSlackTargets,
  countUnsealedSlackTargets,
  readSlackTarget,
  runNightlySlackBackfill,
  saveSlackTarget,
} from "../../app/lib/data/send_target.server";
import { decryptSlackWebhook, encryptSlackWebhook } from "../../app/lib/slack-target-crypto.server";
import { runSettingsIntent } from "../../app/lib/settings.server";

const USER = "user-slack-alerts";
const WS = "ws-slack-alerts";
const HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456";
const CURRENT_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const PREVIOUS_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const OTHER_HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/zzzZZZ999999";

const insertTarget = async (id: string, targetValue: string, workspaceId = WS) => {
  const channel = await env.DB.prepare(`SELECT id FROM channel WHERE key = 'slack'`).first<{ id: string }>();
  if (channel === null) throw new Error("slack channel missing");
  await env.DB.prepare(
    `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
     VALUES (?, ?, ?, ?, 1, '2026-10-01T00:00:00Z')`,
  )
    .bind(id, workspaceId, channel.id, targetValue)
    .run();
};

const rawRows = async () =>
  (
    await env.DB.prepare(`SELECT id, target_value FROM send_target ORDER BY id`).all<{
      id: string;
      target_value: string;
    }>()
  ).results;

const call = (fields: Record<string, string>) =>
  runSettingsIntent(
    { id: USER, email: "owner@0509.io" },
    new Request("https://0509.io/app/settings", { method: "POST", body: new URLSearchParams(fields) }),
    {} as never,
  );

const stubSlack = (status: number) => {
  const posts: { url: string; body: string }[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: String(init?.body ?? "") });
    return Promise.resolve(new Response("ok", { status }));
  });
  return posts;
};

describe("Slack alerts setting (0509#6376)", () => {
  beforeEach(async () => {
    for (const table of ["send_target", "workspace"]) await env.DB.exec(`DELETE FROM ${table}`);
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, 'Owner', 'owner@0509.io', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      ).bind(USER),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Slack alerts', ?, 'UTC', 1, 8, '2026-10-01T00:00:00Z')`,
      ).bind(WS, USER),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects after Slack accepts a test message, and stores the address as the workspace's Slack target", async () => {
    const posts = stubSlack(200);

    const outcome = await call({ intent: "slack-save", webhook: HOOK });

    expect(outcome).toMatchObject({ saved: true, slackError: null });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(HOOK);
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({ text: expect.stringContaining("connected") });
    expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(HOOK);
    const stored = await env.DB.prepare(`SELECT target_value FROM send_target WHERE workspace_id = ?`)
      .bind(WS)
      .first<{ target_value: string }>();
    expect(stored?.target_value.startsWith("enc:v2:")).toBe(true);
    expect(stored?.target_value).not.toContain("hooks.slack.com");
  });

  it("reads v1, previous-key and plaintext rows without writing anything (0509#6983)", async () => {
    const v2 = await encryptSlackWebhook(HOOK, CURRENT_KEY, WS);
    const v1 = `enc:v1:${v2.split(":").slice(3).join(":")}`;
    const previous = await encryptSlackWebhook(HOOK, PREVIOUS_KEY, WS);
    const held = env.SLACK_TARGET_SECRET;
    env.SLACK_TARGET_SECRET = `${CURRENT_KEY},${PREVIOUS_KEY}`;
    try {
      for (const stored of [v1, previous, HOOK, v2]) {
        await env.DB.exec("DELETE FROM send_target");
        await insertTarget("st-read", stored);
        const before = await rawRows();
        expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(HOOK);
        expect(await rawRows()).toEqual(before);
        expect(before[0]?.target_value).toBe(stored);
      }
    } finally {
      env.SLACK_TARGET_SECRET = held;
    }
  });

  it("refuses to save when SLACK_TARGET_SECRET is missing, and still reads plaintext without it", async () => {
    const channel = await env.DB.prepare(`SELECT id FROM channel WHERE key = 'slack'`).first<{ id: string }>();
    if (channel === null) throw new Error("slack channel missing");
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES ('st-slack-plain-nokey', ?, ?, ?, 1, '2026-10-01T00:00:00Z')`,
    )
      .bind(WS, channel.id, HOOK)
      .run();
    const held = env.SLACK_TARGET_SECRET;
    env.SLACK_TARGET_SECRET = "";
    try {
      await expect(
        saveSlackTarget(env.DB, { workspaceId: WS, webhookUrl: HOOK, now: "2026-10-01T01:00:00Z" }),
      ).rejects.toThrow("SLACK_TARGET_SECRET is not configured");
      expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(HOOK);
    } finally {
      env.SLACK_TARGET_SECRET = held;
    }
  });

  it("refuses to read an encrypted row when SLACK_TARGET_SECRET is missing", async () => {
    stubSlack(200);
    await call({ intent: "slack-save", webhook: HOOK });
    const held = env.SLACK_TARGET_SECRET;
    env.SLACK_TARGET_SECRET = "";
    try {
      await expect(readSlackTarget(env.DB, WS)).rejects.toThrow("SLACK_TARGET_SECRET is not configured");
    } finally {
      env.SLACK_TARGET_SECRET = held;
    }
  });

  it("refuses an address that is not a Slack webhook without calling anything", async () => {
    const posts = stubSlack(200);

    const outcome = await call({ intent: "slack-save", webhook: "https://internal.example/hook" });

    expect(outcome.slackError).toContain("not a Slack webhook");
    expect(posts).toHaveLength(0);
    expect(await readSlackTarget(env.DB, WS)).toBeNull();
  });

  it("stores nothing when Slack rejects the test message", async () => {
    stubSlack(404);

    const outcome = await call({ intent: "slack-save", webhook: HOOK });

    expect(outcome.slackError).toContain("did not accept");
    expect(await readSlackTarget(env.DB, WS)).toBeNull();
  });

  it("replaces the old address on reconnect and removes it on disconnect", async () => {
    stubSlack(200);
    await call({ intent: "slack-save", webhook: HOOK });
    await saveSlackTarget(env.DB, { workspaceId: WS, webhookUrl: OTHER_HOOK, now: "2026-10-01T01:00:00Z" });
    expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(OTHER_HOOK);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM send_target WHERE workspace_id = ?")
      .bind(WS)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);

    await call({ intent: "slack-remove" });

    expect(await readSlackTarget(env.DB, WS)).toBeNull();
  });
});

describe("Slack target backfill (0509#6983, 0509#6981)", () => {
  const WS2 = "ws-slack-backfill-2";
  const WS3 = "ws-slack-backfill-3";
  let held: string;

  beforeEach(async () => {
    held = env.SLACK_TARGET_SECRET;
    env.SLACK_TARGET_SECRET = `${CURRENT_KEY},${PREVIOUS_KEY}`;
    await env.DB.exec("DELETE FROM send_target");
    await env.DB.batch(
      [WS2, WS3].map((id) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
           VALUES (?, 'Backfill', ?, 'UTC', 1, 8, '2026-10-01T00:00:00Z')`,
        ).bind(id, USER),
      ),
    );
  });

  afterEach(() => {
    env.SLACK_TARGET_SECRET = held;
  });

  const seed = async () => {
    const v2 = await encryptSlackWebhook(HOOK, CURRENT_KEY, WS);
    await insertTarget("st-a-plain", HOOK, WS);
    await insertTarget(
      "st-b-v1",
      `enc:v1:${(await encryptSlackWebhook(HOOK, PREVIOUS_KEY, WS2)).split(":").slice(3).join(":")}`,
      WS2,
    );
    await insertTarget("st-c-old", await encryptSlackWebhook(HOOK, PREVIOUS_KEY, WS3), WS3);
    await insertTarget("st-d-current", v2, WS);
    return v2;
  };

  it("seals plaintext, v1 and old-key rows with the current key and leaves current rows alone", async () => {
    const current = await seed();

    const result = await backfillSlackTargets(env.DB, { batchSize: 2 });

    expect(result).toEqual({ sealed: 3, skipped: 0, failed: 0 });
    const rows = await rawRows();
    expect(rows.find((row) => row.id === "st-d-current")?.target_value).toBe(current);
    for (const row of rows) expect(row.target_value.startsWith("enc:v2:")).toBe(true);
    const owners: Record<string, string> = { "st-a-plain": WS, "st-b-v1": WS2, "st-c-old": WS3, "st-d-current": WS };
    for (const row of rows) {
      expect(await decryptSlackWebhook(row.target_value, CURRENT_KEY, owners[row.id] ?? "")).toBe(HOOK);
    }
  });

  it("is idempotent: a second run finds nothing left and writes nothing", async () => {
    await seed();
    await backfillSlackTargets(env.DB, { batchSize: 1 });
    const before = await rawRows();

    expect(await backfillSlackTargets(env.DB)).toEqual({ sealed: 0, skipped: 0, failed: 0 });
    expect(await rawRows()).toEqual(before);
  });

  it("skips a row that changed under it instead of overwriting it", async () => {
    await insertTarget("st-race", HOOK, WS);
    const racing = {
      prepare: (query: string) => {
        const statement = env.DB.prepare(query);
        if (!query.startsWith("UPDATE send_target SET target_value")) return statement;
        return {
          bind: (...values: unknown[]) => ({
            run: async () => {
              await env.DB.prepare(`UPDATE send_target SET target_value = ? WHERE id = 'st-race'`)
                .bind(OTHER_HOOK)
                .run();
              return statement.bind(...values).run();
            },
          }),
        };
      },
    } as unknown as D1Database;

    expect(await backfillSlackTargets(racing)).toEqual({ sealed: 0, skipped: 1, failed: 0 });
    expect((await rawRows())[0]?.target_value).toBe(OTHER_HOOK);
  });

  it("counts an unreadable row as failed, keeps it untouched and carries on", async () => {
    await insertTarget("st-a-junk", "not a webhook", WS);
    await insertTarget("st-b-ok", HOOK, WS2);

    expect(await backfillSlackTargets(env.DB)).toEqual({ sealed: 1, skipped: 0, failed: 1 });
    const rows = await rawRows();
    expect(rows[0]?.target_value).toBe("not a webhook");
  });

  it("refuses to run when any key in the list is malformed", async () => {
    await insertTarget("st-a-plain", HOOK, WS);
    env.SLACK_TARGET_SECRET = `${CURRENT_KEY},AAAA`;
    await expect(backfillSlackTargets(env.DB)).rejects.toThrow("SLACK_TARGET_SECRET must be 32 bytes");
    expect((await rawRows())[0]?.target_value).toBe(HOOK);
  });

  it("lets a database error surface instead of counting the row as failed", async () => {
    await insertTarget("st-a-plain", HOOK, WS);
    const broken = {
      prepare: (query: string) => {
        if (!query.startsWith("UPDATE send_target SET target_value")) return env.DB.prepare(query);
        return { bind: () => ({ run: () => Promise.reject(new Error("D1 unavailable")) }) };
      },
    } as unknown as D1Database;

    await expect(backfillSlackTargets(broken)).rejects.toThrow("D1 unavailable");
    expect((await rawRows())[0]?.target_value).toBe(HOOK);
    const attempts = await env.DB.prepare(`SELECT seal_attempts AS n FROM send_target`).first<{ n: number }>();
    expect(attempts?.n).toBe(0);
  });

  it("lets a database error on the select surface", async () => {
    const broken = {
      prepare: () => ({ bind: () => ({ all: () => Promise.reject(new Error("D1 unavailable")) }) }),
    } as unknown as D1Database;
    await expect(backfillSlackTargets(broken)).rejects.toThrow("D1 unavailable");
  });

  it("seals a good row behind more unreadable rows than the cap in one run, and stops retrying the unreadable ones", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    for (const id of ["st-a-junk", "st-b-junk", "st-c-junk", "st-d-junk"])
      await insertTarget(id, `not a webhook ${id}`, WS);
    await insertTarget("st-z-good", HOOK, WS2);
    const attempts = async () =>
      (
        await env.DB.prepare(`SELECT id, seal_attempts AS n FROM send_target ORDER BY id`).all<{
          id: string;
          n: number;
        }>()
      ).results;

    expect(await runNightlySlackBackfill(env.DB, { maxRows: 2 })).toBe(4);
    expect(await decryptSlackWebhook((await rawRows()).at(-1)?.target_value ?? "", CURRENT_KEY, WS2)).toBe(HOOK);
    for (let night = 0; night < 10; night += 1) await runNightlySlackBackfill(env.DB, { maxRows: 2 });
    expect((await attempts()).map((row) => row.n)).toEqual([3, 3, 3, 3, 0]);
    expect(await countUnsealedSlackTargets(env.DB)).toBe(0);
    expect(await backfillSlackTargets(env.DB, { maxRows: 2 })).toEqual({ sealed: 0, skipped: 0, failed: 0 });
    info.mockClear();
    expect(await runNightlySlackBackfill(env.DB, { maxRows: 2 })).toBe(0);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ remaining: 0, stuck: 4 });
    info.mockRestore();
  });

  it("refuses to run without a usable key list", async () => {
    env.SLACK_TARGET_SECRET = `${CURRENT_KEY},`;
    await expect(backfillSlackTargets(env.DB)).rejects.toThrow("SLACK_TARGET_SECRET is not configured");
  });

  it("nightly run seals up to the cap, reports only counts, and a second run is quiet", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await seed();

    expect(await runNightlySlackBackfill(env.DB, { maxRows: 2 })).toBe(1);
    expect(await countUnsealedSlackTargets(env.DB)).toBe(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      event: "slack_backfill.remaining",
      remaining: 1,
      stuck: 0,
      sealed: 2,
      skipped: 0,
      failed: 0,
    });
    expect(String(info.mock.calls[0]?.[0])).not.toContain("hooks.slack.com");

    info.mockClear();
    expect(await runNightlySlackBackfill(env.DB, { maxRows: 2 })).toBe(0);
    const after = await rawRows();
    expect(await runNightlySlackBackfill(env.DB, { maxRows: 2 })).toBe(0);
    expect(await rawRows()).toEqual(after);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("nightly run fails closed without a key and leaves rows untouched", async () => {
    await seed();
    const before = await rawRows();
    env.SLACK_TARGET_SECRET = "";

    await expect(runNightlySlackBackfill(env.DB)).rejects.toThrow("SLACK_TARGET_SECRET is not configured");
    expect(await rawRows()).toEqual(before);
  });

  it("reading a target never writes", async () => {
    await insertTarget("st-a-plain", HOOK, WS);
    const before = await rawRows();

    expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(HOOK);
    expect(await rawRows()).toEqual(before);
  });
});
