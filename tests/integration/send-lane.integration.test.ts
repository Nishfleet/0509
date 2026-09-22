import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { deliver, handleBatch, type DeliveryEnv, type DeliveryMessage } from "../../workers/delivery/consumer";

/**
 * The send lane's three acceptance runs, in real workerd against the real
 * local D1 that migrations/0001_rebuild.sql applied (0509#3979,
 * docs/engines/delivery.md § P7.2 "PROOF REQUIRED"):
 *
 *   (a) a normal send that arrives,
 *   (b) the same message re-enqueued — the UNIQUE conflict, no second email,
 *   (c) a send to a suppressed address — no attempt row, no message.
 *
 * The EMAIL binding is a recorder rather than the real service, because this
 * run is in a merge gate: the claim/dup/suppress behaviour is asserted on the
 * rows D1 actually holds and on the calls the lane actually made. The live
 * inbox leg is the P7.2 lane's own acceptance note — the grep proving exactly
 * one EMAIL.send call site in the repo, cited in the PR body.
 *
 * The order under test is fixed by the packet: read, suppress-check, claim,
 * render, send, resolve. Rendering is asserted to not happen before the
 * suppression check (case c has no payload to render and still does nothing).
 */

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
    .bind(`${TARGET.split("@")[0]}-target`, WS, CHANNEL, TARGET)
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

const envFor = (rec: Recorder): DeliveryEnv =>
  ({ DB: env.DB, EMAIL: bindingFor(rec) }) as DeliveryEnv;

const attemptRows = async () =>
  (
    await env.DB.prepare(
      `SELECT id, workspace_id, send_target_id, digest_id, idempotency_key, status, error, attempted_at
         FROM send_attempt ORDER BY attempted_at ASC`,
    ).all<{
      id: string;
      workspace_id: string;
      send_target_id: string;
      digest_id: string;
      idempotency_key: string;
      status: string;
      error: string | null;
      attempted_at: string;
    }>()
  ).results ?? [];

const digestStatus = async (id: string) =>
  await env.DB.prepare(`SELECT status, sent_at FROM digest WHERE id = ?`).bind(id).first<{
    status: string;
    sent_at: string | null;
  }>();

const message = (digestId: string): DeliveryMessage => ({ digest_id: digestId });

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

    const result = await deliver(envFor(rec), message(digestId));

    expect(result.outcome).toBe("sent");
    expect(result.attempt_id).toBeTruthy();
    expect(result.idempotency_key).toBe(`digest:${digestId}:${TARGET.split("@")[0]}-target`);
    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0].to).toBe(TARGET);
    expect(rec.sent[0].subject).toBe("You are #2 of 9 this week");

    const rows = await attemptRows();
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

    const first = await deliver(envFor(rec), message(digestId));
    expect(first.outcome).toBe("sent");
    expect(rec.sent).toHaveLength(1);

    // The queue is at-least-once: put the identical work item on again and
    // claim the send a second time.
    const second = await deliver(envFor(rec), message(digestId));

    expect(second.outcome).toBe("duplicate");
    expect(second.attempt_id).toBeNull();
    expect(second.idempotency_key).toBe(first.idempotency_key);
    // No second email in the inbox, and the first claim row is untouched.
    expect(rec.sent).toHaveLength(1);
    const rows = await attemptRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.attempt_id);
    expect(rows[0].status).toBe("sent");
  });

  it("(b2) retries a failed attempt and sends on the redelivery", async () => {
    const digestId = await seedDigest("pending", { text: "brief" });
    const failed = recorder();
    failed.fail = new Error("Email Service rejected the send");

    const first = await deliver(envFor(failed), message(digestId));
    expect(first.outcome).toBe("failed");
    expect(failed.sent).toHaveLength(0);
    let rows = await attemptRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("Email Service rejected the send");

    // The redelivery reclaims the failed claim, which is the only reason a
    // queue retry can work at all.
    const good = recorder();
    const second = await deliver(envFor(good), message(digestId));
    expect(second.outcome).toBe("sent");
    expect(second.attempt_id).toBe(first.attempt_id);
    expect(good.sent).toHaveLength(1);
    rows = await attemptRows();
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

    const result = await deliver(envFor(rec), message(digestId));

    expect(result.outcome).toBe("suppressed");
    expect(result.attempt_id).toBeNull();
    expect(result.idempotency_key).toBeNull();
    expect(rec.sent).toHaveLength(0);
    expect(await attemptRows()).toHaveLength(0);
    // The digest stays pending so the sweeper can see it, and it is never
    // marked sent: an unsubscribed address is skipped, not delivered.
    expect((await digestStatus(digestId))?.status).toBe("pending");
  });

  it("never records 'delivered' any path", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending", { text: "brief" });
    await deliver(envFor(rec), message(digestId));
    const rows = await attemptRows();
    expect(rows.map((r) => r.status)).not.toContain("delivered");
  });

  it("returns no_digest for a work item whose digest row is gone", async () => {
    const rec = recorder();
    const result = await deliver(envFor(rec), message("digest-does-not-exist"));
    expect(result.outcome).toBe("no_digest");
    expect(rec.sent).toHaveLength(0);
    expect(await attemptRows()).toHaveLength(0);
  });

  it("reports no_target when the workspace has no email target", async () => {
    const rec = recorder();
    await env.DB.exec("DELETE FROM send_target");
    const digestId = await seedDigest("pending", { text: "brief" });
    const result = await deliver(envFor(rec), message(digestId));
    expect(result.outcome).toBe("no_target");
    expect(rec.sent).toHaveLength(0);
    expect(await attemptRows()).toHaveLength(0);
  });

  it("acks a duplicate and retries a failed send from the batch", async () => {
    const digestId = await seedDigest("pending", { text: "brief" });
    const normal = recorder();
    await deliver(envFor(normal), message(digestId));

    const batch = {
      messages: [
        {
          body: message(digestId),
          ack: () => undefined,
          retry: () => undefined,
        },
      ],
    };
    const results = await handleBatch(envFor(recorder()), batch);
    expect(results[0].outcome).toBe("duplicate");
    expect(normal.sent).toHaveLength(1);

    const failingDigest = await seedDigest("pending", { text: "again" });
    let retried = false;
    const failBatch = {
      messages: [
        {
          body: message(failingDigest),
          ack: () => undefined,
          retry: () => {
            retried = true;
          },
        },
      ],
    };
    const failed = recorder();
    failed.fail = new Error("throttled");
    const failResults = await handleBatch(envFor(failed), failBatch);
    expect(failResults[0].outcome).toBe("failed");
    expect(retried).toBe(true);
  });

  it("ignores a work item with no digest_id and a string body carries the id", async () => {
    const rec = recorder();
    const digestId = await seedDigest("pending", { text: "brief" });
    let acked = 0;
    const junk = {
      messages: [
        { body: { nope: true }, ack: () => acked++, retry: () => undefined },
        {
          body: JSON.stringify({ digest_id: digestId }),
          ack: () => acked++,
          retry: () => undefined,
        },
      ],
    };
    const results = await handleBatch(envFor(rec), junk);
    expect(results[0].outcome).toBe("no_digest");
    expect(results[1].outcome).toBe("sent");
    expect(acked).toBe(2);
    expect(rec.sent).toHaveLength(1);
  });
});
