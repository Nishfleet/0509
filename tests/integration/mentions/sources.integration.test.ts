import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const EXPECTED_KEYS = [
  "ddg.html",
  "hn.algolia",
  "medium.tag_rss",
  "news.google_rss",
  "reddit.search_rss",
  "youtube.channel_rss",
];
const DDG_DISABLED_REASON = "202-challenged 5/5 attempts 2026-09-21";
const RATE_CLASSES = ["fast", "paced"];

describe("the six mentions source rows (#4532)", () => {
  it("seeds exactly the six mentions keys", async () => {
    const rows = await env.DB.prepare(
      "SELECT key FROM source WHERE kind = 'mentions' ORDER BY key",
    ).all<{ key: string }>();
    expect((rows.results ?? []).map((r) => r.key)).toEqual([...EXPECTED_KEYS].sort());
  });

  it("disables only ddg.html and records its 202-challenge reason on the row", async () => {
    const rows = await env.DB.prepare(
      "SELECT key, config_json FROM source WHERE kind = 'mentions' AND is_enabled = 0 ORDER BY key",
    ).all<{ key: string; config_json: string }>();
    const disabled = rows.results ?? [];
    expect(disabled.map((r) => r.key)).toEqual(["ddg.html"]);

    const ddg = disabled[0];
    expect(ddg).toBeDefined();
    if (!ddg) throw new Error("ddg.html must be the only disabled mentions source");
    const config = JSON.parse(ddg.config_json) as { disabledReason?: string };
    expect(config.disabledReason).toBe(DDG_DISABLED_REASON);
  });

  it("gives every row a rate class, an https canary, an expectNonzero flag and plugin_key === key", async () => {
    const rows = await env.DB.prepare(
      "SELECT key, plugin_key, config_json FROM source WHERE kind = 'mentions'",
    ).all<{ key: string; plugin_key: string; config_json: string }>();
    const seeded = rows.results ?? [];
    expect(seeded).toHaveLength(EXPECTED_KEYS.length);

    for (const row of seeded) {
      const config = JSON.parse(row.config_json) as {
        rateClass: string;
        canaryUrl: string;
        expectNonzero: boolean;
      };
      expect(RATE_CLASSES).toContain(config.rateClass);
      expect(config.canaryUrl).toMatch(/^https:\/\//);
      expect(typeof config.expectNonzero).toBe("boolean");
      expect(row.plugin_key).toBe(row.key);
    }
  });
});
