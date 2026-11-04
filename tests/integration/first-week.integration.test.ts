import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { BriefPayload } from "../../app/lib/brief-payload";
import { deliver, deliverChange } from "../../workers/delivery/consumer";
import { sendRecaps } from "../../workers/delivery/recap";
import { sendTrialReminders } from "../../workers/delivery/trial-reminder";
import { sendWelcomes } from "../../workers/delivery/welcome";

const USER = "user-first-week";
const WS = "ws-first-week";
const TARGET = "owner@0509.io";
const RIVAL = "ent-fw-rival";
const SOURCE = "src-fw";
const DIFF_KEY = "snapshot/site/fw/s.diff.json";
const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date("2026-10-05T09:00:00.000Z");
const isTester = () => Promise.resolve(false);

interface Mail {
  day: number;
  subject: string;
  to: string;
  text: string;
}

const at = (day: number, hour = 12): Date => new Date(START.getTime() + day * DAY_MS + (hour - 9) * 60 * 60 * 1000);

const firstBrief: BriefPayload = {
  workspace_id: WS,
  timezone: "UTC",
  period_start: "2026-10-05T08:00:00.000Z",
  period_end: "2026-10-12T08:00:00.000Z",
  headline_rank: 2,
  headline_total: 3,
  headline_movement: 0,
  headline_is_new: true,
  why_line: "Your first ranking.",
  is_quiet_week: false,
  is_unjudged: false,
  read_this_first: [],
  brands: [],
  own_site: { status: "ok", incidents: [] },
  checked: {
    mention_count: 2,
    site_change_count: 1,
    new_ad_count: 0,
    source_keys: [],
    degraded_source_keys: [],
    degraded_sources: [],
  },
  next_brief_at: "2026-10-19T08:00:00.000Z",
};

const changePayload = JSON.stringify({
  page: { role: "pricing", url: "https://acme.example/pricing" },
  before: { snapshotId: "a", screenshotKey: null },
  after: { snapshotId: "b", screenshotKey: null },
  diffKey: DIFF_KEY,
  wordsAdded: 2,
  wordsRemoved: 2,
});

