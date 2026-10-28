import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSlackTarget } from "../../app/lib/data/send_target.server";
import { deliver, handleBatch } from "../../workers/delivery/consumer";

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

const envWithQueue = (queued: unknown[] = [], sendBatch?: () => Promise<void>): Env =>
  ({
    ...env,
    EMAIL: email(),
    SEND_EMAIL: {
      sendBatch:
        sendBatch ??
        ((msgs: { body: unknown }[]) => {
          queued.push(...msgs.map((msg) => msg.body));
          return Promise.resolve();
        }),
    },
  }) as unknown as Env;

const batchFor = (body: unknown, attempts = 1) => {
  const acked: number[] = [];
  const retryOptions: unknown[] = [];
  const batch: MessageBatch = {
    queue: "send-email",
    messages: [
      {
        id: "msg-0",
        timestamp: new Date("2026-09-22T00:00:03Z"),
        body,
        attempts,
        ack: () => acked.push(0),
        retry: (options?: unknown) => retryOptions.push(options),
      },
    ],
    metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
    ackAll: () => acked.push(0),
    retryAll: () => retryOptions.push(undefined),
  };
  return { batch, acked, retryOptions };
};

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

const turnOnSlackBrief = () => env.DB.prepare(`UPDATE workspace SET slack_brief = 1 WHERE id = ?`).bind(WS).run();

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
    vi.restoreAllMocks();
  });

  const connect = () => saveSlackTarget(env.DB, { workspaceId: WS, webhookUrl: HOOK, now: "2026-09-14T00:00:00Z" });

  const targetId = async () =>
    (
      await env.DB.prepare(`SELECT id FROM send_target WHERE workspace_id = ? AND id <> 't-email'`).bind(WS).first<{
        id: string;
      }>()
    )?.id ?? "";

  const slackAttempt = (digestId: string) =>
    env.DB.prepare(`SELECT status FROM send_attempt WHERE idempotency_key LIKE ?`)
      .bind(`brief-slack:${digestId}:%`)
      .first<{ status: string }>();

  it("queues one Slack post after the owner's email, and posting it twice posts once", async () => {
    const posts = stubSlack();
    await connect();
    await turnOnSlackBrief();
    await seedDigest("d-sb-1", "weekly");
    const queued: unknown[] = [];

    const result = await deliver(envWithQueue(queued), { digest_id: "d-sb-1" });

    expect(result.outcome).toBe("sent");
    expect(queued).toEqual([{ digest_id: "d-sb-1", slack_target_id: await targetId() }]);
    expect(posts).toHaveLength(0);

    const first = batchFor(queued[0]);
    await handleBatch(envWithQueue(), first.batch);
    await handleBatch(envWithQueue(), batchFor(queued[0]).batch);

    const slackPosts = posts.filter((post) => post.url === HOOK);
    expect(slackPosts).toHaveLength(1);
    expect(JSON.parse(slackPosts[0]?.body ?? "{}").text).toContain("You're #1 of 3 this week");
    expect(first.acked).toEqual([0]);
    expect((await slackAttempt("d-sb-1"))?.status).toBe("sent");
  });

  it("queues nothing again once the Slack post is done", async () => {
    stubSlack();
    await connect();
    await turnOnSlackBrief();
    await seedDigest("d-sb-1", "weekly");
    const queued: unknown[] = [];
    await deliver(envWithQueue(queued), { digest_id: "d-sb-1" });
    await handleBatch(envWithQueue(), batchFor(queued[0]).batch);

    const again: unknown[] = [];
    await deliver(envWithQueue(again), { digest_id: "d-sb-1" });

    expect(again).toEqual([]);
  });

  it("queues and posts nothing while the weekly brief in Slack switch is off, which is the default", async () => {
    const posts = stubSlack();
    await connect();
    await seedDigest("d-sb-0", "weekly");
    const queued: unknown[] = [];

    const result = await deliver(envWithQueue(queued), { digest_id: "d-sb-0" });

    expect(result.outcome).toBe("sent");
    expect(queued).toEqual([]);
    expect(posts.filter((post) => post.url === HOOK)).toHaveLength(0);
  });

  it("does not post a queued brief if the owner switched it off meanwhile", async () => {
    const posts = stubSlack();
    await connect();
    await turnOnSlackBrief();
    await seedDigest("d-sb-5", "weekly");
    const queued: unknown[] = [];
    await deliver(envWithQueue(queued), { digest_id: "d-sb-5" });
    await env.DB.prepare(`UPDATE workspace SET slack_brief = 0 WHERE id = ?`).bind(WS).run();

    const switchedOff = batchFor(queued[0]);
    await handleBatch(envWithQueue(), switchedOff.batch);

    expect(posts.filter((post) => post.url === HOOK)).toHaveLength(0);
    expect(switchedOff.acked).toEqual([0]);
  });

  it("queues nothing when Slack is not connected", async () => {
    stubSlack();
    await turnOnSlackBrief();
    await seedDigest("d-sb-2", "weekly");
    const queued: unknown[] = [];

    await deliver(envWithQueue(queued), { digest_id: "d-sb-2" });

    expect(queued).toEqual([]);
  });

  it("disconnects Slack when the channel link is revoked, and settles the message", async () => {
    stubSlackStatus(404);
    await connect();
    await turnOnSlackBrief();
    await seedDigest("d-sb-3", "weekly");
    const queued: unknown[] = [];
    await deliver(envWithQueue(queued), { digest_id: "d-sb-3" });

    const run = batchFor(queued[0]);
    await handleBatch(envWithQueue(), run.batch);

    expect(run.acked).toEqual([0]);
    expect(run.retryOptions).toEqual([]);
    expect((await slackConnected(WS))?.is_verified).toBe(0);
    expect((await slackAttempt("d-sb-3"))?.status).toBe("skipped_revoked");
  });

  it("retries a Slack outage on its own, and the retry posts once", async () => {
    await connect();
    await turnOnSlackBrief();
    await seedDigest("d-sb-4", "weekly");
    const queued: unknown[] = [];
    stubSlackStatus(503);
    const owner = await deliver(envWithQueue(queued), { digest_id: "d-sb-4" });

    const down = batchFor(queued[0], 1);
    await handleBatch(envWithQueue(), down.batch);

    expect(owner.outcome).toBe("sent");
    expect(down.acked).toEqual([]);
    expect(down.retryOptions).toEqual([{ delaySeconds: 600 }]);
    expect((await slackAttempt("d-sb-4"))?.status).toBe("failed");
    expect((await slackConnected(WS))?.is_verified).toBe(1);

    const posts = stubSlack();
    const retry = batchFor(queued[0], 2);
    await handleBatch(envWithQueue(), retry.batch);

    expect(posts.filter((post) => post.url === HOOK)).toHaveLength(1);
    expect(retry.acked).toEqual([0]);
    expect((await slackAttempt("d-sb-4"))?.status).toBe("sent");
  });

  it("does not post again after a network error that may have reached Slack, and says so loudly", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await connect();
    await turnOnSlackBrief();
    await seedDigest("d-sb-7", "weekly");
    const queued: unknown[] = [];
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("socket closed")));
    await deliver(envWithQueue(queued), { digest_id: "d-sb-7" });

    const first = batchFor(queued[0], 1);
    await handleBatch(envWithQueue(), first.batch);

    expect(first.acked).toEqual([0]);
    expect(first.retryOptions).toEqual([]);
    expect((await slackAttempt("d-sb-7"))?.status).toBe("unconfirmed");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("delivery.slack_post_unconfirmed"));

    const posts = stubSlack();
    const again = batchFor(queued[0], 2);
    await handleBatch(envWithQueue(), again.batch);
    expect(posts.filter((post) => post.url === HOOK)).toHaveLength(0);
  });

  it("gives up after three tries, says so loudly, and leaves the email digest sent", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await connect();
    await turnOnSlackBrief();
    await seedDigest("d-sb-6", "weekly");
    const queued: unknown[] = [];
    stubSlackStatus(503);
    await deliver(envWithQueue(queued), { digest_id: "d-sb-6" });

    const last = batchFor(queued[0], 3);
    await handleBatch(envWithQueue(), last.batch);

    expect(last.acked).toEqual([0]);
    expect(last.retryOptions).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("delivery.slack_brief_gave_up"));
    const digest = await env.DB.prepare(`SELECT status FROM digest WHERE id = 'd-sb-6'`).first<{ status: string }>();
    expect(digest?.status).toBe("sent");
  });

  it("never lets a queue failure for the Slack post fail the owner's email", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await connect();
    await turnOnSlackBrief();
    await seedDigest("d-sb-7", "weekly");

    const result = await deliver(
      envWithQueue([], () => Promise.reject(new Error("queue down"))),
      { digest_id: "d-sb-7" },
    );

    expect(result.outcome).toBe("sent");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("delivery.slack_brief_failed"));
  });
});
