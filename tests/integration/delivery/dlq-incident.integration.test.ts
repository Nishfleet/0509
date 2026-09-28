import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { handleDlqBatch } from "../../../workers/delivery/dlq-consumer";

const USER = "user-dlq-incident";
const WS = "ws-dlq-incident";
const ENTITY = "ent-dlq-incident";
const DOMAIN = "dlq.example";
const PAGE = "page-dlq-incident";
const INCIDENT = "inc-dlq";
const KIND = "error";

interface AlertRow {
  id: string;
  workspace_id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  status: string;
  created_at: string;
}

const readAlerts = async (): Promise<AlertRow[]> =>
  (
    await env.DB.prepare(
      `SELECT id, workspace_id, kind, severity, title, body, status, created_at
         FROM alert WHERE workspace_id = ? ORDER BY created_at ASC`,
    )
      .bind(WS)
      .all<AlertRow>()
  ).results ?? [];

const batchFor = (queue: string, bodies: unknown[]): MessageBatch => {
  const batch: MessageBatch = {
    queue,
    messages: bodies.map((body, index) => ({
      id: `msg-${index}`,
      timestamp: new Date("2026-09-28T00:00:00Z"),
      body,
      attempts: 3,
      ack: () => acks.push(index),
      retry: () => undefined,
    })),
    metadata: { metrics: { backlogCount: bodies.length, backlogBytes: 0 } },
    ackAll: () => undefined,
    retryAll: () => undefined,
  };
  return batch;
};

const acks: number[] = [];

const seed = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Owner', 'owner@0509.io', 1, '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z')`,
  )
    .bind(USER)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'DLQ incident', ?, 'UTC', 1, 8, '2026-09-28T00:00:00Z')`,
  )
    .bind(WS, USER)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'self', ?, '{}', 'manual', 'on', '2026-09-28T00:00:00Z')`,
  )
    .bind(ENTITY, WS, DOMAIN)
    .run();
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, discovered_at)
     VALUES (?, ?, ?, '2026-09-28T00:00:00Z')`,
  )
    .bind(PAGE, ENTITY, `https://${DOMAIN}/`)
    .run();
  await env.DB.prepare(
    `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at, closed_at)
     VALUES (?, ?, ?, ?, ?, '2026-09-28T01:00:00Z', NULL)`,
  )
    .bind(INCIDENT, WS, ENTITY, PAGE, KIND)
    .run();
};

describe("send-email-dlq, incident lane (0509#5761)", () => {
  beforeEach(async () => {
    acks.length = 0;
    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.exec("DELETE FROM alert");
    await env.DB.exec("DELETE FROM incident");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM digest");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await seed();
  });

  it("a dead-lettered { incident_id } writes the workspace's undelivered alert", async () => {
    await env.DB.prepare(
      `INSERT INTO send_attempt (id, workspace_id, idempotency_key, status, error, attempted_at)
       VALUES ('sa-inc', ?, ?, 'failed', 'invalid recipient', '2026-09-28T02:00:00Z')`,
    )
      .bind(WS, `incident:${INCIDENT}:open`)
      .run();

    const ids = await handleDlqBatch(env, batchFor("send-email-dlq", [{ incident_id: INCIDENT }]));

    expect(ids).toEqual([`dlq-incident:${INCIDENT}`]);

    const alerts = await readAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe(`dlq-incident:${INCIDENT}`);
    expect(alerts[0].kind).toBe("delivery_failed");
    expect(alerts[0].severity).toBe("high");
    expect(alerts[0].status).toBe("unread");
    expect(alerts[0].body).not.toContain("invalid recipient");

    // The Sentry raise is asserted in tests/delivery/dlq.test.ts, the node
    // project where @sentry/cloudflare can be mocked; this file is the real
    // D1 write path.
    expect(acks).toEqual([0]);
  });

  it("keeps one alert when the same incident dead-letters twice", async () => {
    await handleDlqBatch(env, batchFor("send-email-dlq", [{ incident_id: INCIDENT }]));
    await handleDlqBatch(env, batchFor("send-email-dlq", [{ incident_id: INCIDENT }]));

    expect(await readAlerts()).toHaveLength(1);
  });

  it("writes nothing and still acks when the incident row is already gone", async () => {
    await env.DB.exec("DELETE FROM alert");
    await env.DB.exec("DELETE FROM incident");

    const ids = await handleDlqBatch(env, batchFor("send-email-dlq", [{ incident_id: INCIDENT }]));

    expect(ids).toEqual([]);
    expect(await readAlerts()).toHaveLength(0);
    expect(acks).toEqual([0]);
  });

  it("the digest lane is untouched: a dead-lettered brief still writes its own alert", async () => {
    await env.DB.prepare(
      `INSERT INTO digest
         (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
       VALUES ('dg-dlq', ?, 'weekly', '2026-09-21', '2026-09-28', 'pending', 'subject', '{"text":"brief"}', NULL)`,
    )
      .bind(WS)
      .run();
    await env.DB.prepare(
      `INSERT INTO send_attempt (id, workspace_id, digest_id, idempotency_key, status, error, attempted_at)
       VALUES ('sa-dg', ?, 'dg-dlq', 'digest:dg-dlq:target', 'failed', 'invalid recipient', '2026-09-28T02:00:00Z')`,
    )
      .bind(WS)
      .run();

    const ids = await handleDlqBatch(env, batchFor("send-email-dlq", [{ digest_id: "dg-dlq" }]));

    expect(ids).toEqual(["dlq:dg-dlq"]);
    const alerts = await readAlerts();
    expect(alerts.map((row) => row.id)).toEqual(["dlq:dg-dlq"]);
    expect(acks).toEqual([0]);
    const digest = await env.DB.prepare(`SELECT status FROM digest WHERE id = 'dg-dlq'`).first<{
      status: string;
    }>();
    expect(digest?.status).toBe("failed");
  });
});
