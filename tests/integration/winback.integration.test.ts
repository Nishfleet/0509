import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { sendWinbacks } from "../../workers/delivery/winback";

const lookup = { tester: false as boolean | null };
const isTester = () => Promise.resolve(lookup.tester);

const USER = "user-winback";
const WS = "ws-winback";
const TARGET = "winback@0509.io";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const AWAY = "2026-09-10T08:00:00Z";

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

const seedPlan = (trialing = 0) =>
  env.DB.prepare(
    `INSERT OR REPLACE INTO plan
       (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
     VALUES ('plan-winback', ?, 'starter', 'active', 'cus_1', 'sub_1', '2026-11-01T00:00:00Z', ?, '2026-09-01T10:00:00Z')`,
  )
    .bind(WS, trialing)
    .run();

const seedSeen = (lastSeen: string | null) =>
  env.DB.prepare("UPDATE workspace SET last_seen_at = ? WHERE id = ?").bind(lastSeen, WS).run();

const seedChange = (id: string, title: string, observedAt: string) =>
  env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, aspect, dedup_key, observed_at)
     VALUES (?1, ?2, 'ent-r1', 'src-winback', 'change', ?3, 'pricing', ?1, ?4)`,
  )
    .bind(id, WS, title, observedAt)
    .run();

describe("win-back email", () => {
  beforeEach(async () => {
    lookup.tester = false;
    for (const table of [
      "signal",
      "send_attempt",
      "email_suppression",
      "plan",
      "entity",
      "send_target",
      "channel",
      "workspace",
      "source",
    ]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, 'Winback', ?, 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      ).bind(USER, TARGET),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Winback', ?, 'UTC', 1, 8, '2026-10-01T00:00:00Z')`,
      ).bind(WS, USER),
      env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`),
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
         VALUES ('target-winback', ?, 'chan-email', ?, 1, '2026-10-01T00:00:01Z')`,
      ).bind(WS, TARGET),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
         VALUES ('ent-r1', ?, 'competitor', 'acme.com', 'Acme', '{}', 'manual', 'on', '2026-10-09T09:00:00Z')`,
      ).bind(WS),
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES ('src-winback', 'winback-site', 'site', 'web', 'site', 'scraped_page')`,
      ),
    ]);
  });

  it("writes once to a paying workspace that has been away, counting what it missed", async () => {
    await seedPlan();
    await seedSeen(AWAY);
    await seedChange("sig-1", "Pricing page now lists a free tier", "2026-09-20T10:00:00Z");
    await seedChange("sig-2", "Homepage headline changed", "2026-10-12T10:00:00Z");
    await seedChange("sig-old", "Before they left", "2026-09-01T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWinbacks(envWith(sent), NOW, isTester)).toBe(1);
    expect(await sendWinbacks(envWith(sent), new Date("2026-10-14T13:00:00.000Z"), isTester)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(TARGET);
    expect(sent[0]?.text).toContain("caught 2 changes");
    expect(sent[0]?.text).toContain("Most recent: Acme, Homepage headline changed");
  });

  it("writes again only after a new absence", async () => {
    await seedPlan();
    await seedSeen(AWAY);
    await seedChange("sig-1", "One", "2026-09-20T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];
    await sendWinbacks(envWith(sent), NOW, isTester);

    await seedSeen("2026-10-14T08:00:00Z");
    await seedChange("sig-2", "Two", "2026-10-20T10:00:00Z");
    expect(await sendWinbacks(envWith(sent), new Date("2026-10-30T12:00:00.000Z"), isTester)).toBe(0);
    expect(await sendWinbacks(envWith(sent), new Date("2026-11-10T12:00:00.000Z"), isTester)).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it("writes to the owner, never an older confirmed teammate", async () => {
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role)
       VALUES ('mate-old', ?, 'chan-email', 'mate@0509.io', 1, '2000-01-01T00:00:00Z', 'teammate')`,
    )
      .bind(WS)
      .run();
    await seedPlan();
    await seedSeen(AWAY);
    await seedChange("sig-1", "Something", "2026-09-20T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWinbacks(envWith(sent), NOW, isTester)).toBe(1);
    expect(sent.map((mail) => mail.to)).toEqual([TARGET]);
  });

  it("counts only changes on rivals that are switched on, and carries an unsubscribe link", async () => {
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
       VALUES ('ent-off', ?, 'competitor', 'off.com', 'Off', '{}', 'manual', 'off', '2026-09-01T09:00:00Z')`,
    )
      .bind(WS)
      .run();
    await seedPlan();
    await seedSeen(AWAY);
    await seedChange("sig-1", "Rival change", "2026-09-20T10:00:00Z");
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, aspect, dedup_key, observed_at)
       VALUES ('sig-off', ?, 'ent-off', 'src-winback', 'change', 'Not live', 'pricing', 'sig-off', '2026-09-21T10:00:00Z')`,
    )
      .bind(WS)
      .run();
    const sent: EmailMessageBuilder[] = [];

    await sendWinbacks(envWith(sent), NOW, isTester);

    expect(sent[0]?.text).toContain("caught 1 change across");
    expect(sent[0]?.text).toMatch(/Unsubscribe: https:\/\/0509\.io\/u\/[0-9a-f]{64}/);
    expect(sent[0]?.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/0509\.io\/u\/[0-9a-f]{64}\?type=all>$/);
  });

  it("never mentions money or the plan", async () => {
    await seedPlan();
    await seedSeen(AWAY);
    await seedChange("sig-1", "Pricing page now lists a free tier", "2026-09-20T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    await sendWinbacks(envWith(sent), NOW, isTester);

    expect(`${sent[0]?.subject ?? ""} ${(sent[0]?.text ?? "").split("Choose which alerts")[0]}`).not.toMatch(
      /trial|charge|billed|billing|cancel|card|€|\bplan\b|renew|subscri/i,
    );
  });

  it.each([
    ["someone who opened it last week", "2026-10-06T08:00:00Z", 0, "2026-10-10T10:00:00Z"],
    ["a workspace never seen", null, 0, "2026-10-10T10:00:00Z"],
    ["an absence with nothing new", AWAY, 0, "2026-09-01T10:00:00Z"],
    ["someone still on a trial", AWAY, 1, "2026-09-20T10:00:00Z"],
  ])("sends nothing for %s", async (_name, seen, trialing, changeAt) => {
    await seedPlan(trialing);
    await seedSeen(seen);
    await seedChange("sig-1", "Something", changeAt);
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWinbacks(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["a tester subscription", true],
    ["a subscription Dodo cannot confirm", null],
  ])("sends nothing for %s", async (_name, tester) => {
    lookup.tester = tester;
    await seedPlan();
    await seedSeen(AWAY);
    await seedChange("sig-1", "Something", "2026-09-20T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWinbacks(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
