import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readFewRivals } from "../../app/lib/data/rival_nudge.server";
import { sendRivalNudges } from "../../workers/delivery/rival-nudge";

const lookup = { tester: false as boolean | null };
const isTester = () => Promise.resolve(lookup.tester);

const USER = "user-nudge";
const WS = "ws-nudge";
const TARGET = "nudge@0509.io";
const NOW = new Date("2026-10-13T12:00:00.000Z");

const envWith = (sent: EmailMessageBuilder[]): Env =>
  ({
    ...env,
    EMAIL: {
      send(message: EmailMessageBuilder) {
        sent.push(message);
        return Promise.resolve({} as EmailSendResult);
      },
    },
  }) as Env;

const rival = (n: number, state = "on") =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
     VALUES (?1, ?2, 'competitor', ?3, ?4, '{}', 'manual', ?5, '2026-10-09T09:00:00Z')`,
  ).bind(`ent-n${String(n)}`, WS, `r${String(n)}.example`, `Rival ${String(n)}`, state);

const seed = (createdAt: string) =>
  env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Nudge', ?, 1, ?3, ?3)`,
    ).bind(USER, TARGET, createdAt),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Nudge', ?, 'UTC', 1, 8, ?)`,
    ).bind(WS, USER, createdAt),
    env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
       VALUES ('plan-nudge', ?, 'starter', 'active', 'cus_1', 'sub_1', '2026-10-20T00:00:00Z', 1, ?)`,
    ).bind(WS, createdAt),
    env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`),
    env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES ('target-nudge', ?, 'chan-email', ?, 1, ?)`,
    ).bind(WS, TARGET, createdAt),
  ]);

describe("add-a-rival nudge", () => {
  beforeEach(async () => {
    lookup.tester = false;
    for (const table of [
      "send_attempt",
      "email_suppression",
      "plan",
      "entity",
      "send_target",
      "channel",
      "workspace",
    ]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
  });

  it("emails a workspace with one rival once, after day 3", async () => {
    await seed("2026-10-08T10:00:00Z");
    await env.DB.batch([rival(1)]);
    const sent: EmailMessageBuilder[] = [];

    expect(await sendRivalNudges(envWith(sent), NOW, isTester)).toBe(1);
    expect(await sendRivalNudges(envWith(sent), new Date("2026-10-14T12:00:00.000Z"), isTester)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(TARGET);
    expect(sent[0]?.subject).toBe("Your brief compares you with one rival so far");
    expect(sent[0]?.text).toContain("You are watching Rival 1");
    expect(sent[0]?.headers?.["List-Unsubscribe"]).toContain("?type=brief");
  });

  it("follows the brief switch: an alerts-only stop still gets it", async () => {
    await seed("2026-10-08T10:00:00Z");
    await env.DB.batch([rival(1)]);
    await env.DB.prepare(
      `INSERT INTO email_suppression (address, reason, created_at, stops_brief, stops_alerts) VALUES (?, 'unsubscribed', '2026-10-10', 0, 1)`,
    )
      .bind(TARGET)
      .run();
    expect(await sendRivalNudges(envWith([]), NOW, isTester)).toBe(1);
  });

  it.each([
    ["two rivals", "2026-10-08T10:00:00Z", 2],
    ["a workspace younger than three days", "2026-10-11T10:00:00Z", 1],
    ["a workspace older than two weeks", "2026-09-20T10:00:00Z", 1],
  ])("sends nothing for %s", async (_name, createdAt, rivals) => {
    await seed(createdAt);
    await env.DB.batch(Array.from({ length: rivals }, (_, index) => rival(index + 1)));
    const sent: EmailMessageBuilder[] = [];

    expect(await sendRivalNudges(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("holds the email while a day-4 trial recap is due within a day, then sends it", async () => {
    await seed("2026-10-08T10:00:00Z");
    await env.DB.batch([rival(1)]);
    await env.DB.exec("UPDATE plan SET current_period_end = '2026-10-17T00:00:00Z'");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendRivalNudges(envWith(sent), NOW, isTester)).toBe(0);
    expect(await sendRivalNudges(envWith(sent), new Date("2026-10-15T12:00:00.000Z"), isTester)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("counts a switched-off rival as not watched", async () => {
    await seed("2026-10-08T10:00:00Z");
    await env.DB.batch([rival(1), rival(2, "off")]);
    expect(await sendRivalNudges(envWith([]), NOW, isTester)).toBe(1);
  });

  it("skips a suppressed address and a tester subscription", async () => {
    await seed("2026-10-08T10:00:00Z");
    await env.DB.batch([rival(1)]);
    await env.DB.prepare(
      `INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'unsubscribed', '2026-10-10')`,
    )
      .bind(TARGET)
      .run();
    expect(await sendRivalNudges(envWith([]), NOW, isTester)).toBe(0);
    await env.DB.exec("DELETE FROM email_suppression");
    lookup.tester = true;
    expect(await sendRivalNudges(envWith([]), NOW, isTester)).toBe(0);
  });

  it("tells Home how many rivals there are only when there are fewer than two and the workspace is 3+ days old", async () => {
    await seed("2026-10-08T10:00:00Z");
    await env.DB.batch([rival(1)]);
    expect(await readFewRivals(env.DB, WS, NOW)).toBe(1);
    expect(await readFewRivals(env.DB, WS, new Date("2026-10-09T12:00:00.000Z"))).toBeNull();
    await env.DB.batch([rival(2)]);
    expect(await readFewRivals(env.DB, WS, NOW)).toBeNull();
    expect(await readFewRivals(env.DB, "ws-other", NOW)).toBeNull();
  });
});
