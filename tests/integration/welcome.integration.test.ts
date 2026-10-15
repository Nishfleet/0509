import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { sendWelcomes } from "../../workers/delivery/welcome";

const lookup = { tester: false as boolean | null };
const isTester = () => Promise.resolve(lookup.tester);

const USER = "user-welcome";
const WS = "ws-welcome";
const TARGET = "welcome@0509.io";
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

const seedPlan = (input: { status?: string; trialing?: number; periodEnd?: string }) =>
  env.DB.prepare(
    `INSERT OR REPLACE INTO plan
       (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
     VALUES ('plan-welcome', ?, 'starter', ?, 'cus_1', 'sub_1', ?, ?, '2026-10-13T10:00:00Z')`,
  )
    .bind(WS, input.status ?? "active", input.periodEnd ?? "2026-10-20T00:00:00Z", input.trialing ?? 1)
    .run();

describe("welcome email", () => {
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
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, 'Welcome', ?, 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      ).bind(USER, TARGET),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Welcome', ?, 'UTC', 1, 8, '2026-10-01T00:00:00Z')`,
      ).bind(WS, USER),
      env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`),
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
         VALUES ('target-welcome', ?, 'chan-email', ?, 1, '2026-10-01T00:00:01Z')`,
      ).bind(WS, TARGET),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
         VALUES ('ent-w1', ?, 'competitor', 'acme.com', 'Acme', '{}', 'manual', 'on', '2026-10-13T09:00:00Z')`,
      ).bind(WS),
    ]);
  });

  it("welcomes a new trial once, naming the rival and the first brief", async () => {
    await seedPlan({});
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWelcomes(envWith(sent), NOW, isTester)).toBe(1);
    expect(await sendWelcomes(envWith(sent), new Date("2026-10-13T13:00:00.000Z"), isTester)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(TARGET);
    expect(sent[0]?.subject).toBe("We're watching Acme");
    expect(sent[0]?.text).toContain("We read each site every night.");
    expect(sent[0]?.text).toContain("Monday 19 October");
  });

  it("welcomes the owner, never an older confirmed teammate", async () => {
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role)
       VALUES ('mate-old', ?, 'chan-email', 'mate@0509.io', 1, '2000-01-01T00:00:00Z', 'teammate')`,
    )
      .bind(WS)
      .run();
    await seedPlan({});
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWelcomes(envWith(sent), NOW, isTester)).toBe(1);
    expect(sent.map((mail) => mail.to)).toEqual([TARGET]);
  });

  it("names the first three rivals and counts the rest, even when a name has a comma or bar", async () => {
    await seedPlan({});
    await env.DB.batch(
      [
        ["ent-w2", "b.com", "Beta | Co, Ltd"],
        ["ent-w3", "c.com", "Gamma"],
        ["ent-w4", "d.com", "Delta"],
      ].map(([id, domain, name], index) =>
        env.DB.prepare(
          `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
           VALUES (?, ?, 'competitor', ?, ?, '{}', 'manual', 'on', ?)`,
        ).bind(id, WS, domain, name, `2026-10-13T09:0${String(index + 1)}:00Z`),
      ),
    );
    const sent: EmailMessageBuilder[] = [];

    await sendWelcomes(envWith(sent), NOW, isTester);

    expect(sent[0]?.text).toContain("We're watching Acme, Beta | Co, Ltd, Gamma and 1 more.");
  });

  it("sends nothing when the workspace has no confirmed address", async () => {
    await seedPlan({});
    await env.DB.exec("UPDATE send_target SET is_verified = 0");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWelcomes(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["a customer who already paid", { trialing: 0 }],
    ["a cancelled plan", { status: "cancelled" }],
    ["a trial that began days ago", { periodEnd: "2026-10-15T00:00:00Z" }],
  ])("sends nothing for %s", async (_name, plan) => {
    await seedPlan(plan);
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWelcomes(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["a tester subscription", true],
    ["a subscription Dodo cannot confirm", null],
  ])("sends nothing for %s", async (_name, tester) => {
    lookup.tester = tester;
    await seedPlan({});
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWelcomes(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing to an address that bounced", async () => {
    await seedPlan({});
    await env.DB.prepare(
      "INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'bounce', '2026-10-10T00:00:00Z')",
    )
      .bind(TARGET)
      .run();
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWelcomes(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("still sends when only one of the two switches is off", async () => {
    await seedPlan({});
    await env.DB.prepare(
      "INSERT INTO email_suppression (address, reason, created_at, stops_brief, stops_alerts) VALUES (?, 'unsubscribed', '2026-10-10T00:00:00Z', 1, 0)",
    )
      .bind(TARGET)
      .run();
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWelcomes(envWith(sent), NOW, isTester)).toBe(1);
    expect(sent).toHaveLength(1);

    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.prepare("UPDATE email_suppression SET stops_alerts = 1").run();
    const stopped: EmailMessageBuilder[] = [];

    expect(await sendWelcomes(envWith(stopped), NOW, isTester)).toBe(0);
    expect(stopped).toHaveLength(0);
  });

  it("tries again on the next run when the send failed", async () => {
    await seedPlan({});
    const failing = { ...env, EMAIL: { send: () => Promise.reject(new Error("mail down")) } } as unknown as Env;
    const sent: EmailMessageBuilder[] = [];

    expect(await sendWelcomes(failing, NOW, isTester)).toBe(0);
    expect(await sendWelcomes(envWith(sent), new Date("2026-10-13T13:00:00.000Z"), isTester)).toBe(1);
    expect(sent).toHaveLength(1);
  });
});
