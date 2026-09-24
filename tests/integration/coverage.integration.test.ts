import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { COVERAGE } from "../../app/lib/coverage";

// "Live" in app/lib/coverage.ts is what the homepage, FAQ, /llms.txt and the
// JSON-LD claim to customers and to search and AI answer engines. It has to
// match what the migrations actually switch on, both ways: a live claim with a
// source key needs that source enabled, and an enabled source needs a live
// claim, so the PR that switches a source on also puts it on the homepage.

describe("coverage matches the enabled sources", () => {
  it("claims a source as live exactly when its row is enabled", async () => {
    const rows = await env.DB.prepare("SELECT key FROM source WHERE is_enabled = 1").all<{ key: string }>();
    const enabled = new Set(rows.results.map((row) => row.key));
    const sources = COVERAGE.flatMap((group) => group.sources);

    for (const source of sources) {
      if (!("sourceKey" in source)) continue;
      expect(
        enabled.has(source.sourceKey),
        `${source.id} names source "${source.sourceKey}", which no migration enables`,
      ).toBe(source.live);
    }

    const claimed = new Set(sources.flatMap((source) => ("sourceKey" in source && source.live ? [source.sourceKey] : [])));
    for (const key of enabled) {
      expect(
        claimed.has(key),
        `source "${key}" is enabled but no live entry in app/lib/coverage.ts names it as its sourceKey`,
      ).toBe(true);
    }
  });
});
