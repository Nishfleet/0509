import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  deliverIncident,
  handleBatch,
  type IncidentMessage,
} from "../../workers/delivery/consumer";

interface Recorder {
  sent: EmailMessageBuilder[];
  fail: Error | null;
}

const recorder = (): Recorder => ({ sent: [], fail: null });

const bindingFor = (rec: Recorder): SendEmail => ({
  send(message: EmailMessageBuilder) {
    if (rec.fail) throw rec.fail;
    rec.sent.push(message);
    return Promise.resolve({} as EmailSendResult);
  },
});

const USER = "user-incident-lane";
const WS = "ws-incident-lane";
const CHANNEL = "chan-email";
const TARGET = "watcher@0509.io";
const TARGET_ID = "watcher-target";
const ENTITY = "ent-incident-lane";
const DOMAIN = "shop.example";
const PAGE_A = "page-incident-lane-a";
const KIND = "error";
const INCIDENT_A = "inc-a";
const INCIDENT_B = "inc-b";
const DAY = new Date().toISOString().slice(0, 10);

const ENTITY_COMP = "ent-incident-lane-comp";
const PAGE_COMP = "page-incident-lane-comp";
const INCIDENT_COMP = "inc-comp";

const seedUserAndWorkspace = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Watcher', ?, 1, '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z')`,
  )
    .bind(USER, TARGET)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Incident lane', ?, 'UTC', 1, 8, '2026-09-23T00:00:00Z')`,
  )
    .bind(WS, USER)
    .run();
  await env.DB.prepare(
    `INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`,
  )
    .bind(CHANNEL)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
     VALUES (?, ?, ?, ?, 1, '2026-09-23T00:00:01Z')`,
  )
    .bind(TARGET_ID, WS, CHANNEL, TARGET)
    .run();
};

const seedSelfEntity = async () => {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'self', ?, '{}', 'manual', 'on', '2026-09-23T00:00:00Z')`,
  )
    .bind(ENTITY, WS, DOMAIN)
    .run();
};

const seedPage = async (id: string, entityId: string) => {
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, discovered_at)
     VALUES (?, ?, ?, '2026-09-23T00:00:00Z')`,
  )
    .bind(id, entityId, `https://${DOMAIN}/`)
    .run();
};

const seedIncident = async (id: string, pageId: string, entityId: string, closed: string | null) => {
  await env.DB.prepare(
    `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at, closed_at)
     VALUES (?, ?, ?, ?, ?, '2026-09-23T07:15:00Z', ?)`,
  )
    .bind(id, WS, entityId, pageId, KIND, closed)
    .run();
};

interface AttemptRow {
  id: string;
  idempotency_key: string;
  digest_id: string | null;
  status: string;
  error: string | null;
  attempted_at: string;
}

interface NoticeRow {
  id: string;
  incident_id: string;
  page_id: string;
  sent_on: string;
  sent_at: string;
  is_resolution: number;
}

const readAttempts = async (): Promise<AttemptRow[]> =>
  (
    await env.DB.prepare(
      `SELECT id, idempotency_key, digest_id, status, error, attempted_at
         FROM send_attempt ORDER BY attempted_at ASC`,
    ).all<AttemptRow>()
  ).results ?? [];

const readNotices = async (pageId: string): Promise<NoticeRow[] | undefined> =>
  (
    await env.DB.prepare(
      `SELECT id, incident_id, page_id, sent_on, sent_at, is_resolution
         FROM incident_notice WHERE page_id = ? ORDER BY is_resolution ASC`,
    )
      .bind(pageId)
      .all<NoticeRow>()
  ).results;

const closeIncident = async (id: string) => {
  await env.DB.prepare(`UPDATE incident SET closed_at = ? WHERE id = ?`)
    .bind("2026-09-23T09:00:00Z", id)
    .run();
};

const message = (incidentId: string): IncidentMessage => ({ incident_id: incidentId });

const batchFor = (bodies: unknown[]) => {
  const acked: number[] = [];
  const retried: number[] = [];
  const batch: MessageBatch = {
    queue: "send-email",
    messages: bodies.map((body, index) => ({
      id: `msg-${index}`,
      timestamp: new Date("2026-09-23T09:00:00Z"),
      body,
      attempts: 1,
      ack: () => acked.push(index),
      retry: () => retried.push(index),
    })),
    metadata: { metrics: { backlogCount: bodies.length, backlogBytes: 0 } },
    ackAll: () => acked.push(...bodies.map((_, index) => index)),
    retryAll: () => retried.push(...bodies.map((_, index) => index)),
  };
  return { batch, acked, retried };
};

const envWith = (email: SendEmail): Env => ({ ...env, EMAIL: email }) as Env;

