import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * v1 scoring_weight seed and the signal counting index (0509#4414, P6.1).
 *
 * The eleven rows are the weights table from docs/engines/standing-home.md §1
 * plus the version marker. They are config: no weight value lives in app code.
 * The index is the one the trailing-7-day count reads.
 */

const V1_WEIGHTS: { key: string; weight: number }[] = [
  { key: "ad_copy_change", weight: 3 },
  { key: "ad_new_creative", weight: 2 },
  { key: "hiring_new_role", weight: 1 },
  { key: "mention_matters", weight: 3 },
  { key: "mention_normal", weight: 1 },
  { key: "reliability_best_effort", weight: 0.5 },
  { key: "reliability_official_api", weight: 1 },
  { key: "reliability_rss", weight: 0.9 },
  { key: "reliability_scraped_page", weight: 0.6 },
  { key: "site_change_noteworthy", weight: 4 },
  { key: "weights_version", weight: 1 },
];

describe("0006_scoring_weight_seed.sql", () => {
  it("seeds the eleven v1 scoring_weight rows", async () => {
    const rows = await env.DB.prepare(
      "SELECT key, weight FROM scoring_weight WHERE effective_from = '2026-01-01T00:00:00.000Z' ORDER BY key",
    ).all<{ key: string; weight: number }>();

    expect(rows.results).toEqual(V1_WEIGHTS);
  });

  it("adds the signal (workspace_id, entity_id, observed_at) index", async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_signal_ws_entity_time'",
    ).first<{ name: string }>();

    expect(row).toEqual({ name: "idx_signal_ws_entity_time" });
  });
});
