import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { deliver, type DeliveryMessage } from "../../workers/delivery/consumer";
import { quotedSignalIds } from "../../workers/delivery/record";

// Engine 7: a sent brief writes one signal_delivery row per quoted item in the
// same D1 batch as the send resolution. The UNIQUE (signal_id, channel_id)
// constraint is the "delivered once" mechanism; a later brief that quotes the
// same signal inserts nothing.

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

const WS = "ws-once";
const CHANNEL = "chan-email";
const TARGET = "reader@0509.io";
const TARGET_ID = "reader-target";

const seed = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES ('user-one', 'Reader', 'reader@0509.io', 1, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Once', 'user-one', 'UTC', 1, 8, '2026-09-22T00:00:00Z')`,
  )
    .bind(WS)
    .run();
  await env.DB.prepare(
    `INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`,
  )
    .bind(CHANNEL)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
     VALUES (?, ?, ?, ?, 1, '2026-09-22T00:00:01Z')`,
  )
    .bind(TARGET_ID, WS, CHANNEL, TARGET)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, created_at)
     VALUES ('ent-1', ?, 'competitor', 'kindred.example', '2026-09-22T00:00:00Z')`,
  )
    .bind(WS)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key)
     VALUES ('src-1', 'site:once', 'site', 'web', 'once')`,
  ).run();
  for (const id of ["sig-a", "sig-b", "sig-c"]) {
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at)
       VALUES (?, ?, 'ent-1', 'src-1', 'ad', ?, '2026-09-16T00:00:00Z')`,
    )
      .bind(id, WS, id)
      .run();
  }
};

const seedDigest = async (
  id: string,
  payload: Record<string, unknown>,
  periodStart = "2026-09-15",
  periodEnd = "2026-09-22",
) => {
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
     VALUES (?, ?, 'weekly', ?, ?, 'pending', 'You are #2 of 9 this week', ?, NULL)`,
  )
    .bind(id, WS, periodStart, periodEnd, JSON.stringify(payload))
    .run();
};

interface DeliveryRow {
  signal_id: string;
  channel_id: string;
  send_attempt_id: string | null;
}

const readDeliveries = async (): Promise<DeliveryRow[]> =>
  (
    await env.DB.prepare(
      `SELECT signal_id, channel_id, send_attempt_id FROM signal_delivery ORDER BY signal_id ASC`,
    ).all<DeliveryRow>()
  ).results ?? [];

const message = (digestId: string): DeliveryMessage => ({ digest_id: digestId });

const envWith = (email: SendEmail): Env => ({ ...env, EMAIL: email }) as Env;

describe("delivered once (0509#4368)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM signal_delivery");
    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.exec("DELETE FROM digest");
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM source");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM send_target");
    await env.DB.exec("DELETE FROM channel");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await seed();
  });

  it("(a) writes one signal_delivery row per quoted item when the brief is sent", async () => {
    const rec = recorder();
    await seedDigest("digest-w1", {
      text: "w1",
      read_this_first: [
        { signal_id: "sig-a", jev_reason: "r" },
        { signal_id: "sig-b", jev_reason: "r" },
      ],
    });

    const result = await deliver(envWith(bindingFor(rec)), message("digest-w1"));

    expect(result.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(1);
    const rows = await readDeliveries();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.channel_id === "chan-email")).toBe(true);
    expect(rows.every((row) => row.send_attempt_id === result.attempt_id)).toBe(true);
    expect(rows.map((row) => row.signal_id).sort()).toEqual(["sig-a", "sig-b"]);
  });

  it("(b) a later brief quoting the same signal adds no second row", async () => {
    const rec = recorder();
    await seedDigest("digest-w1", {
      text: "w1",
      read_this_first: [
        { signal_id: "sig-a", jev_reason: "r" },
        { signal_id: "sig-b", jev_reason: "r" },
      ],
    });
    const week1 = await deliver(envWith(bindingFor(rec)), message("digest-w1"));
    expect(week1.outcome).toBe("sent");

    await env.DB.prepare(
      `UPDATE signal SET last_seen_at = '2026-09-23T00:00:00Z' WHERE id = 'sig-a'`,
    ).run();
    await seedDigest(
      "digest-w2",
      {
        text: "w2",
        read_this_first: [
          { signal_id: "sig-a", jev_reason: "r" },
          { signal_id: "sig-c", jev_reason: "r" },
        ],
      },
      "2026-09-22",
      "2026-09-29",
    );

    const week2 = await deliver(envWith(bindingFor(rec)), message("digest-w2"));

    expect(week2.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(2);
    const rows = await readDeliveries();
    expect(rows).toHaveLength(3);
    const again = rows.find((row) => row.signal_id === "sig-a");
    expect(again?.send_attempt_id).toBe(week1.attempt_id);
    expect(rows.find((row) => row.signal_id === "sig-c")?.send_attempt_id).toBe(week2.attempt_id);
  });

  it("(c) a brief with no quoted items sends and writes no delivery rows", async () => {
    const rec = recorder();
    await seedDigest("digest-empty", { text: "no picks" });

    const result = await deliver(envWith(bindingFor(rec)), message("digest-empty"));

    expect(result.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(1);
    expect(await readDeliveries()).toHaveLength(0);
  });

  it("(d) quotedSignalIds drops bad JSON and keeps the first non-empty signal_id", () => {
    expect(quotedSignalIds("<<bad")).toEqual([]);
    expect(
      quotedSignalIds(
        JSON.stringify({
          read_this_first: [{ signal_id: "x" }, { signal_id: "x" }, { jev_reason: "r" }],
        }),
      ),
    ).toEqual(["x"]);
  });
});
