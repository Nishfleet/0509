import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { deliver, handleBatch, type DeliveryMessage } from "../../workers/delivery/consumer";
import { sendOrThrow } from "../../workers/delivery/send";

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
};

const seedChannel = async () => {
  await env.DB.prepare(
    `INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`,
  )
    .bind(CHANNEL)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
     VALUES (?, ?, ?, ?, 1, '2026-09-22T00:00:01Z')`,
  )
    .bind(TARGET_ID, WS, CHANNEL, TARGET)
    .run();
};

const seedDigest = async (status = "pending", payload: Record<string, unknown> = {}) => {
  const id = `digest-${Math.random().toString(36).slice(2, 10)}`;
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
     VALUES (?, ?, 'weekly', '2026-09-15', '2026-09-22', ?, 'You are #2 of 9 this week', ?, NULL)`,
  )
    .bind(id, WS, status, JSON.stringify(payload))
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

const message = (digestId: string): DeliveryMessage => ({ digest_id: digestId });

const batchFor = (bodies: unknown[]) => {
  const acked: number[] = [];
  const retried: number[] = [];
  const batch: MessageBatch = {
    queue: "send-email",
    messages: bodies.map((body, index) => ({
      id: `msg-${index}`,
      timestamp: new Date("2026-09-22T00:00:03Z"),
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
    const digestId = await seedDigest("pending", {
      html: "<p>You are #2 of 9 this week.</p>",
      text: "You are #2 of 9 this week.",
    });

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
    const digestId = await seedDigest("pending", { text: "brief" });

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

  it("(stale) re-claims a pending attempt older than 1 hour and sends once", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending", { html: "<p>x</p>", text: "x" });
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
    const digestId = await seedDigest("pending", { html: "<p>x</p>", text: "x" });
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
    const digestId = await seedDigest("pending", { text: "brief" });
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
    const digestId = await seedDigest("pending", { html: "<p>brief</p>", text: "brief" });
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

  it("never records 'delivered' any path", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending", { text: "brief" });
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
    const digestId = await seedDigest("pending", { text: "brief" });
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
    expect(second.outcome).toBe("duplicate");
    expect(rec.sent).toHaveLength(1);
  });

  it("returns no_digest for a work item whose digest row is gone", async () => {
    const rec = recorder();
    const result = await deliver(envWith(bindingFor(rec)), message("digest-does-not-exist"));
    expect(result.outcome).toBe("no_digest");
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
  });

  it("reports no_target when the workspace has no email target", async () => {
    const rec = recorder();
    await env.DB.exec("DELETE FROM send_target");
    const digestId = await seedDigest("pending", { text: "brief" });
    const result = await deliver(envWith(bindingFor(rec)), message(digestId));
    expect(result.outcome).toBe("no_target");
    expect(rec.sent).toHaveLength(0);
    expect(await readAttempts()).toHaveLength(0);
  });

  it("acks a duplicate and retries a failed send from the batch", async () => {
    const digestId = await seedDigest("pending", { text: "brief" });
    const normal = recorder();
    await deliver(envWith(bindingFor(normal)), message(digestId));

    const duplicate = batchFor([message(digestId)]);
    const results = await handleBatch(envWith(bindingFor(recorder())), duplicate.batch);
    expect(results[0].outcome).toBe("duplicate");
    expect(duplicate.acked).toEqual([0]);
    expect(duplicate.retried).toEqual([]);
    expect(normal.sent).toHaveLength(1);

    const failingDigest = await seedDigest("pending", { text: "again" });
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
    const digestId = await seedDigest("pending", { text: "brief" });
    const junk = batchFor([{ nope: true }, JSON.stringify({ digest_id: digestId })]);
    const results = await handleBatch(envWith(bindingFor(rec)), junk.batch);
    expect(results[0].outcome).toBe("no_digest");
    expect(results[1].outcome).toBe("sent");
    expect(junk.acked).toEqual([0, 1]);
    expect(rec.sent).toHaveLength(1);
  });

  it("stamps a stable RFC 8058 unsubscribe token on every send", async () => {
    const rec = recorder();
    const firstId = await seedDigest("pending", {
      html: "<p>You are #2 of 9 this week.</p>",
      text: "You are #2 of 9 this week.",
    });

    const first = await deliver(envWith(bindingFor(rec)), message(firstId));
    expect(first.outcome).toBe("sent");

    const stored = await env.DB.prepare(
      `SELECT unsubscribe_token FROM send_target WHERE id = 'reader-target'`,
    ).first<{ unsubscribe_token: string | null }>();
    const token = stored?.unsubscribe_token ?? "";
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.sent[0].headers).toEqual({
      "List-Unsubscribe": `<https://0509.io/u/${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });

    const secondId = await seedDigest("pending", {
      html: "<p>You are #3 of 9 this week.</p>",
      text: "You are #3 of 9 this week.",
    });
    const second = await deliver(envWith(bindingFor(rec)), message(secondId));
    expect(second.outcome).toBe("sent");
    expect(rec.sent[1].headers).toEqual({
      "List-Unsubscribe": `<https://0509.io/u/${token}>`,
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
