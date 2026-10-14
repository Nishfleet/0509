import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { sendRecaps } from "../../workers/delivery/recap";

const lookup = { tester: false as boolean | null };
const isTester = () => Promise.resolve(lookup.tester);

const USER = "user-recap";
const WS = "ws-recap";
const TARGET = "recap@0509.io";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const PERIOD_END = "2026-10-16T00:00:00Z";

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

const seedPlan = (periodEnd = PERIOD_END) =>
  env.DB.prepare(
    `INSERT OR REPLACE INTO plan
       (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
     VALUES ('plan-recap', ?, 'starter', 'active', 'cus_1', 'sub_1', ?, 1, '2026-10-09T10:00:00Z')`,
  )
    .bind(WS, periodEnd)
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

  it("recaps the first days once, counting changes and naming the latest", async () => {
    await seedPlan();
    await seedChange("sig-1", "Pricing page now lists a free tier", "2026-10-10T10:00:00Z");
    await seedChange("sig-2", "Homepage headline changed", "2026-10-12T10:00:00Z");
    await seedChange("sig-old", "Before the trial", "2026-10-01T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendRecaps(envWith(sent), NOW, isTester)).toBe(1);
    expect(await sendRecaps(envWith(sent), new Date("2026-10-13T13:00:00.000Z"), isTester)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(TARGET);
    expect(sent[0]?.text).toContain("caught 2 changes");
    expect(sent[0]?.text).toContain("Most recent: Acme, Homepage headline changed");
  });

  it("recaps the owner, never an older confirmed teammate", async () => {
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role)
       VALUES ('mate-old', ?, 'chan-email', 'mate@0509.io', 1, '2000-01-01T00:00:00Z', 'teammate')`,
    )
      .bind(WS)
      .run();
    await seedPlan();
    await seedChange("sig-1", "Something", "2026-10-12T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendRecaps(envWith(sent), NOW, isTester)).toBe(1);
    expect(sent.map((mail) => mail.to)).toEqual([TARGET]);
  });

  it("never mentions money or the end of the trial", async () => {
    await seedPlan();
    await seedChange("sig-1", "Pricing page now lists a free tier", "2026-10-10T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    await sendRecaps(envWith(sent), NOW, isTester);

    expect(`${sent[0]?.subject ?? ""} ${sent[0]?.text ?? ""}`).not.toMatch(
      /trial|charge|billed|billing|cancel|card|€|\bplan\b|renew/i,
    );
  });

  it.each([
    ["a quiet trial", [] as string[]],
    ["a trial that is not four days in", ["late"]],
  ])("sends nothing for %s", async (name, extra) => {
    await seedPlan(extra.length > 0 ? "2026-10-19T00:00:00Z" : PERIOD_END);
    if (extra.length > 0) await seedChange("sig-1", "Something", "2026-10-12T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendRecaps(envWith(sent), NOW, isTester), name).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["a tester subscription", true],
    ["a subscription Dodo cannot confirm", null],
  ])("sends nothing for %s", async (_name, tester) => {
    lookup.tester = tester;
    await seedPlan();
    await seedChange("sig-1", "Something", "2026-10-12T10:00:00Z");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendRecaps(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