const cleanTables = [
  "send_attempt",
  "incident_notice",
  "alert",
  "incident",
  "page",
  "entity",
  "send_target",
  "digest",
  "channel",
  "email_suppression",
  "workspace",
];

describe("incident lane (0509#4364)", () => {
  beforeEach(async () => {
    for (const table of cleanTables) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await seedUserAndWorkspace();
    await seedSelfEntity();
    await seedPage(PAGE_A, ENTITY);
    await seedIncident(INCIDENT_A, PAGE_A, ENTITY, null);
    await env.DB.prepare(
      `INSERT INTO alert (id, workspace_id, entity_id, page_id, incident_id, kind, title, body, created_at)
       VALUES ('alert-lane', ?, ?, ?, ?, 'error', 'Checkout 500', 'Checkout was 500ing', '2026-09-23T07:15:30Z')`,
    )
      .bind(WS, ENTITY, PAGE_A, INCIDENT_A)
      .run();
  });

  it("(a) sends the open notice and records both rows", async () => {
    const rec = recorder();

    const result = await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_A));

    expect(result.outcome).toBe("sent");
    expect(result.attempt_id).toBeTruthy();
    expect(result.idempotency_key).toBe(`incident:${INCIDENT_A}:open`);
    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0].to).toBe(TARGET);
    expect(rec.sent[0].from).toBe("brief@0509.io");
    expect(rec.sent[0].subject).toBe(`${DOMAIN} looks broken: ${KIND}`);
    expect(rec.sent[0].text).toContain("What changed: Checkout was 500ing");
    expect(rec.sent[0].html).toContain("https://0509.io/app/alerts");

    const attempts = await readAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].idempotency_key).toBe(`incident:${INCIDENT_A}:open`);
    expect(attempts[0].digest_id).toBeNull();
    expect(attempts[0].status).toBe("sent");

    const notices = await readNotices(PAGE_A);
    expect(notices).toHaveLength(1);
    expect(notices?.[0]?.is_resolution).toBe(0);
    expect(notices?.[0]?.incident_id).toBe(INCIDENT_A);
    expect(notices?.[0]?.sent_on).toBe(DAY);
  });

  it("(b) drops a re-enqueued open notice as a duplicate", async () => {
    const rec = recorder();
    await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_A));
    expect(rec.sent).toHaveLength(1);

    const second = await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_A));

    expect(second.outcome).toBe("duplicate");
    expect(second.attempt_id).toBeNull();
    expect(second.idempotency_key).toBe(`incident:${INCIDENT_A}:open`);
    expect(rec.sent).toHaveLength(1);
    expect(await readNotices(PAGE_A)).toHaveLength(1);
  });

  it("(c) sends the fixed follow-up with its own key and notice row", async () => {
    const rec = recorder();
    await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_A));
    await closeIncident(INCIDENT_A);

    const result = await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_A));

    expect(result.outcome).toBe("sent");
    expect(result.idempotency_key).toBe(`incident:${INCIDENT_A}:fixed`);
    expect(rec.sent).toHaveLength(2);
    expect(rec.sent[1].subject).toContain("looks fixed");

    const notices = await readNotices(PAGE_A);
    expect(notices).toHaveLength(2);
    expect(notices?.map((row) => row.is_resolution)).toEqual([0, 1]);
    expect(notices?.every((row) => row.sent_on === DAY)).toBe(true);
  });

  it("(d) drops a different incident on the same page the same day", async () => {
    const rec = recorder();
    await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_A));
    await closeIncident(INCIDENT_A);
    await seedIncident(INCIDENT_B, PAGE_A, ENTITY, null);

    const result = await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_B));

    expect(result.outcome).toBe("duplicate");
    expect(result.attempt_id).toBeNull();
    expect(result.idempotency_key).toBe(`incident:${INCIDENT_B}:open`);
    expect(rec.sent).toHaveLength(1);
    const notices = await readNotices(PAGE_A);
    expect(notices).toHaveLength(1);
    expect(notices?.[0]?.incident_id).toBe(INCIDENT_A);
  });

  it("(e) never emails about a competitor site", async () => {
    const rec = recorder();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
       VALUES (?, ?, 'competitor', 'rival.example', '{}', 'manual', 'on', '2026-09-23T00:00:00Z')`,
    )
      .bind(ENTITY_COMP, WS)
      .run();
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, discovered_at)
       VALUES (?, ?, 'https://rival.example/', '2026-09-23T00:00:00Z')`,
    )
      .bind(PAGE_COMP, ENTITY_COMP)
      .run();
    await seedIncident(INCIDENT_COMP, PAGE_COMP, ENTITY_COMP, null);

    const result = await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_COMP));

    expect(result.outcome).toBe("not_self");
    expect(result.attempt_id).toBeNull();
    expect(result.idempotency_key).toBeNull();
    expect(rec.sent).toHaveLength(0);
    expect(await readNotices(PAGE_COMP)).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
  });

  it("(f) skips a suppressed address before rendering", async () => {
    const rec = recorder();
    await env.DB.prepare(
      `INSERT INTO email_suppression (address, reason, created_at)
       VALUES (?, 'unsubscribed', '2026-09-23T00:00:02Z')`,
    )
      .bind(TARGET)
      .run();

    const result = await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_A));

    expect(result.outcome).toBe("suppressed");
    expect(result.attempt_id).toBeNull();
    expect(result.idempotency_key).toBeNull();
    expect(rec.sent).toHaveLength(0);
    expect(await readNotices(PAGE_A)).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
  });

  it("(g) sends on the redelivery and re-uses its own notice row", async () => {
    const failing = recorder();
    failing.fail = new Error("boom");
    const first = await deliverIncident(envWith(bindingFor(failing)), message(INCIDENT_A));

    expect(first.outcome).toBe("failed");
    expect(first.attempt_id).toBeTruthy();
    expect(failing.sent).toHaveLength(0);
    expect((await readNotices(PAGE_A))).toHaveLength(1);
    expect((await readAttempts())[0].status).toBe("failed");
    expect((await readAttempts())[0].error).toContain("boom");

    const good = recorder();
    const second = await deliverIncident(envWith(bindingFor(good)), message(INCIDENT_A));

    expect(second.outcome).toBe("sent");
    expect(second.attempt_id).toBe(first.attempt_id);
    expect(good.sent).toHaveLength(1);
    expect((await readNotices(PAGE_A))).toHaveLength(1);
    const attempts = await readAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("sent");
    expect(attempts[0].error).toBeNull();
  });

  it("(h) acks an incident work item from the batch", async () => {
    const rec = recorder();
    const single = batchFor([message(INCIDENT_A)]);
    const results = await handleBatch(envWith(bindingFor(rec)), single.batch);

    expect(results[0].outcome).toBe("sent");
    expect(single.acked).toEqual([0]);
    expect(single.retried).toEqual([]);
    expect(rec.sent).toHaveLength(1);

    const dup = batchFor([JSON.stringify({ incident_id: INCIDENT_A })]);
    const dupResults = await handleBatch(envWith(bindingFor(rec)), dup.batch);

    expect(dupResults[0].outcome).toBe("duplicate");
    expect(dup.acked).toEqual([0]);
    expect(dup.retried).toEqual([]);
    expect(rec.sent).toHaveLength(1);
  });

  it("(i) sends nothing when own-site alerts are off, and keeps the alert row", async () => {
    await env.DB.prepare(`UPDATE workspace SET own_site_alerts = 0 WHERE id = ?`)
      .bind(WS)
      .run();
    const rec = recorder();

    const result = await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_A));

    expect(result.outcome).toBe("muted");
    expect(rec.sent).toHaveLength(0);
    const attempts = await env.DB.prepare(`SELECT count(*) AS n FROM send_attempt`).first<{
      n: number;
    }>();
    expect(attempts?.n).toBe(0);
    const notices = await env.DB.prepare(`SELECT count(*) AS n FROM incident_notice`).first<{
      n: number;
    }>();
    expect(notices?.n).toBe(0);
    const alerts = await env.DB.prepare(`SELECT count(*) AS n FROM alert WHERE incident_id = ?`)
      .bind(INCIDENT_A)
      .first<{ n: number }>();
    expect(alerts?.n).toBe(1);
  });

  it("returns no_incident when the incident row is gone", async () => {
    const rec = recorder();
    const result = await deliverIncident(envWith(bindingFor(rec)), message("incident-does-not-exist"));
    expect(result.outcome).toBe("no_incident");
    expect(rec.sent).toHaveLength(0);
    expect(await readNotices(PAGE_A)).toHaveLength(0);
  });

  it("(i) formats the seen moment in the workspace's timezone, not UTC (0509#4751)", async () => {
    await env.DB.prepare(`UPDATE workspace SET timezone = ? WHERE id = ?`).bind("Asia/Kolkata", WS).run();

    const rec = recorder();
    const result = await deliverIncident(envWith(bindingFor(rec)), message(INCIDENT_A));

    expect(result.outcome).toBe("sent");
    expect(rec.sent[0].text).toContain("Seen at Wed 23 Sept, 12:45.");
    expect(rec.sent[0].text).not.toContain("2026-09-23 07:15 UTC");
    expect(rec.sent[0].html).toContain("Seen at Wed 23 Sept, 12:45.");
    expect(rec.sent[0].html).not.toContain("2026-09-23 07:15 UTC");
  });
});
