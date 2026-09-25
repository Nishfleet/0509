// 0509#4063: a sent brief writes one signal_delivery row per quoted signal in the resolution batch.

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { deliver } from "../../workers/delivery/consumer";
import { composeBrief } from "../../workers/standing/compose-brief";
import { insertSignalDeliveries } from "../../app/lib/data/signal_delivery.server";

interface Recorder {
  sent: EmailMessageBuilder[];
  fail: Error | null;
}

const recorder = (): Recorder => ({ sent: [], fail: null });

const bindingFor = (rec: Recorder): SendEmail => ({
  send(message: EmailMessageBuilder) {
    if (rec.fail) throw rec.fail;
    rec.sent.push(message);
    return Promise.resolve({} as EmailSendResult);
  },
});

const envWith = (email: SendEmail): Env => ({ ...env, EMAIL: email }) as Env;

const WS = "ws-once";
const USER = "user-once";
const CHANNEL = "chan-email";
const TARGET_ID = "target-once";
const SOURCE = "src-once";
const RIVAL = "ent-rival";
const SIG_A = "sig-a";
const SIG_B = "sig-b";
const SIG_C = "sig-c";
const OBSERVED = "2026-09-18T10:00:00.000Z";
const MONDAY = { timezone: "UTC", weekday: 1, hour: 8 };
const WEEK_1 = {
  startsAt: new Date("2026-09-14T08:00:00.000Z"),
  closesAt: new Date("2026-09-21T08:00:00.000Z"),
};

