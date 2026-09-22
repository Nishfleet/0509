import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { suppressToken } from "../../app/lib/email-suppression.server";
import { deliver, handleSendQueue, sweepStuckSends } from "../../workers/delivery/consumer";

import type { OutboundMail } from "../../workers/delivery/send";

const NOW = new Date("2026-09-22T12:00:00.000Z");

function mailbox() {
  const messages: OutboundMail[] = [];
  const email = {
    async send(message: OutboundMail) {
      messages.push(message);
      return { messageId: `msg-${String(messages.length)}` };
    },
  };
  return { messages, email };
}

async function seed(tag: string) {
  const now = NOW.toISOString();
  const userId = `user-${tag}`;
  const workspaceId = `ws-${tag}`;
  const selfId = `self-${tag}`;
  const offId = `off-${tag}`;
  const pageId = `page-${tag}`;
  const targetId = `target-${tag}`;
  const address = `${tag}@example.com`;
  const token = `token-${tag}`;
  const channel = await env.DB.prepare(`SELECT id FROM channel WHERE key = 'email'`).first<{ id: string }>();
  if (!channel) throw new Error("email channel missing");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`,
    ).bind(userId, "Owner", address, now, now),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?, ?, ?, 'UTC', ?)`,
    ).bind(workspaceId, tag, userId, now),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
       VALUES (?, ?, 'self', ?, 'Five to Nine', '{}', 'manual', 'on', ?)`,
    ).bind(selfId, workspaceId, `${tag}.example`, now),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
       VALUES (?, ?, 'competitor', ?, 'Zeta', '{}', 'manual', 'off', ?)`,
    ).bind(offId, workspaceId, `zeta-${tag}.example`, now),
    env.DB.prepare(`INSERT INTO page (id, entity_id, url, discovered_at) VALUES (?, ?, ?, ?)`).bind(
      pageId,
      selfId,
      `https://${tag}.example/pricing`,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO send_target (
         id, workspace_id, channel_id, target_value, is_verified, created_at, unsubscribe_token
       ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(targetId, workspaceId, channel.id, address, now, token),
  ]);
  return { userId, workspaceId, selfId, offId, pageId, targetId, address, channelId: channel.id, token };
}

function briefPayload(selfId: string, offId: string, signalId: string) {
  return {
    headline: { rank: 2, of: 4, movement: 1, why: "A pricing page changed." },
    read_this_first: [
      {
        signal_id: signalId,
        entity_id: selfId,
        source: "site",
        observed_at: NOW.toISOString(),
        thumbnail_url: null,
        link: "https://example.com/item",
        title: "Quoted once",
      },
    ],
    brands: [
      {
        entity_id: selfId,
        name: "Alpha",
        biggest_move: "Steady.",
        ad_delta: 1,
        mention_delta: 0,
        site_change_count: 1,
      },
      {
        entity_id: offId,
        name: "Zeta",
        biggest_move: "Should be absent.",
        ad_delta: 9,
        mention_delta: 9,
        site_change_count: 9,
      },
    ],
    own_site: { items: [] },
    checked: [{ source: "site", count: 4 }],
    next_brief_at: "2026-09-28T12:00:00.000Z",
    quiet: false,
  };
}

async function insertDigest(id: string, workspaceId: string, payload: unknown, periodEnd = NOW.toISOString()) {
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json)
     VALUES (?, ?, 'weekly', '2026-09-15T12:00:00.000Z', ?, 'pending', ?)`,
  )
    .bind(id, workspaceId, periodEnd, JSON.stringify(payload))
    .run();
}

async function insertSignal(tag: string, workspaceId: string, entityId: string, signalId: string) {
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key) VALUES (?, ?, 'site', 'web', ?)`,
  )
    .bind(`source-${tag}`, `key-${tag}`, `plugin-${tag}`)
    .run();
  await env.DB.prepare(
    `INSERT INTO signal (
       id, workspace_id, entity_id, source_id, kind, aspect, title, payload_json, dedup_key, observed_at
     ) VALUES (?, ?, ?, ?, 'change', 'pricing', 'Quoted once', '{}', ?, ?)`,
  )
    .bind(signalId, workspaceId, entityId, `source-${tag}`, `dedup-${signalId}`, NOW.toISOString())
    .run();
}