const seedSignal = (id: string, title: string, observedAt: string, payload = "{}") =>
  env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, aspect, url, payload_json, dedup_key, observed_at)
     VALUES (?1, ?2, ?3, ?4, 'change', ?5, 'pricing', 'https://acme.example/pricing', ?7, ?1, ?6)`,
  )
    .bind(id, WS, RIVAL, SOURCE, title, observedAt, payload)
    .run();

describe("the first week and a half of one customer, day by day", () => {
  beforeEach(async () => {
    for (const table of [
      "send_attempt",
      "email_suppression",
      "digest",
      "signal",
      "source",
      "entity",
      "plan",
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
         VALUES (?, 'Owner', ?, 1, '2026-10-05T09:00:00Z', '2026-10-05T09:00:00Z')`,
      ).bind(USER, TARGET),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'First week', ?, 'UTC', 1, 8, '2026-10-05T09:00:00Z')`,
      ).bind(WS, USER),
      env.DB.prepare(
        `INSERT INTO plan (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
         VALUES ('plan-fw', ?, 'starter', 'active', 'cus_1', 'sub_1', '2026-10-12T09:00:00Z', 1, '2026-10-05T09:00:00Z')`,
      ).bind(WS),
      env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`),
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
         VALUES ('target-fw', ?, 'chan-email', ?, 1, '2026-10-05T09:00:01Z')`,
      ).bind(WS, TARGET),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
         VALUES (?, ?, 'competitor', 'acme.example', 'Acme', '{}', 'manual', 'on', '2026-10-05T09:00:00Z')`,
      ).bind(RIVAL, WS),
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES (?, 'fw-site', 'site', 'web', 'site', 'scraped_page')`,
      ).bind(SOURCE),
    ]);
    await env.SNAPSHOTS.put(DIFF_KEY, JSON.stringify({ hunks: [{ lines: ["-Pro $29 a month", "+Pro $39 a month"] }] }));
  });

  it("sends each email on its day, once, and goes quiet after an unsubscribe", async () => {
    const sent: Mail[] = [];
    let day = 0;
    const withMail = {
      ...env,
      EMAIL: {
        send(message: EmailMessageBuilder) {
          sent.push({ day, subject: message.subject, to: String(message.to), text: String(message.text) });
          return Promise.resolve({} as EmailSendResult);
        },
      },
    } as Env;
    const runDay = async (index: number) => {
      day = index;
      await sendWelcomes(withMail, at(index), isTester);
      await sendRecaps(withMail, at(index), isTester);
      await sendTrialReminders(withMail, at(index), isTester);
    };

    for (const index of [0, 1, 2, 3, 4, 5, 6]) {
      if (index === 2) await seedSignal("sig-fw-1", "Pricing page now lists a free tier", at(2).toISOString());
      await runDay(index);
      await runDay(index);
    }
    day = 7;
    await env.DB.prepare(
      `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
       VALUES ('digest-fw', ?, 'weekly', '2026-10-05', '2026-10-12', 'pending', ?, ?, NULL)`,
    )
      .bind(WS, "Your first ranking: you're #2 of 3", JSON.stringify(firstBrief))
      .run();
    expect((await deliver(withMail, { digest_id: "digest-fw" })).outcome).toBe("sent");
    expect((await deliver(withMail, { digest_id: "digest-fw" })).outcome).toBe("duplicate");
    await env.DB.prepare(
      "UPDATE plan SET trialing = 0, current_period_end = '2026-11-12T09:00:00Z' WHERE workspace_id = ?",
    )
      .bind(WS)
      .run();
    for (const index of [7, 8]) {
      await runDay(index);
    }
    day = 9;
    await seedSignal("sig-fw-2", "Pricing", at(9).toISOString(), changePayload);
    expect((await deliverChange(withMail, { signal_id: "sig-fw-2" })).outcome).toBe("sent");

    expect(sent.map((mail) => `day ${String(mail.day)}: ${mail.subject}`)).toEqual([
      "day 0: We're watching Acme",
      "day 4: 1 competitor change caught so far, latest: Acme",
      "day 5: Your Starter trial ends on Monday 12 October",
      "day 7: Your first ranking: you're #2 of 3",
      "day 9: Acme changed its pricing page: Pro $29 a month → Pro $39 a month",
    ]);
    expect(new Set(sent.map((mail) => mail.to))).toEqual(new Set([TARGET]));
    const byDay = (index: number) => sent.find((mail) => mail.day === index)?.text ?? "";
    expect(byDay(0)).toContain("Acme");
    expect(byDay(4)).toContain("caught 1 change");
    expect(byDay(4)).toContain("Most recent: Acme, Pricing page now lists a free tier");
    expect(byDay(5)).toContain("12 October");
    expect(byDay(9)).toContain("Before: Pro $29 a month");
    expect(byDay(9)).toContain("After: Pro $39 a month");
    for (const mail of sent) expect(mail.text).toContain("https://0509.io/");
  });

  it("sends nothing to an address that unsubscribed before the week began", async () => {
    await env.DB.prepare(
      "INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'unsubscribe', '2026-10-05T09:00:00Z')",
    )
      .bind(TARGET)
      .run();
    const sent: string[] = [];
    const withMail = {
      ...env,
      EMAIL: {
        send(message: EmailMessageBuilder) {
          sent.push(message.subject);
          return Promise.resolve({} as EmailSendResult);
        },
      },
    } as Env;
    await seedSignal("sig-fw-3", "Pricing page now lists a free tier", at(2).toISOString());
    for (const index of [0, 1, 2, 3, 4, 5, 6]) {
      await sendWelcomes(withMail, at(index), isTester);
      await sendRecaps(withMail, at(index), isTester);
      await sendTrialReminders(withMail, at(index), isTester);
    }
    expect(sent).toEqual([]);
  });

  it("sends nothing for a subscription that belongs to a tester", async () => {
    const sent: string[] = [];
    const withMail = {
      ...env,
      EMAIL: {
        send(message: EmailMessageBuilder) {
          sent.push(message.subject);
          return Promise.resolve({} as EmailSendResult);
        },
      },
    } as Env;
    await seedSignal("sig-fw-4", "Pricing page now lists a free tier", at(2).toISOString());
    for (const index of [0, 1, 2, 3, 4, 5, 6]) {
      await sendWelcomes(withMail, at(index), () => Promise.resolve(true));
      await sendRecaps(withMail, at(index), () => Promise.resolve(true));
      await sendTrialReminders(withMail, at(index), () => Promise.resolve(true));
    }
    expect(sent).toEqual([]);
  });
});
