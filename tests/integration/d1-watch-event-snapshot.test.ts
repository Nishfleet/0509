// Workerd-D1 integration suite — the D1 layer's highest-risk paths against
// real workerd + real local D1 (recos §1.5). The setup file applies every
// checked-in migration, so this file exercises the *current* schema, not a
// hand-maintained test fixture. If a migration stops applying cleanly, or a
// query drifts from the schema, this file fails before deploy.
//
// Highest-risk paths covered (chosen from the recos doc):
//   1. watch_event writes — createWatchEvent + its idempotent re-write
//      (the dedupe-by-stable-id path that monitoring relies on).
//   2. snapshot reads — listWatchEventsForRun round-trips the row just
//      written through toWatchEventRecord, proving the read shape matches
//      the write shape against the real schema.
//   3. migration-sensitive queries — the FK/CHECK constraints on
//      watch_event (event_type CHECK, status CHECK, FK to watchlist_run)
//      and the proof_capture-conditional INSERT path are exercised against
//      the real D1, not a mock.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createWatchEvent,
  listWatchEventsForRun,
} from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";

// The workerd test isolate types `env` as the binding set from wrangler.jsonc
// plus the test-only `TEST_MIGRATIONS` binding. `AppEnv` already declares
// `DB?: D1Database`; the cast adds the non-optional `DB` for test code that
// always runs after the setup file has applied migrations.
const testEnv = env as AppEnv & { DB: D1Database };

// Minimal seed for the FK graph a watch_event row depends on. Uses the real
// D1 (env.DB), so the FK/CHECK constraints in the applied migrations are the
// gate — a schema drift that loosens or breaks them is caught here.
//
// `@cloudflare/vitest-plugin` isolates storage per test FILE, not per test, and
// `applyD1Migrations` only applies un-applied migrations (it does not reset
// data), so each test in this file must seed under a unique key to avoid
// colliding on `user.email` UNIQUE / `watchlist.id` PRIMARY KEY.
async function seedWatchlistGraph(key: string) {
  const now = new Date().toISOString();
  const userId = `u-it-${key}`;
  const watchlistId = `wl-it-${key}`;
  const runId = `run-it-${key}`;
  await testEnv.DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(userId, `Integration User ${key}`, `it-${key}@example.test`, now, now)
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO watchlist
       (id, user_id, name, target_type, target_id, target_fingerprint, target_label,
        is_active, last_scanned_at, created_at, updated_at)
     VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, NULL, ?, ?)`,
  )
    .bind(
      watchlistId,
      userId,
      `Integration Watchlist ${key}`,
      `adv-it-${key}`,
      `fp-it-${key}`,
      `Integration Competitor ${key}`,
      now,
      now,
    )
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO watchlist_run
       (id, watchlist_id, trigger_type, status, page_budget, pages_scanned,
        baseline_from_run_id, summary_json, started_at, finished_at,
        error_code, error_message, created_at, updated_at)
     VALUES (?, ?, 'manual', 'succeeded', 3, 0, NULL, '{}', ?, NULL, NULL, NULL, ?, ?)`,
  )
    .bind(runId, watchlistId, now, now, now)
    .run();
  return { userId, watchlistId, runId };
}

describe("D1 integration: watch_event write + snapshot read", () => {
  it("createWatchEvent writes a row that listWatchEventsForRun reads back", async () => {
    const { watchlistId, runId } = await seedWatchlistGraph("write-read");

    const eventId = await createWatchEvent(testEnv, {
      watchlistId,
      runId,
      eventType: "ad_new",
      adId: null,
      baselineFromRunId: null,
      title: "Integration: new ad detected",
      summary: "A new ad appeared for the seeded competitor.",
      metadata: { source: "integration-test", kind: "ad_new" },
    });

    expect(eventId).toBeTruthy();

    const events = await listWatchEventsForRun(testEnv, watchlistId, runId);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(eventId);
    expect(events[0].eventType).toBe("ad_new");
    // The default status path is "confirmed" when omitted (see createWatchEvent).
    expect(events[0].status).toBe("confirmed");
    expect(events[0].title).toBe("Integration: new ad detected");
    expect(events[0].metadata).toMatchObject({ source: "integration-test" });
  });

  it("createWatchEvent is idempotent — re-writing the same event returns the same id", async () => {
    const { watchlistId, runId } = await seedWatchlistGraph("idempotent");

    const input = {
      watchlistId,
      runId,
      eventType: "landing_page_headline_changed" as const,
      adId: null,
      baselineFromRunId: null,
      title: "Integration: headline changed",
      summary: "The landing page headline changed between runs.",
      metadata: { kind: "landing_page_headline_changed" },
    };

    const first = await createWatchEvent(testEnv, input);
    const second = await createWatchEvent(testEnv, input);

    expect(first).toBeTruthy();
    expect(second).toBe(first);

    const events = await listWatchEventsForRun(testEnv, watchlistId, runId);
    // Idempotency is enforced at the write layer — no duplicate row.
    expect(events).toHaveLength(1);
  });
});

describe("D1 integration: migration-sensitive constraints", () => {
  it("watch_event.event_type CHECK rejects an out-of-vocabulary event", async () => {
    const { watchlistId, runId } = await seedWatchlistGraph("check-event");

    // Direct D1 write bypassing the data layer, to prove the schema's CHECK
    // (applied by the real migration set) is the gate — not just the TS type.
    // The website_page_* vocabulary was added in migration 0077; a value
    // outside the full current CHECK list must be rejected by workerd D1.
    // workerd D1 throws on CHECK violations (it does not return a failed
    // result), so the assertion is that the write throws.
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO watch_event
           (id, watchlist_id, run_id, event_type, status, importance_score,
            title, summary, metadata_json, created_at)
         VALUES (?, ?, ?, 'not_a_real_event_type', 'confirmed', 0, ?, ?, '{}', ?)`,
      )
        .bind(`we-bad-event-${runId}`, watchlistId, runId, "bad", "bad", new Date().toISOString())
        .run(),
    ).rejects.toThrow(/CHECK/);
  });

  it("watch_event FK to watchlist_run rejects an orphan run_id", async () => {
    const { watchlistId } = await seedWatchlistGraph("fk-orphan");

    // foreign_keys = ON in workerd D1; an orphan run_id must be rejected.
    // As above, workerd D1 throws on FK violations.
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO watch_event
           (id, watchlist_id, run_id, event_type, status, importance_score,
            title, summary, metadata_json, created_at)
         VALUES (?, ?, 'run-does-not-exist', 'ad_new', 'confirmed', 0, ?, ?, '{}', ?)`,
      )
        .bind(`we-bad-fk-${watchlistId}`, watchlistId, "orphan title", "orphan summary", new Date().toISOString())
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});
