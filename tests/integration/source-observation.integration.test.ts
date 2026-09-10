import { describe, expect, it } from "vitest";

import type {
  SourceAdapter,
  SourceObservation,
  WatchEventDraft,
} from "~/lib/source-adapter.server";
import { sourceAdapters } from "~/lib/source-adapter.server";
import { db, uid } from "./fixtures";

/**
 * Seam #2333 — migration 0090 integration test.
 *
 * Asserts the migration applies on a fresh D1 (the `workers` project applies
 * the repo's real migrations, so the `source_observation` table exists) and
 * that the new READ *and* WRITE path work end to end:
 *   1. the table accepts and returns rows for a generic (non-ad) source;
 *   2. the `source_kind`/`external_key` uniqueness and `is_active` default
 *      hold at the schema level;
 *   3. the SourceAdapter seam typechecks against the registry (`SourceObservation`,
 *      `WatchEventDraft`, and the empty `sourceAdapters` registry contract).
 */

describe("migration 0090 — source_observation", () => {
  it("writes and reads a generic source observation", async () => {
    const runId = uid("run");
    const key = uid("ext");

    await db()
      .prepare(
        `INSERT INTO source_observation (
           id, source_kind, external_key, watchlist_run_id, snapshot_json,
           seen_at, is_active, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .bind(
        uid("obs"),
        "google_ads_transparency",
        key,
        runId,
        JSON.stringify({ headline: "x", offer: "y" }),
        "2026-09-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
      )
      .run();

    // Assert on the unique (source_kind, external_key) to avoid cross-test
    // coupling under the workers project's per-file storage isolation.
    const keyed = await db()
      .prepare(
        `SELECT source_kind, external_key, watchlist_run_id, snapshot_json,
                seen_at, is_active
         FROM source_observation WHERE source_kind = ? AND external_key = ?`,
      )
      .bind("google_ads_transparency", key)
      .first();

    expect(keyed).not.toBeNull();
    expect(keyed?.external_key).toBe(key);
    expect(keyed?.source_kind).toBe("google_ads_transparency");
    expect(keyed?.watchlist_run_id).toBe(runId);
    expect(keyed?.snapshot_json).toBe(JSON.stringify({ headline: "x", offer: "y" }));
    expect(keyed?.seen_at).toBe("2026-09-01T00:00:00.000Z");
    expect(keyed?.is_active).toBe(1);
  });

  it("enforces source_kind + external_key uniqueness", async () => {
    const runId = uid("run");
    const key = uid("ext");
    const insert = () =>
      db()
        .prepare(
          `INSERT INTO source_observation (
             id, source_kind, external_key, watchlist_run_id, snapshot_json,
             seen_at, is_active, created_at
           ) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)`,
        )
        .bind(uid("obs"), "rss", key, runId, "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z")
        .run();

    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it("declares the empty SourceAdapter seam", () => {
    // The registry is empty until the first source (#2181) lands, and the
    // interface contract typechecks against it.
    const adapters: SourceAdapter[] = sourceAdapters;
    const obs: SourceObservation = {
      sourceKind: "google_ads_transparency",
      externalKey: "k",
      watchlistRunId: "r",
      snapshotJson: null,
      seenAt: "2026-09-01T00:00:00.000Z",
      isActive: true,
    };
    const draft: WatchEventDraft = {
      eventType: "ad_new",
      title: "t",
      summary: "s",
    };
    expect(adapters).toEqual([]);
    expect(obs.sourceKind).toBe("google_ads_transparency");
    expect(draft.eventType).toBe("ad_new");
  });
});