const seedDigest = async (
  id: string,
  payload: unknown,
  periodStart: string,
  periodEnd: string,
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
     VALUES (?, ?, 'weekly', ?, ?, 'pending', NULL, ?, NULL)`,
  )
    .bind(id, WS, periodStart, periodEnd, JSON.stringify(payload))
    .run();
};

const deliveries = async (): Promise<
  {
    id: string;
    workspace_id: string;
    signal_id: string;
    channel_id: string;
    send_attempt_id: string;
    delivered_at: string;
  }[]
> =>
  (
    await env.DB.prepare(
      `SELECT id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at
         FROM signal_delivery ORDER BY signal_id`,
    ).all<{
      id: string;
      workspace_id: string;
      signal_id: string;
      channel_id: string;
      send_attempt_id: string;
      delivered_at: string;
    }>()
  ).results ?? [];

const weekOne = async (rec: Recorder = recorder()) => {
  const payload = await composeBrief(env.DB, {
    workspaceId: WS,
    schedule: MONDAY,
    week: WEEK_1,
    readThisFirst: { picks: [SIG_A, SIG_B], judged: 2 },
  });
  await seedDigest("digest-w1", payload, "2026-09-14", "2026-09-21");
  return deliver(envWith(bindingFor(rec)), { digest_id: "digest-w1" });
};

beforeEach(async () => {
  await env.DB.exec("DELETE FROM signal_delivery");
  await env.DB.exec("DELETE FROM send_attempt");
  await env.DB.exec("DELETE FROM digest");
  await env.DB.exec("DELETE FROM jev_verdict");
  await env.DB.exec("DELETE FROM signal");
  await env.DB.exec("DELETE FROM entity");
  await env.DB.exec("DELETE FROM send_target");
  await env.DB.exec("DELETE FROM channel");
  await env.DB.exec("DELETE FROM email_suppression");
  await env.DB.exec("DELETE FROM workspace");
  await env.DB.exec('DELETE FROM "user"');
  await env.DB.exec("DELETE FROM source WHERE id = 'src-once'");

  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Once', 'once@0509.io', 1, '2026-09-14T00:00:00Z', '2026-09-14T00:00:00Z')`,
  ).bind(USER).run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Once', ?, 'UTC', 1, 8, '2026-09-14T00:00:00Z')`,
  )
    .bind(WS, USER)
    .run();
  await env.DB.prepare(
    `INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`,
  )
    .bind(CHANNEL)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
     VALUES (?, ?, ?, ?, 1, '2026-09-14T00:00:00Z')`,
  )
    .bind(TARGET_ID, WS, CHANNEL, "once@0509.io")
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
     VALUES (?, ?, 'competitor', 'rival.example', 'Rival', 'on', '2026-09-14T00:00:00Z')`,
  )
    .bind(RIVAL, WS)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
     VALUES (?, 'once:mentions', 'mentions', 'once', 'once', 'official_api')`,
  )
    .bind(SOURCE)
    .run();

  for (const [id, title] of [
    [SIG_A, "Rival launch A"],
    [SIG_B, "Rival price B"],
    [SIG_C, "Rival hire C"],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, dedup_key, observed_at, is_tombstoned)
       VALUES (?, ?, ?, ?, 'mention', ?, ?, ?, ?, ?, ?, 0)`,
    )
      .bind(
        id,
        WS,
        RIVAL,
        SOURCE,
        title,
        `https://rival.example/${id}`,
        `https://rival.example/${id}`,
        `hash-${id}`,
        id,
        OBSERVED,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at)
       VALUES (?, ?, 'noteworthy_change', ?, ?, 0.95, '2026-09-18T11:00:00.000Z')`,
    )
      .bind(`verdict-${id}`, WS, `ih-${id}`, id)
      .run();
  }
});

describe("delivered once across weeks (0509#4063)", () => {
  it("a sent brief writes one signal_delivery row per quoted signal in the resolution batch", async () => {
    const rec = recorder();
    const result = await weekOne(rec);

    expect(result.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(1);

    const rows = await deliveries();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.signal_id)).toEqual([SIG_A, SIG_B]);
    for (const row of rows) {
      expect(row.workspace_id).toBe(WS);
      expect(row.channel_id).toBe(CHANNEL);
      expect(row.send_attempt_id).toBe(result.attempt_id);
    }

    const digest = await env.DB
      .prepare(`SELECT status, sent_at FROM digest WHERE id = 'digest-w1'`)
      .first<{ status: string; sent_at: string | null }>();
    expect(digest?.status).toBe("sent");
    expect(digest?.sent_at).not.toBeNull();
    expect(rows.every((row) => row.delivered_at === digest?.sent_at)).toBe(true);

    const attempt = await env.DB
      .prepare(`SELECT status, error FROM send_attempt WHERE id = ?`)
      .bind(result.attempt_id)
      .first<{ status: string; error: string | null }>();
    expect(attempt?.status).toBe("sent");
    expect(attempt?.error).toBeNull();
  });

  it("a second resolution of the same send adds nothing", async () => {
    const first = await weekOne();
    const snapshot = await deliveries();
    expect(snapshot).toHaveLength(2);

    const rec = recorder();
    const second = await deliver(envWith(bindingFor(rec)), { digest_id: "digest-w1" });
    expect(second.outcome).toBe("duplicate");
    expect(rec.sent).toHaveLength(0);

    await env.DB.batch([
      insertSignalDeliveries(env.DB, {
        workspaceId: WS,
        channelId: CHANNEL,
        sendAttemptId: first.attempt_id,
        deliveredAt: "2026-09-30T00:00:00.000Z",
        signalIds: [SIG_A, SIG_B, SIG_A],
      }),
    ]);

    expect(await deliveries()).toEqual(snapshot);
  });

  it("a quiet-week brief writes no rows", async () => {
    const payload = await composeBrief(env.DB, {
      workspaceId: WS,
      schedule: MONDAY,
      week: WEEK_1,
      readThisFirst: { picks: [], judged: 0 },
    });
    await seedDigest("digest-quiet", payload, "2026-09-14", "2026-09-21");
    const rec = recorder();
    const result = await deliver(envWith(bindingFor(rec)), { digest_id: "digest-quiet" });

    expect(result.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(1);
    expect(await deliveries()).toEqual([]);
  });

  it("a quoted signal deleted before the send is skipped and the send still resolves", async () => {
    const payload = await composeBrief(env.DB, {
      workspaceId: WS,
      schedule: MONDAY,
      week: WEEK_1,
      readThisFirst: { picks: [SIG_A, SIG_B], judged: 2 },
    });
    await seedDigest("digest-del", payload, "2026-09-14", "2026-09-21");
    await env.DB.exec("DELETE FROM signal WHERE id = 'sig-a'");

    const rec = recorder();
    const result = await deliver(envWith(bindingFor(rec)), { digest_id: "digest-del" });
    expect(result.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(1);

    const attempt = await env.DB
      .prepare(`SELECT status FROM send_attempt WHERE id = ?`)
      .bind(result.attempt_id)
      .first<{ status: string }>();
    expect(attempt?.status).toBe("sent");

    const digest = await env.DB
      .prepare(`SELECT status FROM digest WHERE id = 'digest-del'`)
      .first<{ status: string }>();
    expect(digest?.status).toBe("sent");

    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0].signal_id).toBe(SIG_B);
  });
});
