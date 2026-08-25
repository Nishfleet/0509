import { describe, expect, it } from "vitest";

import {
  createWatchEvent,
  listWatchEvents,
} from "~/lib/data/watch-events.server";

import {
  appEnv,
  countWatchEvents,
  db,
  seedAd,
  seedProofCapture,
  seedProofTarget,
  seedWatchlistWithRun,
} from "./fixtures";

/**
 * `createWatchEvent` is the highest-risk write in the D1 layer: it is the only
 * path that turns a detected change into a customer-visible alert, it is
 * re-entered on every monitoring retry, and it carries a SQL-level guard
 * (`json_valid`/`json_type` over `proof_capture.capture_metadata_json`) whose
 * behaviour exists only inside SQLite.
 *
 * Every assertion below is checked against a REAL local D1 with the repo's real
 * `migrations/*.sql` applied. That is the point: the 464 node suites mock the
 * binding, so they cannot observe the schema, the CHECK constraints, SQLite's
 * `IS ?` NULL matching, or `result.meta.changes` — the four things this file
 * exists to pin.
 */
describe("createWatchEvent against real D1", () => {
  it("writes every column the post-0007 schema defines, and reads them back", async () => {
    const { watchlistId, runId } = await seedWatchlistWithRun();

    const id = await createWatchEvent(appEnv, {
      watchlistId,
      runId,
      eventType: "landing_page_offer_changed",
      adId: null,
      baselineFromRunId: null,
      title: "Offer changed",
      summary: "£49 → £39",
      metadata: { from: "£49", to: "£39" },
      status: "confirmed",
      importanceScore: 77,
    });

    const [event] = await listWatchEvents(appEnv, watchlistId);
    expect(event).toBeDefined();
    expect(event.id).toBe(id);
    // `status` and `importance_score` arrived in migration 0007's table
    // rebuild; `landing_page_offer_changed` is only a legal event_type after
    // it. A dropped or renamed column fails here, not in production.
    expect(event.status).toBe("confirmed");
    expect(event.importanceScore).toBe(77);
    expect(event.eventType).toBe("landing_page_offer_changed");
    expect(event.metadata).toEqual({ from: "£49", to: "£39" });
    // Status `confirmed` with no explicit confirmedAt must be stamped, not left
    // NULL — the digest query filters on it.
    expect(event.confirmedAt).not.toBeNull();
    expect(event.lastEvaluatedAt).not.toBeNull();
    expect(event.proofCaptureId).toBeNull();
    expect(event.adId).toBeNull();
  });

  it("is idempotent: the same input twice yields one row and one id", async () => {
    const { watchlistId, runId } = await seedWatchlistWithRun();
    const input = {
      watchlistId,
      runId,
      eventType: "ad_new" as const,
      adId: null,
      baselineFromRunId: null,
      title: "New ad",
      summary: "A new ad went live",
      metadata: {},
    };

    const first = await createWatchEvent(appEnv, input);
    const second = await createWatchEvent(appEnv, input);

    expect(second).toBe(first);
    expect(await countWatchEvents(watchlistId)).toBe(1);
  });

  it("does not collapse two events that differ only by a NULL ad_id", async () => {
    // The dedupe lookup matches ad_id with `IS ?`, not `= ?`. Under `= ?` a
    // NULL never matches anything, so the guard would silently stop deduping;
    // under a naive equality rewrite the NULL row and the ad row could collide.
    // Only real SQLite can tell these apart.
    const { watchlistId, runId } = await seedWatchlistWithRun();
    await seedAd("ad_fixture");

    const base = {
      watchlistId,
      runId,
      eventType: "ad_new" as const,
      baselineFromRunId: null,
      title: "Same title",
      summary: "Same summary",
      metadata: {},
    };

    const withoutAd = await createWatchEvent(appEnv, { ...base, adId: null });
    const withAd = await createWatchEvent(appEnv, { ...base, adId: "ad_fixture" });

    expect(withAd).not.toBe(withoutAd);
    expect(await countWatchEvents(watchlistId)).toBe(2);

    // …and each still dedupes against itself.
    expect(await createWatchEvent(appEnv, { ...base, adId: null })).toBe(withoutAd);
    expect(await countWatchEvents(watchlistId)).toBe(2);
  });

  it("refuses to attach an event to a proof capture already claimed for cleanup", async () => {
    // The insert is a conditional `INSERT ... SELECT ... WHERE NOT EXISTS`,
    // guarded by `json_type(capture_metadata_json, '$.launchCanaryCleanupClaim')`.
    // A claimed capture must produce zero row changes and a thrown
    // `proof_capture_cleanup_claimed`, so the canary cleanup can never race a
    // live alert onto a capture it is about to delete.
    const { watchlistId, runId } = await seedWatchlistWithRun();
    const proofTargetId = await seedProofTarget(watchlistId);
    const claimed = await seedProofCapture(
      proofTargetId,
      JSON.stringify({ launchCanaryCleanupClaim: { claimedAt: "2026-01-01T00:00:00.000Z" } }),
    );

    await expect(
      createWatchEvent(appEnv, {
        watchlistId,
        runId,
        eventType: "landing_page_url_changed",
        adId: null,
        baselineFromRunId: null,
        title: "Claimed capture",
        summary: "should not be written",
        metadata: {},
        proofCaptureId: claimed,
      }),
    ).rejects.toThrow("proof_capture_cleanup_claimed");

    expect(await countWatchEvents(watchlistId)).toBe(0);
  });

  it("attaches normally when the proof capture carries no cleanup claim", async () => {
    const { watchlistId, runId } = await seedWatchlistWithRun();
    const proofTargetId = await seedProofTarget(watchlistId);
    const unclaimed = await seedProofCapture(
      proofTargetId,
      JSON.stringify({ renderMode: "mobile" }),
    );

    const id = await createWatchEvent(appEnv, {
      watchlistId,
      runId,
      eventType: "landing_page_url_changed",
      adId: null,
      baselineFromRunId: null,
      title: "Unclaimed capture",
      summary: "should be written",
      metadata: {},
      proofCaptureId: unclaimed,
    });

    const [event] = await listWatchEvents(appEnv, watchlistId);
    expect(event.id).toBe(id);
    expect(event.proofCaptureId).toBe(unclaimed);
    expect(await countWatchEvents(watchlistId)).toBe(1);
  });

  it("treats an unparseable capture_metadata_json as unclaimed rather than throwing", async () => {
    // `json_valid(...)` is the first term of the guard. Without it, `json_type`
    // over corrupt metadata would raise a SQLite malformed-JSON error and turn
    // a data-quality problem into a lost alert.
    const { watchlistId, runId } = await seedWatchlistWithRun();
    const proofTargetId = await seedProofTarget(watchlistId);
    const corrupt = await seedProofCapture(proofTargetId, "{not json");

    const id = await createWatchEvent(appEnv, {
      watchlistId,
      runId,
      eventType: "landing_page_url_changed",
      adId: null,
      baselineFromRunId: null,
      title: "Corrupt metadata",
      summary: "still written",
      metadata: {},
      proofCaptureId: corrupt,
    });

    expect(id).toMatch(/^watch_event_/);
    expect(await countWatchEvents(watchlistId)).toBe(1);
  });

  it("lets D1 reject an event_type outside the schema's CHECK vocabulary", async () => {
    // The write path does not validate `eventType` in TypeScript at runtime —
    // the schema is the enforcement point. If a future migration widens or
    // drops this CHECK, the guarantee is gone and this test says so.
    const { watchlistId, runId } = await seedWatchlistWithRun();

    await expect(
      createWatchEvent(appEnv, {
        watchlistId,
        runId,
        // Deliberately outside the CHECK list.
        eventType: "landing_page_pricing_changed" as never,
        adId: null,
        baselineFromRunId: null,
        title: "Unknown type",
        summary: "rejected by the schema",
        metadata: {},
      }),
    ).rejects.toThrow(/CONSTRAINT/i);

    expect(await countWatchEvents(watchlistId)).toBe(0);
  });

  it("keeps a stable, content-derived id so retries across processes converge", async () => {
    const { watchlistId, runId } = await seedWatchlistWithRun();
    const input = {
      watchlistId,
      runId,
      eventType: "ad_inactive" as const,
      adId: null,
      baselineFromRunId: null,
      title: "Ad went inactive",
      summary: "no longer running",
      metadata: {},
    };

    const id = await createWatchEvent(appEnv, input);
    // Delete the row, then write it again: a random id would differ, a stable
    // id must not. This is what makes the unique-constraint recovery branch
    // correct rather than lucky.
    await db().prepare("DELETE FROM watch_event WHERE id = ?").bind(id).run();
    expect(await createWatchEvent(appEnv, input)).toBe(id);
  });
});
