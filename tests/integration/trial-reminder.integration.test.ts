import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { expectSendRecord, PROVIDER_ID } from "./send-record";
import { sendTrialReminders } from "../../workers/delivery/trial-reminder";

const lookup = { tester: false as boolean | null };
const isTester = () => Promise.resolve(lookup.tester);

const USER = "user-trial-reminder";
const WS = "ws-trial-reminder";
const TARGET = "trial@0509.io";
const NOW = new Date("2026-10-13T03:00:00.000Z");
const IN_36_HOURS = "2026-10-14T15:00:00.000Z";

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

const seedPlan = (input: { status: string; trialing: number; periodEnd: string; tier?: string }) =>
  env.DB.prepare(
    `INSERT OR REPLACE INTO plan
       (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
     VALUES ('plan-trial', ?, ?, ?, 'cus_1', 'sub_1', ?, ?, '2026-10-08T00:00:00Z')`,
  )
    .bind(WS, input.tier ?? "starter", input.status, input.periodEnd, input.trialing)
    .run();

describe("trial ending reminder", () => {
  beforeEach(async () => {
    lookup.tester = false;
    for (const table of ["send_attempt", "email_suppression", "plan", "send_target", "channel", "workspace"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, 'Trial', ?, 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      ).bind(USER, TARGET),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Trial', ?, 'UTC', 1, 8, '2026-10-01T00:00:00Z')`,
      ).bind(WS, USER),
      env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`),
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
         VALUES ('target-trial', ?, 'chan-email', ?, 1, '2026-10-01T00:00:01Z')`,
      ).bind(WS, TARGET),
    ]);
  });

  it("emails a trial that ends within two days, once", async () => {
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    const sent: EmailMessageBuilder[] = [];

    const first = await sendTrialReminders(envWith(sent), NOW, isTester);
    const second = await sendTrialReminders(envWith(sent), new Date("2026-10-14T03:00:00.000Z"), isTester);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(TARGET);
    expect(sent[0]?.subject).toBe("Your Starter trial ends on Wednesday 14 October");
    expect(sent[0]?.text).toContain("€46 a month");
    await expectSendRecord("trial_ending", sent[0]?.subject);
  });

  it("reminds the owner, never an older confirmed teammate", async () => {
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role)
       VALUES ('mate-old', ?, 'chan-email', 'mate@0509.io', 1, '2000-01-01T00:00:00Z', 'teammate')`,
    )
      .bind(WS)
      .run();
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    const sent: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(envWith(sent), NOW, isTester)).toBe(1);
    expect(sent.map((mail) => mail.to)).toEqual([TARGET]);
  });

  it.each([
    ["a trial more than two days away", { status: "active", trialing: 1, periodEnd: "2026-10-17T00:00:00.000Z" }],
    ["a customer who already paid", { status: "active", trialing: 0, periodEnd: IN_36_HOURS }],
    ["a trial the customer cancelled", { status: "cancelled", trialing: 1, periodEnd: IN_36_HOURS }],
    ["a trial that already ended", { status: "active", trialing: 1, periodEnd: "2026-10-12T00:00:00.000Z" }],
  ])("sends nothing for %s", async (_name, plan) => {
    await seedPlan(plan);
    const sent: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["a tester subscription", true],
    ["a subscription Dodo cannot confirm", null],
  ])("sends nothing for %s", async (_name, tester) => {
    lookup.tester = tester;
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    const sent: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing to an address that bounced", async () => {
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    await env.DB.prepare(
      "INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'bounce', '2026-10-10T00:00:00Z')",
    )
      .bind(TARGET)
      .run();
    const sent: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("still sends when only one of the two switches is off", async () => {
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    await env.DB.prepare(
      "INSERT INTO email_suppression (address, reason, created_at, stops_brief, stops_alerts) VALUES (?, 'unsubscribed', '2026-10-10T00:00:00Z', 1, 0)",
    )
      .bind(TARGET)
      .run();
    const sent: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(envWith(sent), NOW, isTester)).toBe(1);
    expect(sent).toHaveLength(1);

    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.prepare("UPDATE email_suppression SET stops_alerts = 1").run();
    const stopped: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(envWith(stopped), NOW, isTester)).toBe(0);
    expect(stopped).toHaveLength(0);
  });

  it("tries again the next night when the send failed", async () => {
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    const failing = {
      ...env,
      EMAIL: { send: () => Promise.reject(new Error("mail down")) },
    } as unknown as Env;
    const sent: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(failing, NOW, isTester)).toBe(0);
    expect(await sendTrialReminders(envWith(sent), new Date("2026-10-14T03:00:00.000Z"), isTester)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("still sends when the workspace timezone is unusable", async () => {
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    await env.DB.exec("UPDATE workspace SET timezone = 'Not/AZone'");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(envWith(sent), NOW, isTester)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("does not ask Dodo again once the reminder went out", async () => {
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    const asked: string[] = [];
    const counting = (id: string) => {
      asked.push(id);
      return Promise.resolve(false as boolean | null);
    };
    const sent: EmailMessageBuilder[] = [];

    await sendTrialReminders(envWith(sent), NOW, counting);
    await sendTrialReminders(envWith(sent), new Date("2026-10-14T03:00:00.000Z"), counting);

    expect(asked).toEqual(["sub_1"]);
  });

  it("skips a trial with no verified email and still sends the others", async () => {
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    await env.DB.exec("UPDATE send_target SET is_verified = 0");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("skips a plan with no subscription id", async () => {
    await seedPlan({ status: "active", trialing: 1, periodEnd: IN_36_HOURS });
    await env.DB.exec("UPDATE plan SET provider_subscription_id = NULL");
    const sent: EmailMessageBuilder[] = [];

    expect(await sendTrialReminders(envWith(sent), NOW, isTester)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
