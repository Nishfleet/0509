import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createEventCandidate, createWatchEvent, listWatchEvents } from "~/lib/data/watch-events.server";
import { setupMigrations } from "./setup";

/**
 * P10-A job 1 — D1 integration tests for the watch_event write path.
 *
 * These run on real workerd via Miniflare (per-file isolated D1), with the
 * real `migrations/*.sql` chain applied in `setupMigrations()`. This is the
 * class of change the recos doc (§1.5) flags as the biggest untapped lever:
 * the D1 layer, bindings and migration chain are verified by nothing before
 * deploy under the old mock-only suite. The watch_event write path is one of
 * the three highest-risk D1 surfaces (the others are covered in
 * `landing-page-snapshot.test.ts` and `migration-chain.test.ts`).
 *
 * Uses `@cloudflare/vitest-plugin` (renamed from `vitest-pool-workers` on
 * 2026-08-19). `cloudflare:workers`/`cloudflare:test` are the current module
 * names — do not regress to `SELF.fetch` or `vitest-pool-workers`.
 */

const NOW = "2026-08-25T10:00:00.000Z";

async function seedWatchlist(env: AppEnv, id: string, userId = "user_test"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(userId, userId, `${userId}@example.com`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at) VALUES (?, ?, 'Test', 'advertiser', ?, ?, 'Test', 1, ?, ?)`,
  )
    .bind(id, userId, `target-${id}`, `fp-${id}`, NOW, NOW)
    .run();
}

async function seedRun(env: AppEnv, runId: string, watchlistId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json, started_at, created_at, updated_at) VALUES (?, ?, 'scheduled', 'succeeded', 3, 1, '{}', ?, ?, ?)`,
  )
    .bind(runId, watchlistId, NOW, NOW, NOW)
    .run();
}

type AppEnv = typeof env;

describe("watch_event write path (real D1, real migrations)", () => {
  beforeEach(async () => {
    await setupMigrations();
  });

  it("createWatchEvent inserts a row readable by listWatchEvents", async () => {
    await seedWatchlist(env, "wl_1", "user_1");
    await seedRun(env, "run_1", "wl_1");

    const id = await createWatchEvent(env, {
      watchlistId: "wl_1",
      runId: "run_1",
      eventType: "landing_page_headline_changed",
      adId: null,
      baselineFromRunId: null,
      title: "Headline moved",
      summary: "Old copy → new copy",
      metadata: { diff: "headline" },
    });

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const events = await listWatchEvents(env, "wl_1", 10);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(id);
    expect(events[0].eventType).toBe("landing_page_headline_changed");
    expect(events[0].title).toBe("Headline moved");
  });

  it("createWatchEvent is idempotent — a repeat call returns the same id, no second row", async () => {
    await seedWatchlist(env, "wl_2", "user_2");
    await seedRun(env, "run_2", "wl_2");

    const input = {
      watchlistId: "wl_2",
      runId: "run_2",
      eventType: "ad_new" as const,
      adId: null,
      baselineFromRunId: null,
      title: "New ad",
      summary: "First sighting",
      metadata: {},
    };
    const first = await createWatchEvent(env, input);
    const second = await createWatchEvent(env, input);

    expect(second).toBe(first);
    const events = await listWatchEvents(env, "wl_2", 10);
    expect(events).toHaveLength(1);
  });

  it("createEventCandidate inserts and is idempotent on identical input", async () => {
    await seedWatchlist(env, "wl_3", "user_3");
    await seedRun(env, "run_3", "wl_3");

    const input = {
      watchlistId: "wl_3",
      runId: "run_3",
      eventType: "landing_page_offer_changed" as const,
      adId: null,
      title: "Offer changed",
      summary: "₹400 → ₹500",
      metadata: { field: "offer" },
    };
    const first = await createEventCandidate(env, input);
    const second = await createEventCandidate(env, input);

    expect(second).toBe(first);
    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM event_candidate WHERE watchlist_id = ?`,
    )
      .bind("wl_3")
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("createWatchEvent with a proofCaptureId refuses when the capture is already claimed", async () => {
    await seedWatchlist(env, "wl_4", "user_4");
    await seedRun(env, "run_4", "wl_4");

    // Seed a proof_target + proof_capture with the cleanup-claim marker set
    // so the INSERT...WHERE NOT EXISTS guard fires.
    await env.DB.prepare(
      `INSERT INTO proof_target (id, watchlist_id, ad_id, canonical_page_identity, proof_target_identity, created_at, updated_at) VALUES (?, 'wl_4', NULL, 'canon_4', 'pt_ident_4', ?, ?)`,
    )
      .bind("pt_4", NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO proof_capture (id, proof_target_id, status, extracted_fields_json, capture_metadata_json, render_mode, device_profile, extractor_version, attempted_at, created_at, updated_at) VALUES (?, 'pt_4', 'succeeded', '{}', ?, 'mobile', 'mobile_default', 'v1', ?, ?, ?)`,
    )
      .bind(
        "pc_4",
        JSON.stringify({ launchCanaryCleanupClaim: "claimed-by-other" }),
        NOW,
        NOW,
        NOW,
      )
      .run();

    await expect(
      createWatchEvent(env, {
        watchlistId: "wl_4",
        runId: "run_4",
        eventType: "ad_new",
        adId: null,
        baselineFromRunId: null,
        title: "Guarded",
        summary: "Should not insert",
        metadata: {},
        proofCaptureId: "pc_4",
      }),
    ).rejects.toThrow(/proof_capture_cleanup_claimed/);

    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM watch_event WHERE watchlist_id = ? AND title = ?`,
    )
      .bind("wl_4", "Guarded")
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});
