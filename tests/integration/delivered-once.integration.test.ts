// 0509#4063
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BriefPayload } from "../../app/lib/brief-payload";
import { deliver } from "../../workers/delivery/consumer";
import { composeBrief } from "../../workers/standing/compose-brief";
import { judgeWeek, READ_THIS_FIRST } from "../../workers/standing/read-this-first";

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
const FRIDAY = { timezone: "UTC", weekday: 5, hour: 8 };
const WEEK_1 = {
  startsAt: new Date("2026-09-14T08:00:00.000Z"),
  closesAt: new Date("2026-09-21T08:00:00.000Z"),
};
const WEEK_2 = {
  startsAt: new Date("2026-09-18T08:00:00.000Z"),
  closesAt: new Date("2026-09-25T08:00:00.000Z"),
};

const seedDigest = async (
  id: string,
  payload: BriefPayload,
  periodStart: string,
  periodEnd: string,
) => {
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
     VALUES (?, ?, 'weekly', ?, ?, 'pending', NULL, ?, NULL)`,
  )
    .bind(id, WS, periodStart, periodEnd, JSON.stringify(payload))
    .run();
};

interface DeliveryRow {
  id: string;
  workspace_id: string;
  signal_id: string;
  channel_id: string;
  send_attempt_id: string | null;
  delivered_at: string;
}

const deliveryRow = (attemptId: string | null, signalId: string, deliveredAt: string) =>
  env.DB.prepare(
    `INSERT INTO signal_delivery (id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at)
     VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5)`,
  ).bind(WS, signalId, CHANNEL, attemptId, deliveredAt);

const deliveries = async (): Promise<DeliveryRow[]> =>
  (
    await env.DB.prepare(
      "SELECT id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at FROM signal_delivery ORDER BY signal_id",
    ).all<DeliveryRow>()
  ).results ?? [];

const stubJev = () => {
  const run = vi.fn(async () => ({
    answers: { [READ_THIS_FIRST.id]: { type: "noul", noul: 0.8 } },
  }));
  Reflect.set(env, "AI", { run });
  return run;
};

const weekOne = async () => {
  const payload = await composeBrief(env.DB, {
    workspaceId: WS,
    schedule: MONDAY,
    week: WEEK_1,
    readThisFirst: { picks: [SIG_A, SIG_B], judged: 2 },
  });
  await seedDigest("digest-w1", payload, "2026-09-14", "2026-09-21");
  return deliver(envWith(bindingFor(recorder())), { digest_id: "digest-w1" });
};

describe("delivered once across weeks (0509#4063)", () => {
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
    await env.DB.exec(`DELETE FROM source WHERE id = 'src-once'`);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, 1, ?4, ?4)`,
      ).bind(USER, "Once Test", "once@0509.io", "2026-09-14T00:00:00Z"),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?1, ?2, ?3, 'UTC', 1, 8, ?4)`,
      ).bind(WS, "Once Test", USER, "2026-09-14T00:00:00Z"),
      env.DB.prepare(
        `INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?1, 'email', 1, '{}')`,
      ).bind(CHANNEL),
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      ).bind(TARGET_ID, WS, CHANNEL, "once@0509.io", "2026-09-14T00:00:00Z"),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
         VALUES (?1, ?2, 'competitor', 'rival.example', 'Rival', 'on', ?3)`,
      ).bind(RIVAL, WS, "2026-09-14T00:00:00Z"),
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES (?1, 'once:mentions', 'mentions', 'once', 'once', 'official_api')`,
      ).bind(SOURCE),
      ...[
        [SIG_A, "Rival launch A", "hash-sig-a"],
        [SIG_B, "Rival price B", "hash-sig-b"],
        [SIG_C, "Rival hire C", "hash-sig-c"],
      ].flatMap(([id, title, urlHash]) => [
        env.DB.prepare(
          `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, dedup_key, observed_at, is_tombstoned)
           VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?6, ?7, ?8, ?9, 0)`,
        ).bind(id, WS, RIVAL, SOURCE, title, `https://rival.example/${id}`, urlHash, id, OBSERVED),
        env.DB.prepare(
          `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at)
           VALUES (?1, ?2, 'noteworthy_change', ?3, ?4, 0.95, ?5)`,
        ).bind(`jv-${id}`, WS, `ih-${id}`, id, "2026-09-18T11:00:00.000Z"),
      ]),
    ]);
  });

  afterEach(() => {
    Reflect.deleteProperty(env, "AI");
  });

  it("the next week's brief skips a delivered signal even when the windows overlap and a re-crawl moved last_seen_at", async () => {
    stubJev();

    const weekTwoInput = {
      workspaceId: WS,
      startsAt: WEEK_2.startsAt.toISOString(),
      closesAt: WEEK_2.closesAt.toISOString(),
      decidedAt: "2026-09-25T08:05:00.000Z",
    };
    const control = await judgeWeek(env.DB, weekTwoInput);
    expect([...control.picks].sort()).toEqual([SIG_A, SIG_B, SIG_C]);

    const week1 = await weekOne();
    expect(week1.outcome).toBe("sent");

    // Stand-in for the signal_delivery rows the send-resolution batch writes;
    // that writer is the pending #5548 re-cut, so the fixture inserts them
    // directly. The tail asserts these two rows.
    await env.DB.batch([
      deliveryRow(week1.attempt_id, SIG_A, "2026-09-21T08:00:00.000Z"),
      deliveryRow(week1.attempt_id, SIG_B, "2026-09-21T08:00:00.000Z"),
    ]);

    await env.DB.prepare(
      "UPDATE signal SET last_seen_at = '2026-09-24T00:00:00.000Z' WHERE id IN (?1, ?2)",
    )
      .bind(SIG_A, SIG_B)
      .run();

    const judged = await judgeWeek(env.DB, weekTwoInput);
    expect(judged).toEqual({ picks: [SIG_C], judged: 1 });

    const payload = await composeBrief(env.DB, {
      workspaceId: WS,
      schedule: FRIDAY,
      week: WEEK_2,
      readThisFirst: judged,
    });
    expect(payload.read_this_first.map((mark) => mark.signal_id)).toEqual([SIG_C]);

    const rows = await deliveries();
    expect(rows.map((row) => row.signal_id)).toEqual([SIG_A, SIG_B]);
  });
});
