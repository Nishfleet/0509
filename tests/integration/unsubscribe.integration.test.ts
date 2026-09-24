import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { unsubscribe } from "../../app/lib/unsubscribe.server";
import { deliver } from "../../workers/delivery/consumer";

interface Recorder {
  sent: EmailMessageBuilder[];
}

const recorder = (): Recorder => ({ sent: [] });

const bindingFor = (rec: Recorder): SendEmail => ({
  send(message: EmailMessageBuilder) {
    rec.sent.push(message);
    return Promise.resolve({} as EmailSendResult);
  },
});

const TOKEN = "a".repeat(64);
const UNKNOWN_TOKEN = "b".repeat(64);
const WS = "ws-unsubscribe";
const USER = "user-unsubscribe";
const CHANNEL = "chan-email";
const TARGET_ID = "reader-target";
const ADDRESS = "reader@0509.io";

const seed = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Reader', ?, 1, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
  )
    .bind(USER, ADDRESS)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Unsubscribe', ?, 'UTC', 1, 8, '2026-09-22T00:00:00Z')`,
  )
    .bind(WS, USER)
    .run();
  await env.DB.prepare(
    `INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`,
  )
    .bind(CHANNEL)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_target
       (id, workspace_id, channel_id, target_value, is_verified, unsubscribe_token, created_at)
     VALUES (?, ?, ?, ?, 1, ?, '2026-09-22T00:00:01Z')`,
  )
    .bind(TARGET_ID, WS, CHANNEL, ADDRESS, TOKEN)
    .run();
};

const seedDigest = async () => {
  await env.DB.prepare(
    `INSERT INTO digest
       (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
     VALUES ('digest-unsubscribe', ?, 'weekly', '2026-09-15', '2026-09-22', 'pending', 'You are #2 of 9 this week', ?, NULL)`,
  )
    .bind(WS, JSON.stringify({ text: "brief" }))
    .run();
};

interface SuppressionRow {
  address: string;
  reason: string;
  created_at: string;
}

const suppressionRows = async (): Promise<SuppressionRow[]> =>
  (
    await env.DB.prepare(
      `SELECT address, reason, created_at FROM email_suppression ORDER BY created_at ASC`,
    ).all<SuppressionRow>()
  ).results ?? [];

const attemptCount = async (): Promise<number> => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM send_attempt`).first<{ n: number }>();
  return row?.n ?? 0;
};

describe("one-click unsubscribe (0509#4358, 0509#4593)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.exec("DELETE FROM email_suppression");
    await env.DB.exec("DELETE FROM digest");
    await env.DB.exec("DELETE FROM send_target");
    await env.DB.exec("DELETE FROM channel");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await seed();
  });

  it("(a) suppresses the address behind a valid token", async () => {
    await unsubscribe(TOKEN);

    const rows = await suppressionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe(ADDRESS);
    expect(rows[0].reason).toBe("unsubscribed");
    expect(rows[0].created_at).not.toBeNull();
  });

  it("(b) keeps one row and the first created_at on a second click", async () => {
    await unsubscribe(TOKEN);
    const first = await suppressionRows();

    await unsubscribe(TOKEN);
    const rows = await suppressionRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].created_at).toBe(first[0].created_at);
  });

  it("(c) writes nothing for unknown and missing tokens", async () => {
    await unsubscribe(UNKNOWN_TOKEN);
    await unsubscribe(undefined);

    expect(await suppressionRows()).toHaveLength(0);
  });

  it("(d) makes the next send suppressed with no attempt row", async () => {
    await unsubscribe(TOKEN);
    await seedDigest();

    const rec = recorder();
    const result = await deliver({ ...env, EMAIL: bindingFor(rec) } as Env, {
      digest_id: "digest-unsubscribe",
    });

    expect(result.outcome).toBe("suppressed");
    expect(result.attempt_id).toBeNull();
    expect(rec.sent).toHaveLength(0);
    expect(await attemptCount()).toBe(0);
  });
});
