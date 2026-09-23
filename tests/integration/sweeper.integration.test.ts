import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { sweepPending } from "../../workers/delivery/sweeper";

const WS = "ws-sweeper";

const seedWorkspace = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES ('user-sweeper', 'Reader', 'reader@0509.io', 1, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Sweeper', 'user-sweeper', 'UTC', 1, 8, '2026-09-22T00:00:00Z')`,
  )
    .bind(WS)
    .run();
};

const seedDigest = async (id: string, status: string, periodEnd: string) => {
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
     VALUES (?, ?, 'weekly', '2026-09-15', ?, ?, 'brief', '{}', NULL)`,
  )
    .bind(id, WS, periodEnd, status)
    .run();
};

const seedAttempt = async (id: string, digestId: string, status: string, attemptedAt: string) => {
  await env.DB.prepare(
    `INSERT INTO send_attempt
       (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?)`,
  )
    .bind(id, WS, digestId, `digest:${digestId}:${id}`, status, attemptedAt)
    .run();
};

const statuses = async (table: "digest" | "send_attempt") =>
  (
    await env.DB.prepare(`SELECT status FROM ${table} ORDER BY id ASC`).all<{ status: string }>()
  ).results?.map((row) => row.status) ?? [];

const queueFor = (sent: unknown[]) =>
  ({
    sendBatch: async (msgs: { body: unknown }[]) => {
      sent.push(...msgs.map((m) => m.body));
    },
  }) as unknown as Queue;

const envWith = (sent: unknown[]): Env => ({ ...env, SEND_EMAIL: queueFor(sent) }) as Env;

const NOW = new Date("2026-09-23T03:00:00.000Z");

describe("delivery sweeper (0509#4353)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.exec("DELETE FROM digest");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await seedWorkspace();
  });

  it("enqueues a stale pending digest and not a sent digest with the same period_end", async () => {
    await seedDigest("d-pending-stale", "pending", "2026-09-22T12:00:00.000Z");
    await seedDigest("d-sent-stale", "sent", "2026-09-22T12:00:00.000Z");
    const sent: unknown[] = [];

    const result = await sweepPending(envWith(sent), NOW);

    expect(sent).toEqual([{ digest_id: "d-pending-stale" }]);
    expect(result).toEqual({ digests: 1, attempts: 0, enqueued: 1 });
  });

  it("does not enqueue a pending digest that is only 3 hours old", async () => {
    await seedDigest("d-pending-fresh", "pending", "2026-09-23T00:00:00.000Z");
    const sent: unknown[] = [];

    const result = await sweepPending(envWith(sent), NOW);

    expect(sent).toEqual([]);
    expect(result).toEqual({ digests: 0, attempts: 0, enqueued: 0 });
  });

  it("enqueues a sent digest whose send_attempt has been pending for 2 hours", async () => {
    await seedDigest("d-sent-stuck", "sent", "2026-09-23T00:00:00.000Z");
    await seedAttempt("a-stuck", "d-sent-stuck", "pending", "2026-09-23T01:00:00.000Z");
    const sent: unknown[] = [];

    const result = await sweepPending(envWith(sent), NOW);

    expect(sent).toEqual([{ digest_id: "d-sent-stuck" }]);
    expect(result.attempts).toBe(1);
    expect(result.enqueued).toBe(1);
  });

  it("does not enqueue an attempt that has been pending for 30 minutes", async () => {
    await seedDigest("d-recent-attempt", "sent", "2026-09-23T00:00:00.000Z");
    await seedAttempt("a-recent", "d-recent-attempt", "pending", "2026-09-23T02:30:00.000Z");
    const sent: unknown[] = [];

    const result = await sweepPending(envWith(sent), NOW);

    expect(sent).toEqual([]);
    expect(result).toEqual({ digests: 0, attempts: 0, enqueued: 0 });
  });

  it("enqueues a digest that is both stale-pending and has a stale attempt exactly once", async () => {
    await seedDigest("d-both", "pending", "2026-09-22T12:00:00.000Z");
    await seedAttempt("a-both", "d-both", "pending", "2026-09-23T01:00:00.000Z");
    const sent: unknown[] = [];

    const result = await sweepPending(envWith(sent), NOW);

    expect(sent).toEqual([{ digest_id: "d-both" }]);
    expect(result).toEqual({ digests: 1, attempts: 1, enqueued: 1 });
  });

  it("writes nothing to digest or send_attempt", async () => {
    await seedDigest("d-pending-stale", "pending", "2026-09-22T12:00:00.000Z");
    await seedDigest("d-sent-stale", "sent", "2026-09-22T12:00:00.000Z");
    await seedAttempt("a-stuck", "d-sent-stale", "pending", "2026-09-23T01:00:00.000Z");
    const beforeDigests = await statuses("digest");
    const beforeAttempts = await statuses("send_attempt");
    const sent: unknown[] = [];

    await sweepPending(envWith(sent), NOW);

    expect(await statuses("digest")).toEqual(beforeDigests);
    expect(await statuses("send_attempt")).toEqual(beforeAttempts);
    expect(sent).toEqual([{ digest_id: "d-pending-stale" }, { digest_id: "d-sent-stale" }]);
  });
});
