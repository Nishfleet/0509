import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { deliverChange, handleBatch } from "../../workers/delivery/consumer";

const USER = "user-change-lane";
const WS = "ws-change-lane";
const TARGET = "watcher@0509.io";
const RIVAL = "ent-change-rival";
const SELF = "ent-change-self";
const SOURCE = "src-change-lane";
const SIGNAL = "sig-change-rival";
const SELF_SIGNAL = "sig-change-self";
const DIFF_KEY = "snapshot/site/w/s.diff.json";

const payload = JSON.stringify({
  page: { role: "pricing", url: "https://rival.example/pricing" },
  before: { snapshotId: "a", screenshotKey: null },
  after: { snapshotId: "b", screenshotKey: null },
  diffKey: DIFF_KEY,
  wordsAdded: 2,
  wordsRemoved: 2,
});

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

const insertSignal = (id: string, entityId: string) =>
  env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, payload_json, dedup_key, observed_at)
     VALUES (?1, ?2, ?3, ?4, 'change', 'pricing', 'https://rival.example/pricing', ?5, ?1, '2026-10-01T02:10:00Z')`,
  ).bind(id, WS, entityId, SOURCE, payload);

describe("rival change email lane (0509#6375)", () => {
  beforeEach(async () => {
    for (const table of ["send_attempt", "signal", "source", "entity", "send_target", "channel", "workspace"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, 'Watcher', ?, 1, '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z')`,
      ).bind(USER, TARGET),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Change lane', ?, 'UTC', 1, 8, '2026-09-23T00:00:00Z')`,
      ).bind(WS, USER),
      env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`),
      env.DB.prepare(
        `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
         VALUES ('target-change', ?, 'chan-email', ?, 1, '2026-09-23T00:00:01Z')`,
      ).bind(WS, TARGET),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
         VALUES (?, ?, 'competitor', 'rival.example', 'Rival', 'on', '2026-09-23T00:00:00Z')`,
      ).bind(RIVAL, WS),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
         VALUES (?, ?, 'self', 'me.example', 'Me', 'on', '2026-09-23T00:00:00Z')`,
      ).bind(SELF, WS),
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES (?, 'change:lane', 'site', 'web', 'web', 'best_effort')`,
      ).bind(SOURCE),
      insertSignal(SIGNAL, RIVAL),
      insertSignal(SELF_SIGNAL, SELF),
    ]);
    await env.SNAPSHOTS.put(DIFF_KEY, JSON.stringify({ hunks: [{ lines: ["-Pro $12 a month", "+Pro $15 a month"] }] }));
  });

  it("emails the rival's price change with the before and after, once", async () => {
    const sent: EmailMessageBuilder[] = [];

    const first = await deliverChange(envWith(sent), { signal_id: SIGNAL });
    const second = await deliverChange(envWith(sent), { signal_id: SIGNAL });

    expect(first.outcome).toBe("sent");
    expect(first.idempotency_key).toBe(`change:${SIGNAL}:target-change`);
    expect(second.outcome).toBe("duplicate");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(TARGET);
    expect(sent[0].subject).toBe("Rival changed its pricing page");
    expect(sent[0].text).toContain("Before: Pro $12 a month");
    expect(sent[0].text).toContain("After: Pro $15 a month");
  });

  it("sends nothing when the workspace turned change alerts off", async () => {
    await env.DB.prepare(`UPDATE workspace SET change_alerts = 0 WHERE id = ?`).bind(WS).run();
    const sent: EmailMessageBuilder[] = [];

    const result = await deliverChange(envWith(sent), { signal_id: SIGNAL });

    expect(result.outcome).toBe("muted");
    expect(sent).toHaveLength(0);
  });

  it("never emails a change to the customer's own site, and ignores an unknown signal", async () => {
    const sent: EmailMessageBuilder[] = [];

    expect((await deliverChange(envWith(sent), { signal_id: SELF_SIGNAL })).outcome).toBe("no_signal");
    expect((await deliverChange(envWith(sent), { signal_id: "missing" })).outcome).toBe("no_signal");
    expect(sent).toHaveLength(0);
  });

  it("routes a signal message through the queue batch and acks it", async () => {
    const sent: EmailMessageBuilder[] = [];
    const acked: number[] = [];
    const batch = {
      queue: "send-email",
      messages: [
        {
          id: "msg-0",
          timestamp: new Date("2026-10-01T02:11:00Z"),
          body: { signal_id: SIGNAL },
          attempts: 1,
          ack: () => acked.push(0),
          retry: () => acked.push(-1),
        },
      ],
      metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
      ackAll: () => acked.push(0),
      retryAll: () => acked.push(-1),
    } as MessageBatch;

    const results = await handleBatch(envWith(sent), batch);

    expect(results.map((r) => r.outcome)).toEqual(["sent"]);
    expect(acked).toEqual([0]);
  });
});
