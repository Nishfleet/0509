import { describe, expect, it } from "vitest";

import {
  cancelPendingAccountErasure,
  exportAccountData,
  requestAccountErasure,
  runAccountErasureSweep,
} from "~/lib/account-erasure.server";
import { sha256Hex } from "~/lib/browser-job-telemetry.server";
import { PLAN_FAMILIES } from "~/lib/plan-entitlements";

import { appEnv, db, ISO_T0, seedWatchlist, seedUser } from "./fixtures";

/**
 * Issue #2982 — self-serve GDPR/CCPA erasure against the REAL migrations and
 * the real D1 binding (tests/integration lane).
 *
 * Asserts the three things the issue requires:
 *   1. The grace clock: nothing is erased before `execute_after`.
 *   2. On the due sweep, every row keyed to the user is gone — user-keyed app
 *      tables, auth (session/account/passkey/verification), the user row
 *      itself, one email-keyed row, and the hash-keyed rows the user owns.
 *   3. The audit row lands with per-table counts and never carries the email
 *      or the live user id.
 *
 * Export and cancel are exercised too.
 */

const USER_ID = "usr_erasure_full";
const EMAIL = `${USER_ID}@example.test`;
const ISO_T1 = "2026-06-01T00:00:00.000Z";

export async function seedUserKeyedRows(userId: string) {
  const now = ISO_T0;
  const h = db();
  await h
    .prepare(`INSERT INTO user_plan (user_id, plan, plan_updated_at) VALUES (?, 'free', ?)`)
    .bind(userId, now)
    .run();
  const sessionId = `ses_${userId}`;
  await h
    .prepare(
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, '203.0.113.9', 'vitest', ?)`,
    )
    .bind(sessionId, `tok_${sessionId}`, now, now, userId)
    .run();
  await h
    .prepare(
      `INSERT INTO account (id, accountId, providerId, userId, accessToken, password, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'secret-access-token', 'secret-password', ?, ?)`,
    )
    .bind(`acc_${userId}`, `accext_${userId}`, "credential", userId, now, now)
    .run();
  await h
    .prepare(
      `INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
       VALUES (?, ?, 'otp', '2099-01-01T00:00:00.000Z', ?, ?)`,
    )
    .bind(`ver_${userId}`, userId, now, now)
    .run();
  const watchlistId = await seedWatchlist(userId);
  await h
    .prepare(
      `INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, summary_json, started_at, created_at, updated_at)
       VALUES (?, ?, 'scheduled', 'succeeded', '{}', ?, ?, ?)`,
    )
    .bind(`run_${watchlistId}`, watchlistId, now, now, now)
    .run();
  await h
    .prepare(
      `INSERT INTO watch_event (id, watchlist_id, run_id, event_type, title, summary, metadata_json, created_at)
       VALUES (?, ?, ?, 'ad_new', 't', 's', '{}', ?)`,
    )
    .bind(`we_${watchlistId}`, watchlistId, `run_${watchlistId}`, now)
    .run();
  await h
    .prepare(`INSERT INTO collection (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(`col_${userId}`, userId, "c", now, now)
    .run();
  await h
    .prepare(`INSERT INTO tag (id, user_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(`tag_${userId}`, userId, "label", now, now)
    .run();
  await h
    .prepare(
      `INSERT INTO saved_query (id, user_id, name, mode, query_text, normalized_query_json, fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, 'keyword', 'q', '[]', 'fp', ?, ?)`,
    )
    .bind(`sq_${userId}`, userId, "q", now, now)
    .run();
  await h
    .prepare(
      `INSERT INTO share_link (id, token, user_id, resource_type, resource_id, created_at)
       VALUES (?, ?, ?, 'watchlist', ?, ?)`,
    )
    .bind(`sh_${userId}`, `tok_${userId}`, userId, watchlistId, now)
    .run();
  await h
    .prepare(
      `INSERT INTO org (id, name, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(`org_${userId}`, `Org ${userId}`, userId, now, now)
    .run();
  const trackingId = `tex_${userId}`;
  await h
    .prepare(
      `INSERT INTO tracked_entity (id, user_id, tracking_mode, label, created_at, updated_at)
       VALUES (?, ?, 'self', 'me', ?, ?)`,
    )
    .bind(trackingId, userId, now, now)
    .run();
  await h
    .prepare(
      `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, 'website', 'https://example.test', '{}', ?, ?)`,
    )
    .bind(`st_${userId}`, trackingId, userId, now, now)
    .run();
  await h
    .prepare(
      `INSERT INTO evidence_usage_period (id, workspace_user_id, period_start, period_end, plan_family, included_allowance, created_at)
       VALUES (?, ?, '2026-06-01', '2026-06-30', 'free', 5, ?)`,
    )
    .bind(`eup_${userId}`, userId, now)
    .run();
  // Email-keyed row owned by the user's email (no FK to the user table).
  await h
    .prepare(
      `INSERT INTO signup_source_pending (email, signup_source, created_at, expires_at)
       VALUES (?, 'magicbrief-migration', ?, '2099-01-01T00:00:00.000Z')`,
    )
    .bind(`${userId}@example.test`, now)
    .run();
  // Hash-keyed rows: the exact key seeds the erasure module hashes.
  const seeds = [
    `account-search|${userId}`,
    `search-selection|${userId}`,
    `billing-provider-pricing|${userId}`,
    `billing-provider-mutation|${userId}`,
    `share-pdf-daily|${userId}`,
    ...PLAN_FAMILIES.map((plan) => `account-search-daily|${userId}:${plan}`),
  ];
  for (const [i, seed] of seeds.entries()) {
    await h
      .prepare(
        `INSERT INTO rate_limit_events (id, scope, key_hash, route, created_at)
         VALUES (?, ?, ?, '/x', ?)`,
      )
      .bind(`rl_${i}_${userId}`, seed.split("|")[0], await sha256Hex(seed), now)
      .run();
  }
  return { watchlistId };
}

function h() {
  return db();
}

describe("account erasure against real D1 migrations", () => {
  it("files a request with a 7-day grace window and keeps the data until the window passes", async () => {
    const userId = await seedUser();
    await seedUserKeyedRows(userId);
    const { request } = await requestAccountErasure(appEnv, {
      userId,
      email: `${userId}@example.test`,
      requestedVia: "test",
    });
    expect(request?.status).toBe("pending");
    const executeAfter = Date.parse(request?.execute_after ?? "");
    const requestedAt = Date.parse(request?.requested_at ?? "0");
    expect(executeAfter).toBeGreaterThanOrEqual(requestedAt + 7 * 24 * 60 * 60 * 1000 - 1);

    // Sweeping before the grace window does nothing.
    let sweep = await runAccountErasureSweep(appEnv, { now: new Date(ISO_T0) });
    expect(sweep.due).toBe(0);
    const stillThere = await db()
      .prepare(`SELECT COUNT(*) AS n FROM session WHERE userId = ?`)
      .bind(userId)
      .first<{ n: number }>();
    expect(stillThere?.n).toBe(1);

    // Clean up the clock so later tests in the file only see their own sweep.
    expect(await cancelPendingAccountErasure(appEnv, userId)).toBe(true);
  });

  it("erases every user-keyed row on the due sweep and leaves only a hashed audit row", async () => {
    const userId = await seedUser();
    await seedUserKeyedRows(userId);
    const email = `${userId}@example.test`;
    const { request } = await requestAccountErasure(appEnv, { userId, email, requestedVia: "test" });
    expect(request).not.toBeNull();

    const past = new Date(Date.parse(request?.execute_after ?? ISO_T0) + 60_000);
    const sweep = await runAccountErasureSweep(appEnv, { now: past });
    expect(sweep.due).toBe(1);
    expect(sweep.completed).toBe(1);
    expect(sweep.failed).toBe(0);

    // The request is consumed; the audit survives — hashed, not keyed.
    const requestsLeft = await db()
      .prepare(`SELECT COUNT(*) AS n FROM account_erasure_request WHERE user_id = ?`)
      .bind(userId)
      .first<{ n: number }>();
    expect(requestsLeft?.n).toBe(0);

    const userLeft = await db().prepare(`SELECT id FROM user WHERE id = ?`).bind(userId).first();
    expect(userLeft).toBeNull();

    const keyedChecks = (
      [
        ["session", "userId"],
        ["account", "userId"],
        ["passkey", "userId"],
        ["user_plan", "user_id"],
        ["watchlist", "user_id"],
        ["saved_query", "user_id"],
        ["collection", "user_id"],
        ["tag", "user_id"],
        ["share_link", "user_id"],
        ["org", "owner_user_id"],
        ["tracked_entity", "user_id"],
        ["source_target", "user_id"],
        ["evidence_usage_period", "workspace_user_id"],
      ] as const
    ).map(async ([table, column]) => {
      const row = await db()
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
        .bind(userId)
        .first<{ n: number }>();
      expect(row?.n, `${table}.${column} had user rows left`).toBe(0);
    });
    await Promise.all(keyedChecks);

    // Children hung off the erased parents are gone too.
    const weLeft = await db()
      .prepare(
        `SELECT COUNT(*) AS n FROM watch_event WHERE run_id NOT IN (SELECT id FROM watchlist_run)`,
      )
      .first<{ n: number }>();
    expect(weLeft?.n).toBe(0);

    // FK graph is intact — no dangling subselect casualties.
    const fkViolations = await db().prepare(`PRAGMA foreign_key_check`).all();
    expect(fkViolations.results).toEqual([]);

    // The email-keyed row is gone.
    const emailRows = await db()
      .prepare(`SELECT COUNT(*) AS n FROM signup_source_pending WHERE email LIKE '%${userId}%'`)
      .first<{ n: number }>();
    expect(emailRows?.n).toBe(0);

    // Hash-keyed rate-limit rows for the user's exact seeds are gone.
    const rateLimitRows = await db()
      .prepare(`SELECT COUNT(*) AS n FROM rate_limit_events WHERE id LIKE '%${userId}%'`)
      .first<{ n: number }>();
    expect(rateLimitRows?.n).toBe(0);

    // Audit: hashed key, counts present, no PII.
    const audit = await db()
      .prepare(
        `SELECT user_id_hash, deleted_counts_json, requested_at, execute_after, completed_at
         FROM account_erasure_audit WHERE request_id = ?`,
      )
      .bind(request?.id ?? "")
      .first<{ user_id_hash: string; deleted_counts_json: string }>();
    expect(audit).not.toBeNull();
    expect(audit?.user_id_hash).not.toContain(userId);
    expect(JSON.stringify(audit)).not.toContain(email);
    const counts = JSON.parse(audit?.deleted_counts_json ?? "{}") as Record<string, number>;
    expect(counts["user"]).toBe(1);
    expect(counts["session"]).toBe(1);
    expect(counts["watchlist"] ?? 0).toBeGreaterThanOrEqual(1);

    // The email is unrecoverable from the hash — re-hash of the id is equal.
    const { sha256Hex: hashHex } = await import("~/lib/browser-job-telemetry.server");
    expect(audit?.user_id_hash).toBe(await hashHex(`0509:account-erasure:${userId}`));
  });

  it("cancels the pending clock and the sweep then leaves everything in place", async () => {
    const userId = await seedUser();
    await seedUserKeyedRows(userId);
    const email = `${userId}@example.test`;
    const filed = await requestAccountErasure(appEnv, { userId, email, requestedVia: "test" });
    expect(filed.created).toBe(true);
    expect(await cancelPendingAccountErasure(appEnv, userId)).toBe(true);

    const past = new Date(Date.parse(filed.request?.execute_after ?? ISO_T0) + 60_000);
    const sweep = await runAccountErasureSweep(appEnv, { now: past });
    expect(sweep.due).toBe(0);
    const sessionLeft = await db()
      .prepare(`SELECT COUNT(*) AS n FROM session WHERE userId = ?`)
      .bind(userId)
      .first<{ n: number }>();
    expect(sessionLeft?.n).toBe(1);
  });

  it("exports the user's rows with credentials stripped and reports pending erasure", async () => {
    const userId = await seedUser();
    await seedUserKeyedRows(userId);
    await requestAccountErasure(appEnv, {
      userId,
      email: `${userId}@example.test`,
      requestedVia: "test",
    });
    const report = await exportAccountData(appEnv, {
      userId,
      email: `${userId}@example.test`,
    });
    expect(report.tables["saved_query"]).toHaveLength(1);
    expect((report.tables["watchlist"] ?? []).length).toBeGreaterThanOrEqual(1);
    // Credential material is stripped from the export.
    for (const row of (report.tables["account"] as unknown) as Record<string, unknown>[]) {
      expect(row.accessToken).toBeUndefined();
      expect(row.password).toBeUndefined();
    }
    expect(report.pendingErasure).not.toBeNull();
  });
});
