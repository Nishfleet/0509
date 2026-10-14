import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  isAddressSuppressed,
  isUnsubscribeTokenKnown,
  readMailKinds,
  writeMailKinds,
} from "../../app/lib/data/email_suppression.server";
import { unsubscribe } from "../../app/lib/unsubscribe.server";
import { deliver } from "../../workers/delivery/consumer";

interface Recorder {
  sent: EmailMessageBuilder[];
}

const recorder = (): Recorder => ({ sent: [] });

const bindingFor = (rec: Recorder): SendEmail => ({
  send(message: EmailMessage | EmailMessageBuilder) {
    rec.sent.push(message as EmailMessageBuilder);
    return Promise.resolve({ messageId: "unused" });
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
    "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?, ?, 'scout', 'trialing', '2026-09-22T00:00:00Z')",
  )
    .bind(`plan-${WS}`, WS)
    .run();
  await env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`)
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

describe("one-click unsubscribe (0509#4358, 0509#4593, 0509#5761)", () => {
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

  it("(a) reports unsubscribed and suppresses the address behind a valid token", async () => {
    const outcome = await unsubscribe(TOKEN, "all");

    expect(outcome).toBe("unsubscribed");
    const rows = await suppressionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe(ADDRESS);
    expect(rows[0].reason).toBe("unsubscribed");
    expect(rows[0].created_at).not.toBeNull();
  });

  it("(b) keeps one row and the first created_at on a second click", async () => {
    expect(await unsubscribe(TOKEN, "all")).toBe("unsubscribed");
    const first = await suppressionRows();

    expect(await unsubscribe(TOKEN, "all")).toBe("unsubscribed");
    const rows = await suppressionRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].created_at).toBe(first[0].created_at);
  });

  it("(c) says invalid_token and writes nothing for unknown and missing tokens", async () => {
    expect(await unsubscribe(UNKNOWN_TOKEN, "all")).toBe("invalid_token");
    expect(await unsubscribe(undefined, "all")).toBe("invalid_token");
    expect(await unsubscribe("", "all")).toBe("invalid_token");

    expect(await suppressionRows()).toHaveLength(0);
  });

  it("(d) makes the next send suppressed with no attempt row", async () => {
    await unsubscribe(TOKEN, "all");
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

  it("(e) knows only a token a send_target still holds (0509#5761)", async () => {
    expect(await isUnsubscribeTokenKnown(TOKEN)).toBe(true);
    expect(await isUnsubscribeTokenKnown(UNKNOWN_TOKEN)).toBe(false);

    await env.DB.prepare(`UPDATE send_target SET unsubscribe_token = NULL WHERE id = ?`).bind(TARGET_ID).run();

    expect(await isUnsubscribeTokenKnown(TOKEN)).toBe(false);
    expect(await unsubscribe(TOKEN, "all")).toBe("invalid_token");
    expect(await suppressionRows()).toHaveLength(0);
  });

  it("(f) stops only the brief when the link was the brief's, and alerts keep going", async () => {
    expect(await unsubscribe(TOKEN, "brief")).toBe("unsubscribed");

    expect(await isAddressSuppressed(ADDRESS, "brief")).toBe(true);
    expect(await isAddressSuppressed(ADDRESS, "alerts")).toBe(false);
    expect(await isAddressSuppressed(ADDRESS, "all")).toBe(false);
    expect(await readMailKinds(ADDRESS)).toEqual({ brief: false, alerts: true });
  });

  it("(g) stops everything when the second step asks for it, keeping one row", async () => {
    await unsubscribe(TOKEN, "alerts");
    expect(await isAddressSuppressed(ADDRESS, "brief")).toBe(false);

    await unsubscribe(TOKEN, "all");

    expect(await isAddressSuppressed(ADDRESS, "brief")).toBe(true);
    expect(await isAddressSuppressed(ADDRESS, "alerts")).toBe(true);
    expect(await suppressionRows()).toHaveLength(1);
  });

  it("(h) lets Settings switch each kind back on, and drops the row once both are on", async () => {
    await unsubscribe(TOKEN, "all");

    await writeMailKinds(ADDRESS, { brief: true, alerts: false });
    expect(await readMailKinds(ADDRESS)).toEqual({ brief: true, alerts: false });
    expect(await isAddressSuppressed(ADDRESS, "alerts")).toBe(true);
    expect(await isAddressSuppressed(ADDRESS, "brief")).toBe(false);

    await writeMailKinds(ADDRESS, { brief: true, alerts: true });
    expect(await suppressionRows()).toHaveLength(0);
  });

  it("(i) treats a row written before the kinds existed as stopping both", async () => {
    await env.DB.prepare(`INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'unsubscribed', ?)`)
      .bind("older@0509.io", "2026-09-01T00:00:00Z")
      .run();

    expect(await readMailKinds("older@0509.io")).toEqual({ brief: false, alerts: false });
    expect(await isAddressSuppressed("older@0509.io", "all")).toBe(true);
  });

  it("(j) still tries the brief for someone who stopped only alerts", async () => {
    await unsubscribe(TOKEN, "alerts");
    await seedDigest();

    const rec = recorder();
    const result = await deliver({ ...env, EMAIL: bindingFor(rec) } as Env, {
      digest_id: "digest-unsubscribe",
    });

    expect(result.outcome).not.toBe("suppressed");
    expect(result.attempt_id).not.toBeNull();
  });
});