describe("delivery schema", () => {
  it("adds the unsubscribe token and the widened incident notice key", async () => {
    const cols = await env.DB.prepare(`SELECT name FROM pragma_table_info('send_target')`).all<{ name: string }>();
    expect((cols.results ?? []).map((col) => col.name)).toContain("unsubscribe_token");
    const ghost = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE name = 'incident_notice_new'`,
    ).first();
    expect(ghost).toBeNull();
    const channel = await env.DB.prepare(`SELECT id FROM channel WHERE key = 'email'`).first<{ id: string }>();
    expect(channel?.id).toBe("email");
  });
});

describe("send lane", () => {
  it("claims, sends once, and a re-enqueue does not send again", async () => {
    const row = await seed("once");
    const digestId = "digest-once";
    await insertDigest(digestId, row.workspaceId, briefPayload(row.selfId, row.offId, "missing-signal"));
    const box = mailbox();
    const first = await deliver(env.DB, box.email, { digest_id: digestId }, NOW);
    expect(first).toMatchObject({ outcome: "sent" });
    if (first.outcome !== "sent") return;
    const attempt = await env.DB.prepare(
      `SELECT id, idempotency_key, status, attempted_at FROM send_attempt WHERE id = ?`,
    )
      .bind(first.attemptId)
      .first<{ id: string; idempotency_key: string; status: string; attempted_at: string }>();
    expect(attempt).toEqual({
      id: first.attemptId,
      idempotency_key: `digest:${digestId}:${row.targetId}`,
      status: "sent",
      attempted_at: NOW.toISOString(),
    });
    expect(box.messages).toHaveLength(1);
    expect(box.messages[0]?.from).toBe("brief@0509.io");
    expect(box.messages[0]?.headers?.["List-Unsubscribe"]).toBe(`<https://0509.io/u/${row.token}>`);
    const second = await deliver(env.DB, box.email, { digest_id: digestId }, NOW);
    expect(second.outcome).toBe("duplicate");
    expect(box.messages).toHaveLength(1);
    const delivered = await env.DB.prepare(
      `SELECT count(*) AS n FROM send_attempt WHERE status = 'delivered'`,
    ).first<{ n: number }>();
    expect(delivered?.n).toBe(0);
  });

  it("skips a suppressed address with no attempt row", async () => {
    const row = await seed("quiet-address");
    await env.DB.prepare(
      `INSERT INTO email_suppression (address, reason, created_at) VALUES (lower(?), 'unsubscribe', ?)`,
    )
      .bind(row.address, NOW.toISOString())
      .run();
    const digestId = "digest-suppressed";
    await insertDigest(digestId, row.workspaceId, briefPayload(row.selfId, row.offId, "sig-x"));
    const box = mailbox();
    const result = await deliver(env.DB, box.email, { digest_id: digestId }, NOW);
    expect(result.outcome).toBe("suppressed");
    expect(box.messages).toHaveLength(0);
    const attempts = await env.DB.prepare(`SELECT count(*) AS n FROM send_attempt WHERE workspace_id = ?`)
      .bind(row.workspaceId)
      .first<{ n: number }>();
    expect(attempts?.n).toBe(0);
  });

  it("refuses a second send_target instead of under-delivering", async () => {
    const row = await seed("two-targets");
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    )
      .bind("target-two", row.workspaceId, row.channelId, "other@example.com", NOW.toISOString())
      .run();
    const digestId = "digest-two";
    await insertDigest(digestId, row.workspaceId, briefPayload(row.selfId, row.offId, "sig-y"));
    const box = mailbox();
    await expect(deliver(env.DB, box.email, { digest_id: digestId }, NOW)).rejects.toThrow(/widen that key/);
    expect(box.messages).toHaveLength(0);
  });

  it("omits an off brand and does not quote a signal again the next week", async () => {
    const row = await seed("weeks");
    const signalId = "sig-weeks";
    await insertSignal("weeks", row.workspaceId, row.selfId, signalId);
    const payload = briefPayload(row.selfId, row.offId, signalId);
    await insertDigest("digest-week-1", row.workspaceId, payload);
    const box = mailbox();
    const first = await deliver(env.DB, box.email, { digest_id: "digest-week-1" }, NOW);
    expect(first.outcome).toBe("sent");
    expect(box.messages[0]?.text).toContain("Quoted once");
    expect(box.messages[0]?.text).not.toContain("Zeta");
    const recorded = await env.DB.prepare(
      `SELECT signal_id, channel_id FROM signal_delivery WHERE signal_id = ?`,
    )
      .bind(signalId)
      .first<{ signal_id: string; channel_id: string }>();
    expect(recorded).toEqual({ signal_id: signalId, channel_id: row.channelId });
    await insertDigest("digest-week-2", row.workspaceId, payload, "2026-09-29T12:00:00.000Z");
    const second = await deliver(env.DB, box.email, { digest_id: "digest-week-2" }, NOW);
    expect(second.outcome).toBe("sent");
    expect(box.messages[1]?.text).not.toContain("Quoted once");
    expect(box.messages[1]?.text).toContain("Alpha:");
  });

  it("sends the quiet week", async () => {
    const row = await seed("quiet");
    const payload = briefPayload(row.selfId, row.offId, "sig-quiet");
    payload.quiet = true;
    await insertDigest("digest-quiet", row.workspaceId, payload);
    const box = mailbox();
    const result = await deliver(env.DB, box.email, { digest_id: "digest-quiet" }, NOW);
    expect(result.outcome).toBe("sent");
    expect(box.messages[0]?.text).toContain("Quiet week.");
    expect(box.messages[0]?.text).toContain("Checked site 4.");
  });

  it("sends the open incident and the same-day fixed follow-up, then drops a second open", async () => {
    const row = await seed("incident");
    const incidentId = "inc-1";
    await env.DB.prepare(
      `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at)
       VALUES (?, ?, ?, ?, 'pricing section gone', ?)`,
    )
      .bind(incidentId, row.workspaceId, row.selfId, row.pageId, NOW.toISOString())
      .run();
    const box = mailbox();
    const open = await deliver(env.DB, box.email, { incident_id: incidentId }, NOW);
    expect(open.outcome).toBe("sent");
    expect(box.messages[0]?.from).toBe("incident@0509.io");
    expect(box.messages[0]?.subject).toBe("Five to Nine looks broken: pricing section gone");
    const again = await deliver(env.DB, box.email, { incident_id: incidentId }, NOW);
    expect(again.outcome).toBe("duplicate");
    expect(box.messages).toHaveLength(1);
    const fixed = await deliver(env.DB, box.email, { incident_id: incidentId, resolution: true }, NOW);
    expect(fixed.outcome).toBe("sent");
    expect(box.messages[1]?.subject).toBe("Five to Nine looks fixed");
    const closed = await env.DB.prepare(`SELECT closed_at FROM incident WHERE id = ?`)
      .bind(incidentId)
      .first<{ closed_at: string | null }>();
    expect(closed?.closed_at).toBe(NOW.toISOString());
    const notices = await env.DB.prepare(
      `SELECT count(*) AS n FROM incident_notice WHERE page_id = ? AND sent_on = '2026-09-22'`,
    )
      .bind(row.pageId)
      .first<{ n: number }>();
    expect(notices?.n).toBe(2);
    await expect(
      env.DB.prepare(
        `INSERT INTO incident_notice (id, incident_id, page_id, sent_on, sent_at, is_resolution)
         VALUES ('notice-extra', ?, ?, '2026-09-22', ?, 0)`,
      )
        .bind(incidentId, row.pageId, NOW.toISOString())
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("does not email a competitor incident", async () => {
    const row = await seed("rival");
    const rivalId = `rival-${row.workspaceId}`;
    const pageId = `rival-page-${row.workspaceId}`;
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
       VALUES (?, ?, 'competitor', ?, 'Rival', '{}', 'manual', 'on', ?)`,
    )
      .bind(rivalId, row.workspaceId, `rival-${row.workspaceId}.example`, NOW.toISOString())
      .run();
    await env.DB.prepare(`INSERT INTO page (id, entity_id, url, discovered_at) VALUES (?, ?, ?, ?)`).bind(
      pageId,
      rivalId,
      "https://rival.example/",
      NOW.toISOString(),
    ).run();
    await env.DB.prepare(
      `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at) VALUES (?, ?, ?, ?, 'down', ?)`,
    )
      .bind("inc-rival", row.workspaceId, rivalId, pageId, NOW.toISOString())
      .run();
    const box = mailbox();
    const result = await deliver(env.DB, box.email, { incident_id: "inc-rival" }, NOW);
    expect(result.outcome).toBe("dropped");
    expect(box.messages).toHaveLength(0);
  });

  it("re-enqueues a digest pending for more than 6 hours and a stale claim", async () => {
    const row = await seed("sweep");
    await insertDigest("digest-old", row.workspaceId, briefPayload(row.selfId, row.offId, "sig-old"), "2026-09-22T01:00:00.000Z");
    await insertDigest("digest-fresh", row.workspaceId, briefPayload(row.selfId, row.offId, "sig-fresh"));
    await env.DB.prepare(
      `INSERT INTO send_attempt (
         id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at
       ) VALUES (?, ?, ?, 'digest-fresh', ?, 'pending', ?)`,
    )
      .bind("attempt-stale", row.workspaceId, row.targetId, `digest:digest-fresh:${row.targetId}`, "2026-09-22T10:00:00.000Z")
      .run();
    const jobs: unknown[] = [];
    const enqueued = await sweepStuckSends(env.DB, {
      async send(message) {
        jobs.push(message);
      },
    }, NOW);
    expect(enqueued).toBe(2);
    expect(jobs).toContainEqual({ digest_id: "digest-old" });
    expect(jobs).toContainEqual({ digest_id: "digest-fresh" });
  });

  it("writes an in-app alert when the last attempt fails", async () => {
    const row = await seed("alert");
    const digestId = "digest-alert";
    await insertDigest(digestId, row.workspaceId, briefPayload(row.selfId, row.offId, "sig-alert"));
    const retried: string[] = [];
    await handleSendQueue(
      {
        messages: [
          {
            body: { digest_id: digestId },
            attempts: 5,
            ack() {
              retried.push("ack");
            },
            retry() {
              retried.push("retry");
            },
          },
        ],
      },
      {
        DB: env.DB,
        EMAIL: {
          async send() {
            throw new Error("email service rejected the message");
          },
        },
      },
      NOW,
    );
    expect(retried).toEqual(["retry"]);
    const alert = await env.DB.prepare(`SELECT title, body FROM alert WHERE id = ?`)
      .bind(`undelivered:${digestId}`)
      .first<{ title: string; body: string }>();
    expect(alert?.title).toBe("We could not send your brief");
    expect(alert?.body).toContain("email service rejected the message");
    const digest = await env.DB.prepare(`SELECT status FROM digest WHERE id = ?`)
      .bind(digestId)
      .first<{ status: string }>();
    expect(digest?.status).toBe("failed");
  });

  it("turns the one-click token into a suppression row", async () => {
    const row = await seed("unsub");
    expect(await suppressToken(row.token, NOW)).toBe("suppressed");
    expect(await suppressToken("missing-token", NOW)).toBe("missing");
    const stored = await env.DB.prepare(`SELECT reason FROM email_suppression WHERE address = ?`)
      .bind(row.address)
      .first<{ reason: string }>();
    expect(stored?.reason).toBe("unsubscribe");
    await insertDigest("digest-unsub", row.workspaceId, briefPayload(row.selfId, row.offId, "sig-unsub"));
    const box = mailbox();
    const result = await deliver(env.DB, box.email, { digest_id: "digest-unsub" }, NOW);
    expect(result.outcome).toBe("suppressed");
    expect(box.messages).toHaveLength(0);
  });
});
