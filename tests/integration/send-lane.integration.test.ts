import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deliver, handleBatch, type DigestMessage } from "../../workers/delivery/consumer";
import { sendOrThrow } from "../../workers/delivery/send";
import type { BriefPayload } from "../../app/lib/brief-payload";

interface Recorder {
  sent: EmailMessageBuilder[];
  fail: Error | null;
}

const recorder = (): Recorder => ({ sent: [], fail: null });

const bindingFor = (rec: Recorder): SendEmail => ({
  send(message: EmailMessage | EmailMessageBuilder) {
    if (rec.fail) throw rec.fail;
    rec.sent.push(message as EmailMessageBuilder);
    return Promise.resolve({ messageId: "stub-send-email" });
  },
});

const WS = "ws-send-lane";
const CHANNEL = "chan-email";
const TARGET = "reader@0509.io";
const TARGET_ID = "reader-target";

const seedWorkspace = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES ('user-one', 'Reader', 'reader@0509.io', 1, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Send lane', 'user-one', 'UTC', 1, 8, '2026-09-22T00:00:00Z')`,
  )
    .bind(WS)
    .run();
  await env.DB.prepare(
    "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?, ?, 'scout', 'trialing', '2026-09-22T00:00:00Z')",
  )
    .bind(`plan-${WS}`, WS)
    .run();
};

const seedChannel = async () => {
  await env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`)
    .bind(CHANNEL)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
     VALUES (?, ?, ?, ?, 1, '2026-09-22T00:00:01Z')`,
  )
    .bind(TARGET_ID, WS, CHANNEL, TARGET)
    .run();
};

const brief = (headlineRank: number): BriefPayload => ({
  workspace_id: WS,
  timezone: "UTC",
  period_start: "2026-09-15T08:00:00.000Z",
  period_end: "2026-09-22T08:00:00.000Z",
  headline_rank: headlineRank,
  headline_total: 9,
  headline_movement: 1,
  headline_is_new: false,
  why_line: "Quiet week: 3 mentions, no site changes, no new ads.",
  is_quiet_week: true,
  is_unjudged: false,
  read_this_first: [],
  brands: [],
  own_site: { status: "ok", incidents: [] },
  checked: {
    mention_count: 3,
    site_change_count: 0,
    new_ad_count: 0,
    source_keys: [],
    degraded_source_keys: [],
    degraded_sources: [],
  },
  next_brief_at: "2026-09-29T08:00:00.000Z",
});

const seedDigest = async (
  status = "pending",
  payload: BriefPayload = brief(2),
  subject: string | null = "You are #2 of 9 this week",
) => {
  const id = `digest-${Math.random().toString(36).slice(2, 10)}`;
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
     VALUES (?, ?, 'weekly', '2026-09-15', '2026-09-22', ?, ?, ?, NULL)`,
  )
    .bind(id, WS, status, subject, JSON.stringify(payload))
    .run();
  return id;
};

const seedMalformedPayloadDigest = async () => {
  const id = `digest-${Math.random().toString(36).slice(2, 10)}`;
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
     VALUES (?, ?, 'weekly', '2026-09-15', '2026-09-22', 'pending', 'You are #2 of 9 this week', ?, NULL)`,
  )
    .bind(id, WS, "<<not>> valid json {{{")
    .run();
  return id;
};

interface AttemptRow {
  id: string;
  workspace_id: string;
  send_target_id: string;
  digest_id: string;
  idempotency_key: string;
  status: string;
  error: string | null;
  attempted_at: string;
}

const readAttempts = async (): Promise<AttemptRow[]> =>
  (
    await env.DB.prepare(
      `SELECT id, workspace_id, send_target_id, digest_id, idempotency_key, status, error, attempted_at
         FROM send_attempt ORDER BY attempted_at ASC`,
    ).all<AttemptRow>()
  ).results ?? [];

const digestStatus = async (id: string) =>
  await env.DB.prepare(`SELECT status, sent_at FROM digest WHERE id = ?`).bind(id).first<{
    status: string;
    sent_at: string | null;
  }>();

