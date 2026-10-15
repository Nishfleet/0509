import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSlackTarget } from "../../app/lib/data/send_target.server";
import { deliver } from "../../workers/delivery/consumer";

const WS = "ws-slack-brief";
const USER = "user-slack-brief";
const HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456";
const PAYLOAD = JSON.stringify({
  workspace_id: WS,
  timezone: "UTC",
  period_start: "2026-09-14T08:00:00.000Z",
  period_end: "2026-09-21T08:00:00.000Z",
  headline_rank: 1,
  headline_total: 3,
  headline_movement: 0,
  headline_is_new: false,
  why_line: "A quiet lead",
  is_quiet_week: false,
  is_unjudged: false,
  read_this_first: [{ signal_id: "s1", entity_name: "Rival", title: "Cut a plan", jev_reason: "r" }],
  brands: [],
});

const email = (): SendEmail => ({ send: () => Promise.resolve({ messageId: "unused" }) });
const envWithEmail = (): Env => ({ ...env, EMAIL: email() }) as Env;

const stubSlack = () => {
  const posts: { url: string; body: string }[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: String(init?.body ?? "") });
    return Promise.resolve(new Response("ok", { status: 200 }));
  });
  return posts;
};

const stubSlackStatus = (status: number) => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status })));
};

const slackConnected = (id: string) =>
  env.DB.prepare(`SELECT is_verified FROM send_target WHERE workspace_id = ? AND id <> 't-email'`)
    .bind(id)
    .first<{ is_verified: number }>();

const seedDigest = (id: string, kind: string) =>
  env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
     VALUES (?, ?, ?, '2026-09-14', '2026-09-21', 'pending', NULL, ?, NULL)`,
  )
    .bind(id, WS, kind, PAYLOAD)
    .run();

describe("weekly brief also posts to Slack", () => {
  beforeEach(async () => {
    for (const table of ["send_attempt", "digest", "send_target", "plan", "workspace", "email_suppression"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    const channel = await env.DB.prepare(`SELECT id FROM channel WHERE key = 'email'`).first<{ id: string }>();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, 'Owner', 'owner@0509.io', 1, '2026-09-14T00:00:00Z', '2026-09-14T00:00:00Z')`,
      ).bind(USER),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Slack brief', ?, 'UTC', 1, 8, '2026-09-14T00:00:00Z')`,
      ).bind(WS, USER),
      env.DB.prepare(
        `INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES ('plan-sb', ?, 'scout', 'trialing', '2026-09-14T00:00:00Z')`,
      ).bind(WS),
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
         VALUES ('t-email', ?, ?, 'owner@0509.io', 1, '2026-09-14T00:00:00Z')`,
      ).bind(WS, channel?.id ?? ""),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the brief once to the connected channel, and a second delivery posts nothing", async () => {
    const posts = stubSlack();
    await saveSlackTarget(env.DB, { workspaceId: WS, webhookUrl: HOOK, now: "2026-09-14T00:00:00Z" });
    await seedDigest("d-sb-1", "weekly");

    await deliver(envWithEmail(), { digest_id: "d-sb-1" });
    await deliver(envWithEmail(), { digest_id: "d-sb-1" });

    const slackPosts = posts.filter((post) => post.url === HOOK);
    expect(slackPosts).toHaveLength(1);
    expect(JSON.parse(slackPosts[0]?.body ?? "{}").text).toContain("You're #1 of 3 this week");
  });

  it("posts nothing when Slack is not connected", async () => {
    const posts = stubSlack();
    await seedDigest("d-sb-2", "weekly");

    await deliver(envWithEmail(), { digest_id: "d-sb-2" });

    expect(posts).toHaveLength(0);
  });

  it("disconnects Slack when the channel link is revoked, and the brief still counts as sent", async () => {
    stubSlackStatus(404);
    await saveSlackTarget(env.DB, { workspaceId: WS, webhookUrl: HOOK, now: "2026-09-14T00:00:00Z" });
    await seedDigest("d-sb-3", "weekly");

    const result = await deliver(envWithEmail(), { digest_id: "d-sb-3" });

    expect(result.outcome).toBe("sent");
    expect((await slackConnected(WS))?.is_verified).toBe(0);
  });

  it("keeps Slack connected and still counts the brief as sent when Slack is briefly down", async () => {
    stubSlackStatus(503);
    await saveSlackTarget(env.DB, { workspaceId: WS, webhookUrl: HOOK, now: "2026-09-14T00:00:00Z" });
    await seedDigest("d-sb-4", "weekly");

    const result = await deliver(envWithEmail(), { digest_id: "d-sb-4" });

    expect(result.outcome).toBe("sent");
    expect((await slackConnected(WS))?.is_verified).toBe(1);
  });
});
