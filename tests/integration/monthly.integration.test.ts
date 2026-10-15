import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { expectSendRecord, PROVIDER_ID } from "./send-record";
import { sendMonthlies } from "../../workers/delivery/monthly";

const lookup = { tester: false as boolean | null };
const isTester = () => Promise.resolve(lookup.tester);

const USER = "user-monthly";
const WS = "ws-monthly";
const TARGET = "monthly@0509.io";
const NOW = new Date("2026-10-06T12:00:00.000Z");

const envWith = (sent: EmailMessageBuilder[]): Env =>
  ({
    ...env,
    EMAIL: {
      send(message: EmailMessageBuilder) {
        sent.push(message);
        return Promise.resolve({ messageId: PROVIDER_ID });
      },
    },
  }) as Env;

const seedPlan = (trialing = 0) =>
  env.DB.prepare(
    `INSERT OR REPLACE INTO plan
       (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
     VALUES ('plan-monthly', ?, 'starter', 'active', 'cus_1', 'sub_1', '2026-11-01T00:00:00Z', ?, '2026-08-01T10:00:00Z')`,
  )
    .bind(WS, trialing)
    .run();

const seedWorkspace = (lastSeen: string | null, pausedAt: string | null = null) =>
  env.DB.prepare("UPDATE workspace SET last_seen_at = ?, brief_paused_at = ? WHERE id = ?")
    .bind(lastSeen, pausedAt, WS)
    .run();

