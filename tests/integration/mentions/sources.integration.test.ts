import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { blankToNull, feedEntries, publisherHost, textOf, viewsFromMedia } from "../../../workers/sources/mentions/feed";
import {
  adapterResultSchema,
  fetchUpstream,
  UpstreamStatus,
  type MentionAdapter,
  type MentionItem,
  type MentionTarget,
} from "../../../workers/sources/mentions/types";
import { adapterFor } from "../../../workers/sources/registry";

/**
 * The six mentions source rows (0509#4322). Real D1, real migrations.
 * Only ddg.html is disabled. No X row — that is P5.6.
 */

const MENTIONS = [
  {
    id: "src_news_google_rss",
    key: "news.google_rss",
    platform: "google",
    reliability: "rss",
    isEnabled: 1,
    rateClass: "fast",
    canaryUrl:
      "https://news.google.com/rss/search?q=%22Gymshark%22&hl=en-US&gl=US&ceid=US:en",
  },
  {
    id: "src_reddit_search_rss",
    key: "reddit.search_rss",
    platform: "reddit",
    reliability: "rss",
    isEnabled: 1,
    rateClass: "paced",
    canaryUrl: "https://www.reddit.com/search.rss?q=gymshark&sort=new",
  },
  {
    id: "src_hn_algolia",
    key: "hn.algolia",
    platform: "hn",
    reliability: "official_api",
    isEnabled: 1,
    rateClass: "fast",
    canaryUrl:
      "https://hn.algolia.com/api/v1/search_by_date?query=gymshark&tags=story&hitsPerPage=3",
  },
  {
    id: "src_youtube_channel_rss",
    key: "youtube.channel_rss",
    platform: "youtube",
    reliability: "rss",
    isEnabled: 1,
    rateClass: "fast",
    canaryUrl:
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCma7hhYJ3bfEhZgw3xl77ww",
  },
  {
    id: "src_medium_tag_rss",
    key: "medium.tag_rss",
    platform: "medium",
    reliability: "rss",
    isEnabled: 1,
    rateClass: "fast",
    canaryUrl: "https://medium.com/feed/tag/gymshark",
  },
  {
    id: "src_ddg_html",
    key: "ddg.html",
    platform: "duckduckgo",
    reliability: "scraped_page",
    isEnabled: 0,
    rateClass: "paced",
    canaryUrl: "https://html.duckduckgo.com/html/?q=%22gymshark%22",
  },
] as const;

const DDG_DISABLED_REASON = "202-challenged 5/5 attempts 2026-09-21";

interface SourceRow {
  id: string;
  key: string;
  kind: string;
  platform: string;
  plugin_key: string;
  reliability: string;
  is_enabled: number;
  config_json: string;
}

describe("mentions source rows (#4322)", () => {
  it("seeds exactly the six mentions rows, and only ddg.html is disabled", async () => {
    const rows = await env.DB.prepare(
      `SELECT id, key, kind, platform, plugin_key, reliability, is_enabled, config_json
       FROM source
       WHERE kind = 'mentions'
       ORDER BY key`,
    ).all<SourceRow>();
    const seeded = rows.results ?? [];

    expect(seeded.map((row) => row.key).sort()).toEqual(MENTIONS.map((row) => row.key).sort());
    expect(seeded).toHaveLength(6);

    for (const row of seeded) {
      const expected = MENTIONS.find((item) => item.key === row.key);
      expect(expected, row.key).toBeDefined();
      if (!expected) throw new Error(`${row.key} is not one of the six`);

      expect(row.kind).toBe("mentions");
      expect(row.id).toBe(expected.id);
      expect(row.platform).toBe(expected.platform);
      expect(row.plugin_key).toBe(expected.key);
      expect(row.reliability).toBe(expected.reliability);
      expect(Number(row.is_enabled)).toBe(expected.isEnabled);

      const config = JSON.parse(row.config_json) as {
        rateClass?: string;
        canaryUrl?: string;
        expectNonzero?: boolean;
        disabledReason?: string;
      };
      expect(config.rateClass).toBe(expected.rateClass);
      expect(config.canaryUrl).toBe(expected.canaryUrl);
      expect(config.expectNonzero).toBe(true);
      if (row.key === "ddg.html") {
        expect(config.disabledReason).toBe(DDG_DISABLED_REASON);
      } else {
        expect(config.disabledReason).toBeUndefined();
      }
    }

    const disabled = seeded.filter((row) => Number(row.is_enabled) === 0).map((row) => row.key);
    expect(disabled).toEqual(["ddg.html"]);
  });

  it("keeps a disabled mentions row out of the enabled set, and has no X row", async () => {
    const enabled = await env.DB.prepare(
      `SELECT key FROM source WHERE kind = 'mentions' AND is_enabled = 1 ORDER BY key`,
    ).all<{ key: string }>();
    expect((enabled.results ?? []).map((row) => row.key)).toEqual(
      MENTIONS.filter((row) => row.isEnabled === 1)
        .map((row) => row.key)
        .sort(),
    );

    const xRows = await env.DB.prepare(
      `SELECT count(*) AS n FROM source
       WHERE kind = 'mentions' AND (platform = 'x' OR key LIKE 'x.%')`,
    ).first<{ n: number }>();
    expect(xRows?.n).toBe(0);
  });
});

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>t</title>
<item><title>Gymshark</title><link>https://example.com/a</link><guid>https://example.com/a</guid></item>
</channel></rss>`;

describe("mentions adapter contract (#4322)", () => {
  it("parses a feed with extractFromXml and validates the result shape", () => {
    const entries = feedEntries(SAMPLE_RSS);
    expect(entries.map((entry) => entry.title)).toEqual(["Gymshark"]);

    const item: MentionItem = {
      dedupKey: "https://example.com/a",
      title: "Gymshark",
      bodyExcerpt: "",
      canonicalUrl: "https://example.com/a",
      publishedAt: null,
      author: null,
      publisher: null,
      engagement: {},
    };
    const target: MentionTarget = { query: "gymshark", channelId: null, tag: null };
    const parsed = adapterResultSchema.parse({
      items: [item],
      canaryCount: entries.length,
      rawBody: SAMPLE_RSS,
      status: 200,
    });
    expect(parsed.items[0]?.dedupKey).toBe(item.dedupKey);
    expect(target.query).toBe("gymshark");
    expect(parsed.canaryCount).toBe(1);
    expect(parsed.rawBody).toBe(SAMPLE_RSS);
    expect(adapterResultSchema.safeParse({ items: [], canaryCount: -1, rawBody: "", status: 200 }).success).toBe(
      false,
    );
  });

  it("reads feed fields the adapters share, and starts with an empty registry", () => {
    expect(textOf("  Ada  ")).toBe("Ada");
    expect(textOf({ name: "Ada" })).toBe("Ada");
    expect(blankToNull("  ")).toBeNull();
    expect(publisherHost({ url: "https://advertisinglaw.fkks.com/story" })).toBe(
      "advertisinglaw.fkks.com",
    );
    expect(
      viewsFromMedia({ "media:community": { "media:statistics": { "@_views": "12" } } }),
    ).toBe(12);

    const missing: MentionAdapter | null = adapterFor("not-a-plugin");
    expect(missing).toBeNull();
    expect(new UpstreamStatus("hn.algolia", 429).status).toBe(429);
    expect(typeof fetchUpstream).toBe("function");
  });
});