const message = (digestId: string): DigestMessage => ({ digest_id: digestId });

const batchFor = (bodies: unknown[], attempts = 1) => {
  const acked: number[] = [];
  const retried: number[] = [];
  const retryOptions: unknown[] = [];
  const batch: MessageBatch = {
    queue: "send-email",
    messages: bodies.map((body, index) => ({
      id: `msg-${index}`,
      timestamp: new Date("2026-09-22T00:00:03Z"),
      body,
      attempts,
      ack: () => acked.push(index),
      retry: (options?: unknown) => {
        retried.push(index);
        retryOptions.push(options);
      },
    })),
    metadata: { metrics: { backlogCount: bodies.length, backlogBytes: 0 } },
    ackAll: () => acked.push(...bodies.map((_, index) => index)),
    retryAll: () => retried.push(...bodies.map((_, index) => index)),
  };
  return { batch, acked, retried, retryOptions };
};

const envWith = (email: SendEmail, queued: unknown[] = []): Env =>
  ({
    ...env,
    EMAIL: email,
    SEND_EMAIL: {
      sendBatch: (msgs: { body: unknown }[]) => {
        queued.push(...msgs.map((msg) => msg.body));
        return Promise.resolve();
      },
    },
  }) as unknown as Env;
describe("send lane (0509#3979)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.exec("DELETE FROM digest");
    await env.DB.exec("DELETE FROM send_target");
    await env.DB.exec("DELETE FROM channel");
    await env.DB.exec("DELETE FROM email_suppression");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await seedWorkspace();
    await seedChannel();
  });

  it("(a) sends a normal message and resolves the attempt to 'sent'", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending");

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("sent");
    expect(result.attempt_id).toBeTruthy();
    expect(result.idempotency_key).toBe(`digest:${digestId}:${TARGET_ID}`);
    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0].to).toBe(TARGET);
    expect(rec.sent[0].subject).toBe("You are #2 of 9 this week");

    const rows = await readAttempts();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].error).toBeNull();
    expect(rows[0].idempotency_key).toBe(result.idempotency_key);
    expect(new Date(rows[0].attempted_at).getTime()).not.toBeNaN();

    const digest = await digestStatus(digestId);
    expect(digest?.status).toBe("sent");
    expect(digest?.sent_at).not.toBeNull();
  });

  it("(b) does not send twice when the same message is re-enqueued", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending");

    const first = await deliver(envWith(bindingFor(rec)), message(digestId));
    expect(first.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(1);

    const second = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(second.outcome).toBe("duplicate");
    expect(second.attempt_id).toBeNull();
    expect(second.idempotency_key).toBe(first.idempotency_key);
    expect(rec.sent).toHaveLength(1);
    const rows = await readAttempts();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.attempt_id);
    expect(rows[0].status).toBe("sent");
  });

  const seedTeammate = (id: string, address: string, confirmed: boolean) =>
    env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role)
       VALUES (?, ?, ?, ?, ?, '2026-09-22T00:00:02Z', 'teammate')`,
    )
      .bind(id, WS, CHANNEL, address, confirmed ? 1 : 0)
      .run();

  it("(teammates) queues one message per confirmed teammate, and each sends once, never twice on a re-enqueue", async () => {
    const rec = recorder();
    const queued: unknown[] = [];
    const digestId = await seedDigest("pending");
    await seedTeammate("mate-1", "mate@0509.io", true);
    await seedTeammate("mate-2", "waiting@0509.io", false);
    await seedTeammate("mate-3", "gone@0509.io", true);
    await env.DB.prepare("INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'unsubscribed', ?)")
      .bind("gone@0509.io", "2026-09-23T00:00:00Z")
      .run();

    const first = await deliver(envWith(bindingFor(rec), queued), message(digestId));
    const second = await deliver(envWith(bindingFor(rec), queued), message(digestId));

    expect(first.outcome).toBe("sent");
    expect(second.outcome).toBe("duplicate");
    expect(rec.sent.map((mail) => mail.to)).toEqual([TARGET]);
    expect(queued).toContainEqual({ digest_id: digestId, target_id: "mate-1" });
    expect(queued).not.toContainEqual({ digest_id: digestId, target_id: "mate-2" });
    await handleBatch(envWith(bindingFor(rec)), batchFor(queued).batch);
    expect(rec.sent.map((mail) => mail.to).sort()).toEqual(["mate@0509.io", TARGET]);
    const rows = await readAttempts();
    expect(rows.map((row) => row.idempotency_key).sort()).toEqual(
      [`digest:${digestId}:${TARGET_ID}`, `digest:${digestId}:mate-1`].sort(),
    );
    const mail = rec.sent.find((sent) => sent.to === "mate@0509.io");
    expect(mail?.text).toMatch(/https:\/\/0509\.io\/u\/[0-9a-f]{64}/);
    const tokenIn = (to: string) =>
      /\/u\/([0-9a-f]{64})/.exec(rec.sent.find((sent) => sent.to === to)?.text ?? "")?.[1];
    expect(tokenIn("mate@0509.io")).not.toBe(tokenIn(TARGET));
    const ownerMail = rec.sent.find((sent) => sent.to === TARGET);
    expect(ownerMail?.text).toContain("/app/settings");
    expect(mail?.text).not.toContain("/app/settings");
    expect(mail?.html).not.toContain("/app/settings");
  });

  it("(teammates) a teammate removed while their message waits in the queue gets nothing", async () => {
    const rec = recorder();
    const digestId = await seedDigest("sent");
    await seedTeammate("mate-1", "mate@0509.io", true);
    const queued = batchFor([{ digest_id: digestId, target_id: "mate-1" }]);
    await env.DB.prepare("DELETE FROM send_target WHERE id = 'mate-1'").run();

    const results = await handleBatch(envWith(bindingFor(rec)), queued.batch);

    expect(results.map((result) => result.outcome)).toEqual(["no_target"]);
    expect(queued.acked).toEqual([0]);
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toEqual([]);
  });

  it("(teammates) a teammate removed after one brief is not queued or mailed for the next, and an alert never reaches them", async () => {
    const rec = recorder();
    const queued: unknown[] = [];
    const first = await seedDigest("pending");
    await seedTeammate("mate-1", "mate@0509.io", true);
    await deliver(envWith(bindingFor(rec), queued), message(first));
    await handleBatch(envWith(bindingFor(rec)), batchFor(queued).batch);
    expect(rec.sent.map((mail) => mail.to).sort()).toEqual(["mate@0509.io", TARGET]);

    await env.DB.prepare("DELETE FROM send_target WHERE id = 'mate-1'").run();
    const next = await seedDigest("pending");
    const nextQueued: unknown[] = [];
    const before = rec.sent.length;
    await deliver(envWith(bindingFor(rec), nextQueued), message(next));

    expect(nextQueued).toEqual([]);
    expect(rec.sent.slice(before).map((mail) => mail.to)).toEqual([TARGET]);
    expect(rec.sent.filter((mail) => mail.to === "mate@0509.io")).toHaveLength(1);
  });

  const failingFor = (rec: Recorder, address: string): SendEmail => ({
    send(mail: EmailMessage | EmailMessageBuilder) {
      if ((mail as EmailMessageBuilder).to === address) throw new Error("mailbox full");
      rec.sent.push(mail as EmailMessageBuilder);
      return Promise.resolve({ messageId: "stub-send-email" });
    },
  });

  it("(teammates) a failing teammate send never undoes the owner's brief", async () => {
    const digestId = await seedDigest("pending");
    await seedTeammate("mate-1", "mate@0509.io", true);
    const rec = recorder();
    const queued: unknown[] = [];
    const flaky = failingFor(rec, "mate@0509.io");

    const result = await deliver(envWith(flaky, queued), message(digestId));
    const mate = await handleBatch(envWith(flaky), batchFor(queued).batch);

    expect(result.outcome).toBe("sent");
    expect(mate.map((row) => row.outcome)).toEqual(["failed"]);
    expect((await digestStatus(digestId))?.status).toBe("sent");
    expect(rec.sent.map((mail) => mail.to)).toEqual([TARGET]);
    expect((await readAttempts()).find((row) => row.send_target_id === "mate-1")?.status).toBe("failed");
  });

  it("(teammates) a failed teammate message retries an hour later, twice at most, and then gives up quietly", async () => {
    const digestId = await seedDigest("sent");
    await seedTeammate("mate-1", "mate@0509.io", true);
    const failing = failingFor(recorder(), "mate@0509.io");
    const body = { digest_id: digestId, target_id: "mate-1" };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const run = async (attempts: number) => {
      const result = batchFor([body], attempts);
      await handleBatch(envWith(failing), result.batch);
      return result;
    };
    const first = await run(1);
    const second = await run(2);
    const third = await run(3);

    expect(first.retried).toEqual([0]);
    expect(first.retryOptions).toEqual([{ delaySeconds: 3600 }]);
    expect(second.retryOptions).toEqual([{ delaySeconds: 3600 }]);
    expect(third.retried).toEqual([]);
    expect(third.acked).toEqual([0]);
    const lines = log.mock.calls.map((call) => String(call[0]));
    log.mockRestore();
    expect(lines.some((line) => line.includes("delivery.teammate_gave_up"))).toBe(true);
    expect((await digestStatus(digestId))?.status).toBe("sent");
  });

  it("(teammates) a redelivered owner message queues only teammates with no attempt yet", async () => {
    const digestId = await seedDigest("pending");
    await seedTeammate("mate-1", "mate@0509.io", true);
    await seedTeammate("mate-2", "other@0509.io", true);
    const rec = recorder();
    const queued: unknown[] = [];
    await deliver(envWith(bindingFor(rec), queued), message(digestId));
    await handleBatch(
      envWith(failingFor(rec, "mate@0509.io")),
      batchFor([{ digest_id: digestId, target_id: "mate-1" }], 3).batch,
    );

    const again: unknown[] = [];
    const redelivered = await deliver(envWith(bindingFor(rec), again), message(digestId));

    expect(redelivered.outcome).toBe("duplicate");
    expect(again).toEqual([{ digest_id: digestId, target_id: "mate-2" }]);
  });

  it("(teammates) a retry that works sends once and settles the message", async () => {
    const digestId = await seedDigest("sent");
    await seedTeammate("mate-1", "mate@0509.io", true);
    const body = { digest_id: digestId, target_id: "mate-1" };
    await handleBatch(envWith(failingFor(recorder(), "mate@0509.io")), batchFor([body], 1).batch);
    const rec = recorder();

    const retry = batchFor([body], 2);
    await handleBatch(envWith(bindingFor(rec)), retry.batch);

    expect(retry.acked).toEqual([0]);
    expect(rec.sent.map((mail) => mail.to)).toEqual(["mate@0509.io"]);
    expect((await readAttempts()).find((row) => row.send_target_id === "mate-1")?.status).toBe("sent");
  });

  it("(teammates) a teammate waits while another worker still holds the owner's send", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending");
    await seedTeammate("mate-1", "mate@0509.io", true);
    await env.DB.prepare(
      `INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
       VALUES ('held', ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(WS, TARGET_ID, digestId, `digest:${digestId}:${TARGET_ID}`, new Date().toISOString())
      .run();

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("duplicate");
    expect(rec.sent).toHaveLength(0);
  });

  it("(teammates) nobody else gets the brief when the owner's send fails", async () => {
    const rec = recorder();
    rec.fail = new Error("smtp down");
    const digestId = await seedDigest("pending");
    await seedTeammate("mate-1", "mate@0509.io", true);

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("failed");
    expect(rec.sent).toHaveLength(0);
    expect((await readAttempts()).map((row) => row.send_target_id)).toEqual([TARGET_ID]);
  });

  it("(stale) re-claims a pending attempt older than 1 hour and sends once", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending");
    const attemptedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO send_attempt
         (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
       VALUES ('stale-1', ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(WS, TARGET_ID, digestId, `digest:${digestId}:${TARGET_ID}`, attemptedAt)
      .run();

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(1);
    const rows = await readAttempts();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].id).toBe("stale-1");
  });

  it("(fresh) a pending attempt younger than 1 hour is a duplicate", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending");
    const attemptedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO send_attempt
         (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
       VALUES ('stale-1', ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(WS, TARGET_ID, digestId, `digest:${digestId}:${TARGET_ID}`, attemptedAt)
      .run();

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("duplicate");
    expect(rec.sent).toHaveLength(0);
    const rows = await readAttempts();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].id).toBe("stale-1");
  });

  it("(b2) retries a failed attempt and sends on the redelivery", async () => {
    const digestId = await seedDigest("pending");
    const failed = recorder();
    failed.fail = new Error("Email Service rejected the send");

    const first = await deliver(envWith(bindingFor(failed)), message(digestId));
    expect(first.outcome).toBe("failed");
    expect(failed.sent).toHaveLength(0);
    let rows = await readAttempts();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("Email Service rejected the send");

    const good = recorder();
    const second = await deliver(envWith(bindingFor(good)), message(digestId));
    expect(second.outcome).toBe("sent");
    expect(second.attempt_id).toBe(first.attempt_id);
    expect(good.sent).toHaveLength(1);
    rows = await readAttempts();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].error).toBeNull();
  });

  it("(c) skips a suppressed address before rendering and inserts no attempt row", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending");
    await env.DB.prepare(
      `INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'unsubscribed', '2026-09-22T00:00:02Z')`,
    )
      .bind(TARGET)
      .run();

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("suppressed");
    expect(result.attempt_id).toBeNull();
    expect(result.idempotency_key).toBeNull();
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
    expect((await digestStatus(digestId))?.status).toBe("pending");
  });

  it("(c-case) skips a target whose suppression was stored with different capitals", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending");
    await env.DB.prepare(
      `INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'unsubscribed', '2026-09-22T00:00:02Z')`,
    )
      .bind(TARGET.toUpperCase())
      .run();

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("suppressed");
    expect(rec.sent).toHaveLength(0);
  });

  it("never records 'delivered' any path", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending");
    await deliver(envWith(bindingFor(rec)), message(digestId));
    const rows = await readAttempts();
    expect(rows.map((r) => r.status)).not.toContain("delivered");
  });

  it("resolves the attempt to 'failed' when a producer's payload is not JSON", async () => {
    const rec = recorder();
    const digestId = await seedMalformedPayloadDigest();

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("failed");
    expect(result.attempt_id).toBeTruthy();
    expect(rec.sent).toHaveLength(0);
    const rows = await readAttempts();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toBeTruthy();
    expect((await digestStatus(digestId))?.status).toBe("pending");
  });

  it("reclaims a failed attempt after a bad payload and still sends nothing", async () => {
    const rec = recorder();
    const digestId = await seedMalformedPayloadDigest();

    const first = await deliver(envWith(bindingFor(rec)), message(digestId));
    expect(first.outcome).toBe("failed");

    const second = await deliver(envWith(bindingFor(rec)), message(digestId));
    expect(second.outcome).toBe("failed");
    expect(second.attempt_id).toBe(first.attempt_id);
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(1);
  });

  it("never leaves a sent attempt reclaimable when a post-send write throws", async () => {
    const digestId = await seedDigest("pending");
    const rec = recorder();

    const realPrepare = env.DB.prepare.bind(env.DB);
    const failing = new Proxy(env, {
      get(target, property) {
        if (property === "DB") {
          return new Proxy(target.DB, {
            get(dbTarget, dbProperty) {
              if (dbProperty === "prepare") {
                return (query: string) => {
                  if (query.includes("UPDATE digest")) {
                    throw new Error("D1 unavailable while marking the digest sent");
                  }
                  return realPrepare(query);
                };
              }
              return Reflect.get(dbTarget, dbProperty) as unknown;
            },
          }) as D1Database;
        }
        if (property === "EMAIL") return bindingFor(rec);
        return Reflect.get(target, property) as unknown;
      },
    }) as Env;

    const rowsBefore = await readAttempts().then((rows) => rows.length);

    await expect(deliver(failing, message(digestId))).rejects.toThrow("D1 unavailable while marking the digest sent");

    expect(rec.sent).toHaveLength(1);
    const rows = await readAttempts();
    expect(rows).toHaveLength(rowsBefore + 1);
    const row = rows[0];
    expect(row.status).toBe("sent");

    const second = await deliver(envWith(bindingFor(rec)), message(digestId));
    expect(second.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(1);
    const third = await deliver(envWith(bindingFor(rec)), message(digestId));
    expect(third.outcome).toBe("duplicate");
  });

  it("never sends a brief twice when the sent-write fails and the claim goes stale", async () => {
    const digestId = await seedDigest("pending");
    const rec = recorder();

    const realPrepare = env.DB.prepare.bind(env.DB);
    const failing = new Proxy(env, {
      get(target, property) {
        if (property === "DB") {
          return new Proxy(target.DB, {
            get(dbTarget, dbProperty) {
              if (dbProperty === "prepare") {
                return (query: string) => {
                  if (query.startsWith("UPDATE send_attempt SET status = ?")) {
                    throw new Error("D1 unavailable while resolving the attempt");
                  }
                  return realPrepare(query);
                };
              }
              return Reflect.get(dbTarget, dbProperty) as unknown;
            },
          }) as D1Database;
        }
        if (property === "EMAIL") return bindingFor(rec);
        return Reflect.get(target, property) as unknown;
      },
    }) as Env;

    await expect(deliver(failing, message(digestId))).rejects.toThrow("D1 unavailable while resolving the attempt");
    expect(rec.sent).toHaveLength(1);
    expect((await readAttempts())[0].status).toBe("pending");

    await env.DB.prepare("UPDATE send_attempt SET attempted_at = '2000-01-01T00:00:00Z'").run();
    const retry = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(rec.sent).toHaveLength(1);
    expect(retry.outcome).toBe("sent");
    expect((await readAttempts())[0].status).toBe("sent");
    expect((await digestStatus(digestId))?.status).toBe("sent");
  });

  it("returns no_digest for a work item whose digest row is gone", async () => {
    const rec = recorder();
    const result = await deliver(envWith(bindingFor(rec)), message("digest-does-not-exist"));
    expect(result.outcome).toBe("no_digest");
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
  });

  it("never sends a brief the dead-letter queue marked failed (0509#4375)", async () => {
    const rec = recorder();
    const digestId = await seedDigest("failed");
    const result = await deliver(envWith(bindingFor(rec)), message(digestId));
    expect(result.outcome).toBe("no_digest");
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
  });

  it("reports no_target when the workspace has no email target", async () => {
    const rec = recorder();
    await env.DB.exec("DELETE FROM send_target");
    const digestId = await seedDigest("pending");
    const result = await deliver(envWith(bindingFor(rec)), message(digestId));
    expect(result.outcome).toBe("no_target");
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
  });

  it.each([
    ["no_row", "DELETE FROM send_target"],
    ["unverified", "UPDATE send_target SET is_verified = 0"],
    ["channel_disabled", "UPDATE channel SET is_enabled = 0"],
  ])("logs delivery.no_target with reason %s", async (reason, statement) => {
    await env.DB.exec(statement);
    const digestId = await seedDigest("pending");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await deliver(envWith(bindingFor(recorder())), message(digestId));

    const lines = log.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    log.mockRestore();
    expect(lines).toContainEqual({ event: "delivery.no_target", digest_id: digestId, workspace_id: WS, reason });
  });

  it("(teammates) an older confirmed teammate never stands in for an unverified owner", async () => {
    const rec = recorder();
    await env.DB.prepare(`UPDATE send_target SET is_verified = 0 WHERE id = ?`).bind(TARGET_ID).run();
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role)
       VALUES ('mate-old', ?, ?, 'mate@0509.io', 1, '2000-01-01T00:00:00Z', 'teammate')`,
    )
      .bind(WS, CHANNEL)
      .run();
    const digestId = await seedDigest("pending");

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("no_target");
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
  });

  it("reports no_target when the only email target is unverified", async () => {
    const rec = recorder();
    await env.DB.prepare(`UPDATE send_target SET is_verified = 0 WHERE id = ?`).bind(TARGET_ID).run();
    const digestId = await seedDigest("pending");

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("no_target");
    expect(result.attempt_id).toBeNull();
    expect(result.idempotency_key).toBeNull();
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
    expect((await digestStatus(digestId))?.status).toBe("pending");
  });

  it("acks a duplicate and retries a failed send from the batch", async () => {
    const digestId = await seedDigest("pending");
    const normal = recorder();
    await deliver(envWith(bindingFor(normal)), message(digestId));

    const duplicate = batchFor([message(digestId)]);
    const results = await handleBatch(envWith(bindingFor(recorder())), duplicate.batch);
    expect(results[0].outcome).toBe("duplicate");
    expect(duplicate.acked).toEqual([0]);
    expect(duplicate.retried).toEqual([]);
    expect(normal.sent).toHaveLength(1);

    const failingDigest = await seedDigest("pending");
    const failed = recorder();
    failed.fail = new Error("throttled");
    const failBatch = batchFor([message(failingDigest)]);
    const failResults = await handleBatch(envWith(bindingFor(failed)), failBatch.batch);
    expect(failResults[0].outcome).toBe("failed");
    expect(failBatch.retried).toEqual([0]);
    expect(failBatch.acked).toEqual([]);
  });

  it("ignores a work item with no digest_id and a string body carries the id", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending");
    const junk = batchFor([{ nope: true }, JSON.stringify({ digest_id: digestId })]);
    const results = await handleBatch(envWith(bindingFor(rec)), junk.batch);
    expect(results[0].outcome).toBe("no_digest");
    expect(results[1].outcome).toBe("sent");
    expect(junk.acked).toEqual([0, 1]);
    expect(rec.sent).toHaveLength(1);
  });

  it("renders the stored brief, with its own subject when the row has none", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending", brief(3), null);

    const result = await deliver(envWith(bindingFor(rec)), message(digestId));

    expect(result.outcome).toBe("sent");
    expect(rec.sent[0].subject).toBe("Quiet week: you're #3 of 9");
    expect(rec.sent[0].text).toContain("You're #3 of 9 this week");
    expect(rec.sent[0].text).toContain("Quiet week: 3 mentions");
    expect(rec.sent[0].text).toMatch(/Unsubscribe: https:\/\/0509\.io\/u\/[0-9a-f]{64}/);
    expect(rec.sent[0].html).toContain("<!doctype html>");
  });

  it("stamps a stable RFC 8058 unsubscribe token on every send", async () => {
    const rec = recorder();
    const firstId = await seedDigest("pending");

    const first = await deliver(envWith(bindingFor(rec)), message(firstId));
    expect(first.outcome).toBe("sent");

    const stored = await env.DB.prepare(`SELECT unsubscribe_token FROM send_target WHERE id = 'reader-target'`).first<{
      unsubscribe_token: string | null;
    }>();
    const token = stored?.unsubscribe_token ?? "";
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.sent[0].headers).toEqual({
      "List-Unsubscribe": `<https://0509.io/u/${token}?type=brief>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });

    const secondId = await seedDigest("pending");
    const second = await deliver(envWith(bindingFor(rec)), message(secondId));
    expect(second.outcome).toBe("sent");
    expect(rec.sent[1].headers).toEqual({
      "List-Unsubscribe": `<https://0509.io/u/${token}?type=brief>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("sendOrThrow rejects a provider failure and resolves a delivered send", async () => {
    const rec = recorder();
    rec.fail = new Error("magic-link rejected");
    await expect(
      sendOrThrow(bindingFor(rec), { to: TARGET, from: "hello@0509.io", subject: "Sign in", text: "link" }),
    ).rejects.toThrow("magic-link rejected");

    const good = recorder();
    await sendOrThrow(bindingFor(good), { to: TARGET, from: "hello@0509.io", subject: "Sign in", text: "link" });
    expect(good.sent).toHaveLength(1);
  });
});
