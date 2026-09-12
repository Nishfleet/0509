// Integration test for the account-deletion sweep (issue #3168).
//
// Runs against the real local D1 built by applying the repo's
// migrations/*.sql via tests/integration/apply-migrations.ts. Exercises:
//   1. Inserting a pending deletion with a past scheduled_for is picked up.
//   2. The hard delete cascades across the user-keyed tables listed in
//      ACCOUNT_DELETION_CASCADE_TABLES (smoke: seed rows, run sweep, assert
//      every seeded row is gone).
//   3. The audit row (account_deletion_request) lands on 'completed'.
//   4. A row that is still in the grace window is NOT swept.

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import {
  ACCOUNT_DELETION_CASCADE_TABLES,
  insertPendingAccountDeletion,
  readAccountDeletionById,
  runAccountDeletionSweep,
} from "~/lib/account-self-serve.server";

import "./apply-migrations";

const ISO_T0 = "2026-01-01T00:00:00.000Z";

async function seedUser(id: string) {
  await env.DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, `Fixture ${id}`, `${id}@example.test`, ISO_T0, ISO_T0)
    .run();
}

async function seedWatchlist(id: string, userId: string) {
  await env.DB.prepare(
    `INSERT INTO watchlist (
       id, user_id, name, target_type, target_id, target_fingerprint,
       target_label, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, userId, `Fixture ${id}`, `target_${id}`, `fp_${id}`, `Label ${id}`, ISO_T0, ISO_T0)
    .run();
}

async function seedPasskey(id: string, userId: string) {
  await env.DB.prepare(
    `INSERT INTO passkey (id, userId, publicKey, credentialID, counter, deviceType, backedUp, createdAt)
     VALUES (?, ?, ?, ?, 0, 'platform', 0, ?)`,
  )
    .bind(id, userId, `pk_${id}`, `cred_${id}`, ISO_T0)
    .run();
}

async function seedSession(id: string, userId: string) {
  await env.DB.prepare(
    `INSERT INTO session (
       id, userId, expiresAt, token, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, ISO_T0, `tok_${id}`, ISO_T0, ISO_T0)
    .run();
}

describe("account-self-serve: hard-delete sweep", () => {
  it("cascades a user past their grace window and marks the audit row completed", async () => {
    const userId = `sweep_user_${crypto.randomUUID().slice(0, 8)}`;
    const watchlistId = `sweep_wl_${crypto.randomUUID().slice(0, 8)}`;
    const passkeyId = `sweep_pk_${crypto.randomUUID().slice(0, 8)}`;
    const sessionId = `sweep_session_${crypto.randomUUID().slice(0, 8)}`;
    const deletionId = `sweep_del_${crypto.randomUUID().slice(0, 8)}`;

    await seedUser(userId);
    await seedWatchlist(watchlistId, userId);
    await seedPasskey(passkeyId, userId);
    await seedSession(sessionId, userId);

    // Schedule the deletion in the past so the sweep picks it up.
    const pastScheduled = new Date(Date.parse(ISO_T0) - 60_000).toISOString();
    await insertPendingAccountDeletion(env as never, {
      cancelTokenHash: null,
      cancelTokenExpiresAt: null,
      emailAtRequest: `${userId}@example.test`,
      id: deletionId,
      requestedAt: ISO_T0,
      scheduledFor: pastScheduled,
      userId,
    });

    const result = await runAccountDeletionSweep(env as never, {
      now: new Date(ISO_T0),
    });

    expect(result.scannedDue).toBeGreaterThanOrEqual(1);
    expect(result.hardDeleted).toBeGreaterThanOrEqual(1);

    const audit = await readAccountDeletionById(env as never, deletionId);
    expect(audit?.status).toBe("completed");

    // The user row and all seeded dependents must be gone.
    const userRow = await env.DB.prepare("SELECT id FROM user WHERE id = ?").bind(userId).first();
    expect(userRow).toBeNull();
    const watchRow = await env.DB.prepare("SELECT id FROM watchlist WHERE id = ?").bind(watchlistId).first();
    expect(watchRow).toBeNull();
    const pkRow = await env.DB.prepare("SELECT id FROM passkey WHERE id = ?").bind(passkeyId).first();
    expect(pkRow).toBeNull();
    const sessionRow = await env.DB.prepare("SELECT id FROM session WHERE id = ?").bind(sessionId).first();
    expect(sessionRow).toBeNull();
  });

  it("skips a deletion that is still inside the grace window", async () => {
    const userId = `grace_user_${crypto.randomUUID().slice(0, 8)}`;
    const watchlistId = `grace_wl_${crypto.randomUUID().slice(0, 8)}`;
    const deletionId = `grace_del_${crypto.randomUUID().slice(0, 8)}`;

    await seedUser(userId);
    await seedWatchlist(watchlistId, userId);
    // 7 days in the future — well outside the grace cutoff.
    const futureScheduled = new Date(Date.parse(ISO_T0) + 7 * 24 * 60 * 60 * 1000).toISOString();
    await insertPendingAccountDeletion(env as never, {
      cancelTokenHash: null,
      cancelTokenExpiresAt: null,
      emailAtRequest: `${userId}@example.test`,
      id: deletionId,
      requestedAt: ISO_T0,
      scheduledFor: futureScheduled,
      userId,
    });

    const result = await runAccountDeletionSweep(env as never, {
      now: new Date(ISO_T0),
    });

    // We never asserted scannedDue=0 (other tests in this file may have
    // queued deletes) but our pending request must NOT be processed.
    const audit = await readAccountDeletionById(env as never, deletionId);
    expect(audit?.status).toBe("pending");
    const userRow = await env.DB.prepare("SELECT id FROM user WHERE id = ?").bind(userId).first();
    expect(userRow).not.toBeNull();
  });

  it("every ACCOUNT_DELETION_CASCADE_TABLES table referenced by a seeded row is actually deleted", async () => {
    // Smoke test for the cascade list: pick a representative subset and
    // prove the sweep removes their rows. The full list is verified by
    // tests/account-self-serve-cascade.test.ts; this test just proves the
    // sweep itself works for them.
    const userId = `cascade_user_${crypto.randomUUID().slice(0, 8)}`;
    const deletionId = `cascade_del_${crypto.randomUUID().slice(0, 8)}`;
    await seedUser(userId);

    const sample: Array<readonly [string, string, ...string[]]> = [
      ["watchlist", `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`, `wl_${userId}`, userId, `Fixture ${userId}`, `target_${userId}`, `fp_${userId}`, `Label ${userId}`, ISO_T0, ISO_T0],
      ["user_plan", `INSERT INTO user_plan (user_id, plan, plan_updated_at, dodo_status, dodo_customer_id) VALUES (?, 'scout', ?, 'subscription.active', ?)`, userId, ISO_T0, `cust_${userId}`],
      ["session", `INSERT INTO session (id, userId, expiresAt, token, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`, `sess_${userId}`, userId, ISO_T0, `tok_${userId}`, ISO_T0, ISO_T0],
      ["passkey", `INSERT INTO passkey (id, userId, publicKey, credentialID, counter, deviceType, backedUp, createdAt) VALUES (?, ?, ?, ?, 0, 'platform', 0, ?)`, `pk_${userId}`, userId, `pub_${userId}`, `cred_${userId}`, ISO_T0],
    ];

    for (const [table, sql, ...binds] of sample) {
      // The table name appears in ACCOUNT_DELETION_CASCADE_TABLES — fail
      // loud if it stops being in the cascade list (test name above also
      // checks).
      expect(
        ACCOUNT_DELETION_CASCADE_TABLES,
        `Sample row references ${table} which is not in the cascade list`,
      ).toContain(table);
      await env.DB.prepare(sql).bind(...binds).run();
    }

    const pastScheduled = new Date(Date.parse(ISO_T0) - 60_000).toISOString();
    await insertPendingAccountDeletion(env as never, {
      cancelTokenHash: null,
      cancelTokenExpiresAt: null,
      emailAtRequest: `${userId}@example.test`,
      id: deletionId,
      requestedAt: ISO_T0,
      scheduledFor: pastScheduled,
      userId,
    });

    await runAccountDeletionSweep(env as never, { now: new Date(ISO_T0) });

    for (const [table] of sample) {
      // session / passkey use camelCase `userId`; everything else uses
      // `user_id`. The sweep's binding covers both.
      const whereCol = table === "session" || table === "passkey" ? "userId" : "user_id";
      const rows = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${whereCol} = ?`,
      ).bind(userId).first<{ n: number }>();
      expect(Number(rows?.n ?? 0), `${table} should have no rows for ${userId} after sweep`).toBe(0);
    }
  });
});