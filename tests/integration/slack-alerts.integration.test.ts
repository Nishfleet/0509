import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSlackTarget, saveSlackTarget } from "../../app/lib/data/send_target.server";
import { runSettingsIntent } from "../../app/lib/settings.server";
import { encryptSlackWebhook, slackTargetKeyId } from "../../app/lib/slack-target-crypto.server";

const USER = "user-slack-alerts";
const WS = "ws-slack-alerts";
const HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456";
const OTHER_HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/zzzZZZ999999";

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

  it("reads a plaintext row left by the previous Worker and seals it in place (0509#6398)", async () => {
    const channel = await env.DB.prepare(`SELECT id FROM channel WHERE key = 'slack'`).first<{ id: string }>();
    if (channel === null) throw new Error("slack channel missing");
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES ('st-slack-plain', ?, ?, ?, 1, '2026-10-01T00:00:00Z')`,
    )
      .bind(WS, channel.id, HOOK)
      .run();

    expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(HOOK);
    const stored = await env.DB.prepare(`SELECT target_value FROM send_target WHERE id = 'st-slack-plain'`).first<{
      target_value: string;
    }>();
    expect(stored?.target_value.startsWith("enc:v2:")).toBe(true);
    expect(stored?.target_value).not.toContain("hooks.slack.com");
    expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(HOOK);
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
      const stored = await env.DB.prepare(
        `SELECT target_value FROM send_target WHERE id = 'st-slack-plain-nokey'`,
      ).first<{
        target_value: string;
      }>();
      expect(stored?.target_value).toBe(HOOK);
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

  it("reads rows sealed with the previous key during rotation and re-seals them with the new key", async () => {
    stubSlack(200);
    await call({ intent: "slack-save", webhook: HOOK });
    const held = env.SLACK_TARGET_SECRET;
    const next = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
    const storedValue = async () =>
      (
        await env.DB.prepare(`SELECT target_value FROM send_target WHERE workspace_id = ?`)
          .bind(WS)
          .first<{ target_value: string }>()
      )?.target_value ?? "";
    expect(await storedValue()).toContain(`enc:v2:${await slackTargetKeyId(held)}:`);
    env.SLACK_TARGET_SECRET = `${next},${held}`;
    try {
      expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(HOOK);
      expect(await storedValue()).toContain(`enc:v2:${await slackTargetKeyId(next)}:`);
      env.SLACK_TARGET_SECRET = next;
      expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(HOOK);
    } finally {
      env.SLACK_TARGET_SECRET = held;
    }
  });

  it("re-seals a legacy enc:v1 row with the current key on read", async () => {
    const sealed = await encryptSlackWebhook(HOOK, env.SLACK_TARGET_SECRET, WS);
    const legacy = `enc:v1:${sealed.split(":")[3] ?? ""}`;
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       SELECT 'st-slack-v1', ?, id, ?, 1, '2026-10-01T00:00:00Z' FROM channel WHERE key = 'slack'`,
    )
      .bind(WS, legacy)
      .run();

    expect((await readSlackTarget(env.DB, WS))?.target_value).toBe(HOOK);
    const stored = await env.DB.prepare(`SELECT target_value FROM send_target WHERE id = 'st-slack-v1'`).first<{
      target_value: string;
    }>();
    expect(stored?.target_value.startsWith(`enc:v2:${await slackTargetKeyId(env.SLACK_TARGET_SECRET)}:`)).toBe(true);
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
