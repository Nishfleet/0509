import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { COVERAGE } from "../../app/lib/coverage";
import { readRegistrySources } from "../../app/lib/data/source.server";
import { llmsTxt } from "../../app/lib/public-routes";
import { watchedClaims } from "../../app/lib/watched-claims";

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

    const claimed = new Set(
      sources.flatMap((source) => ("sourceKey" in source && source.live ? [source.sourceKey] : [])),
    );
    for (const key of enabled) {
      expect(
        claimed.has(key),
        `source "${key}" is enabled but no live entry in app/lib/coverage.ts names it as its sourceKey`,
      ).toBe(true);
    }
  });

  it("reflects a live claim's degraded_reason in the llms.txt render", async () => {
    const news = COVERAGE.flatMap((group) => group.sources).find((source) => source.id === "mentions.news");
    if (news === undefined || !("sourceKey" in news)) {
      throw new Error("mentions.news must name a sourceKey");
    }
    await env.DB.prepare("UPDATE source SET degraded_reason = ? WHERE key = ?").bind("timed out", news.sourceKey).run();
    try {
      const body = llmsTxt("https://0509.io", await readRegistrySources(), Date.parse("2026-09-28T12:00:00.000Z"));
      expect(body).toContain("- Mentions: News (not answering today: slow to answer)");
      expect(body).toContain("Some sources are not answering today; those lines say so.");
    } finally {
      await env.DB.prepare("UPDATE source SET degraded_reason = NULL WHERE key = ?").bind(news.sourceKey).run();
    }
  });

  it("drops a live claim from the public copy once its source rows are degraded or stale", async () => {
    const now = Date.parse("2026-09-29T12:00:00.000Z");
    const keys = COVERAGE.flatMap((group) =>
      group.kind === "Mentions"
        ? group.sources.flatMap((source) => ("sourceKey" in source && source.live ? [source.sourceKey] : []))
        : [],
    );
    expect(keys.length).toBeGreaterThan(0);
    const restore = await env.DB.prepare(
      `SELECT key, degraded_reason, latest_fetched_at, latest_item_count FROM source WHERE key IN (${keys.map(() => "?").join(",")})`,
    )
      .bind(...keys)
      .all<{
        key: string;
        degraded_reason: string | null;
        latest_fetched_at: string | null;
        latest_item_count: number | null;
      }>();
    const set = env.DB.prepare(
      "UPDATE source SET degraded_reason = ?1, latest_fetched_at = ?2, latest_item_count = 3 WHERE key = ?3",
    );
    try {
      await env.DB.batch(keys.map((key) => set.bind(null, "2026-09-29T06:00:00.000Z", key)));
      const healthy = watchedClaims(await readRegistrySources(), now);
      expect(healthy.nouns).toMatch(/news mentions/);
      expect(healthy.features).toContain("Mentions: News");

      await env.DB.batch(keys.map((key) => set.bind("timed out", "2026-09-29T06:00:00.000Z", key)));
      const degraded = watchedClaims(await readRegistrySources(), now);
      expect(degraded.nouns).not.toMatch(/mentions/);
      expect(degraded.features.filter((feature) => feature.startsWith("Mentions"))).toEqual([]);
      const body = llmsTxt("https://0509.io", await readRegistrySources(), now);
      expect(body.split("\n").find((line) => line.startsWith("> "))).not.toMatch(/news mentions/);

      await env.DB.batch(keys.map((key) => set.bind(null, "2026-09-20T06:00:00.000Z", key)));
      expect(watchedClaims(await readRegistrySources(), now).nouns).not.toMatch(/mentions/);
    } finally {
      const put = env.DB.prepare(
        "UPDATE source SET degraded_reason = ?1, latest_fetched_at = ?2, latest_item_count = ?3 WHERE key = ?4",
      );
      await env.DB.batch(
        restore.results.map((r) => put.bind(r.degraded_reason, r.latest_fetched_at, r.latest_item_count, r.key)),
      );
    }
  });
});