const seedChange = (id: string, title: string, observedAt: string) =>
  env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, aspect, dedup_key, observed_at)
     VALUES (?1, ?2, 'ent-r1', 'src-recap', 'change', ?3, 'pricing', ?1, ?4)`,
  )
    .bind(id, WS, title, observedAt)
    .run();

describe("trial recap email", () => {
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
         VALUES (?, 'Recap', ?, 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      ).bind(USER, TARGET),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Recap', ?, 'UTC', 1, 8, '2026-10-01T00:00:00Z')`,
      ).bind(WS, USER),
      env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`),
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
         VALUES ('target-recap', ?, 'chan-email', ?, 1, '2026-10-01T00:00:01Z')`,
      ).bind(WS, TARGET),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
         VALUES ('ent-r1', ?, 'competitor', 'acme.com', 'Acme', '{}', 'manual', 'on', '2026-10-09T09:00:00Z')`,
      ).bind(WS),
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES ('src-recap', 'recap-site', 'site', 'web', 'site', 'scraped_page')`,
      ),
    ]);
  });

  it("sends last month's count and the three most recent moves, once", async () => {
    await seedPlan();
    await seedWorkspace("2026-10-04T08:00:00Z");
    await seedChange("sig-1", "Pricing page now lists a free tier", "2026-09-03T10:00:00Z");
    await seedChange("sig-2", "Homepage headline changed", "2026-09-12T10:00:00Z");
    await seedChange("sig-3", "New careers page", "2026-09-20T10:00:00Z");
    await seedChange("sig-4", "Footer reworded", "2026-09-28T10:00:00Z");
    await seedChange("sig-aug", "Last month's news", "2026-08-30T10:00:00Z");
    await seedChange("sig-oct", "This month's news", "2026-10-02T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendMonthlies(envWith(sent), NOW, isTester)).toBe(1);
    expect(await sendMonthlies(envWith(sent), new Date("2026-10-07T12:00:00.000Z"), isTester)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(TARGET);
    expect(sent[0]?.text).toContain("In September we caught 4 changes");
    expect(sent[0]?.text).toContain("Acme, Footer reworded");
    expect(sent[0]?.text).toContain("Acme, New careers page");
    expect(sent[0]?.text).toContain("Acme, Homepage headline changed");
    expect(sent[0]?.text).not.toContain("Pricing page now lists");
    expect(sent[0]?.text).not.toContain("This month");
    await expectSendRecord("monthly", sent[0]?.subject);
  });

  it("sends again the next month", async () => {
    await seedPlan();
    await seedWorkspace("2026-11-03T08:00:00Z");
    await seedChange("sig-1", "One", "2026-09-03T10:00:00Z");
    await seedChange("sig-2", "Two", "2026-10-10T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendMonthlies(envWith(sent), NOW, isTester)).toBe(1);
    expect(await sendMonthlies(envWith(sent), new Date("2026-11-05T12:00:00.000Z"), isTester)).toBe(1);
    expect(sent[1]?.text).toContain("In October we caught 1 change");
  });

  it("writes to the owner, counts only live rivals, and carries an unsubscribe link", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role)
         VALUES ('mate-old', ?, 'chan-email', 'mate@0509.io', 1, '2000-01-01T00:00:00Z', 'teammate')`,
      ).bind(WS),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
         VALUES ('ent-off', ?, 'competitor', 'off.com', 'Off', '{}', 'manual', 'off', '2026-08-01T09:00:00Z')`,
      ).bind(WS),
      env.DB.prepare(
        `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, aspect, dedup_key, observed_at)
         VALUES ('sig-off', ?, 'ent-off', 'src-recap', 'change', 'Not live', 'pricing', 'sig-off', '2026-09-05T10:00:00Z')`,
      ).bind(WS),
    ]);
    await seedPlan();
    await seedWorkspace("2026-10-04T08:00:00Z");
    await seedChange("sig-1", "Rival change", "2026-09-03T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    await sendMonthlies(envWith(sent), NOW, isTester);

    expect(sent.map((mail) => mail.to)).toEqual([TARGET]);
    expect(sent[0]?.text).toContain("caught 1 change across");
    expect(sent[0]?.text).toMatch(/Unsubscribe: https:\/\/0509\.io\/u\/[0-9a-f]{64}/);
    expect(sent[0]?.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/0509\.io\/u\/[0-9a-f]{64}\?type=brief>$/);
  });

  it("follows the brief switch: an alerts-only stop still gets it, a brief stop does not", async () => {
    await seedPlan();
    await seedWorkspace("2026-10-04T08:00:00Z");
    await seedChange("sig-1", "Rival change", "2026-09-03T10:00:00Z");
    await env.DB.prepare(
      `INSERT INTO email_suppression (address, reason, created_at, stops_brief, stops_alerts) VALUES (?, 'unsubscribed', '2026-09-01T00:00:00Z', 0, 1)`,
    )
      .bind(TARGET)
      .run();
    const alertsOnly: EmailMessageBuilder[] = [];
    await sendMonthlies(envWith(alertsOnly), NOW, isTester);
    expect(alertsOnly.map((mail) => mail.to)).toEqual([TARGET]);

    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.prepare("UPDATE email_suppression SET stops_brief = 1, stops_alerts = 0").run();
    const briefStopped: EmailMessageBuilder[] = [];
    await sendMonthlies(envWith(briefStopped), NOW, isTester);
    expect(briefStopped).toHaveLength(0);
  });

  it("never mentions money or the plan", async () => {
    await seedPlan();
    await seedWorkspace("2026-10-04T08:00:00Z");
    await seedChange("sig-1", "Pricing page now lists a free tier", "2026-09-03T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    await sendMonthlies(envWith(sent), NOW, isTester);

    expect(`${sent[0]?.subject ?? ""} ${(sent[0]?.text ?? "").split("Choose which alerts")[0]}`).not.toMatch(
      /trial|charge|billed|billing|cancel|card|€|\bplan\b|renew|subscri/i,
    );
  });

  it.each([
    ["outside the first-week window", new Date("2026-10-20T12:00:00.000Z"), 0, "2026-10-19T08:00:00Z", null],
    ["someone away for three weeks", NOW, 0, "2026-09-10T08:00:00Z", null],
    ["someone still on a trial", NOW, 1, "2026-10-04T08:00:00Z", null],
    ["a paused brief", NOW, 0, "2026-10-04T08:00:00Z", "2026-09-30T08:00:00Z"],
  ])("sends nothing for %s", async (_name, at, trialing, seen, paused) => {
    await seedPlan(trialing);
    await seedWorkspace(seen, paused);
    await seedChange("sig-1", "Something", "2026-09-03T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendMonthlies(envWith(sent), at, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing for a month with no changes", async () => {
    await seedPlan();
    await seedWorkspace("2026-10-04T08:00:00Z");
    await seedChange("sig-old", "Two months ago", "2026-08-03T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendMonthlies(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["a tester subscription", true],
    ["a subscription Dodo cannot confirm", null],
  ])("sends nothing for %s", async (_name, tester) => {
    lookup.tester = tester;
    await seedPlan();
    await seedWorkspace("2026-10-04T08:00:00Z");
    await seedChange("sig-1", "Something", "2026-09-03T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendMonthlies(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
