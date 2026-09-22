import { describe, expect, it } from "vitest";

import {
  allSourcesDown,
  andMoreLabel,
  applyCanary,
  d5Action,
  d8Collapses,
  isPolled,
  mentionWhen,
  pickSurvivor,
  queueFor,
  readSourceConfig,
  showInDefaultFeed,
  snapshotPlan,
  sourcePill,
  splitMessages,
  upgradedCanonical,
} from "../../workers/mentions/map";
import { parseGoogleNews } from "../../workers/sources/mentions/google-news";
import { parseMedium } from "../../workers/sources/mentions/medium";
import { parseReddit } from "../../workers/sources/mentions/reddit";

const GOOGLE = `<?xml version="1.0"?><rss version="2.0"><channel><item>
<title>Gymshark sued</title>
<link>https://news.google.com/rss/articles/ABC</link>
<guid isPermaLink="false">ABC</guid>
<pubDate>Mon, 21 Sep 2026 12:00:00 GMT</pubDate>
<source url="https://advertisinglaw.fkks.com">FKKS</source>
</item></channel></rss>`;

const REDDIT = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>t5_3atwd</id><title>old sub</title><updated>2015-11-16T00:00:00Z</updated><link href="https://www.reddit.com/r/old"/></entry>
<entry><id>t3_new</id><title>new post</title><updated>2026-09-21T00:00:00Z</updated><link href="https://www.reddit.com/r/x/comments/new"/></entry>
<entry><id>t3_old</id><title>older post</title><updated>2020-01-01T00:00:00Z</updated><link href="https://www.reddit.com/r/x/comments/old"/></entry>
</feed>`;

const MEDIUM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry>
<id>https://medium.com/p/bd5a0a82d407</id>
<title>A post</title>
<link href="https://medium.com/p/bd5a0a82d407?source=rss------startup-1"/>
<updated>2026-09-21T00:00:00Z</updated>
</entry>
</feed>`;

describe("mention mapping", () => {
  it("keeps the Google URL and the publisher host", () => {
    const [item] = parseGoogleNews(GOOGLE);
    expect(item?.canonicalUrl).toBe("https://news.google.com/rss/articles/ABC");
    expect(item?.publisher).toBe("advertisinglaw.fkks.com");
    expect(item?.dedupKey).toBe("ABC");
  });

  it("drops t5 rows and sorts Reddit by updated", () => {
    const items = parseReddit(REDDIT);
    expect(items.map((item) => item.dedupKey)).toEqual(["t3_new", "t3_old"]);
  });

  it("uses the Medium guid, not the tagged link", () => {
    const [item] = parseMedium(MEDIUM);
    expect(item?.canonicalUrl).toBe("https://medium.com/p/bd5a0a82d407");
    expect(item?.canonicalUrl).not.toContain("source=rss");
  });

  it("says found today when published_at is null", () => {
    const now = new Date("2026-09-22T18:00:00.000Z");
    expect(mentionWhen(null, "2026-09-22T01:00:00.000Z", "UTC", now)).toBe("found today");
    expect(mentionWhen(null, "2026-09-20T01:00:00.000Z", "UTC", now)).toMatch(/^found /);
  });

  it("keeps the earlier row and breaks ties toward the more reliable source", () => {
    const earlier = pickSurvivor([
      { id: "new", observedAt: "2026-09-22T00:00:00.000Z", reliability: "official_api", canonicalUrl: "https://publisher.example/a" },
      { id: "old", observedAt: "2026-09-21T00:00:00.000Z", reliability: "rss", canonicalUrl: "https://news.google.com/rss/articles/ABC" },
    ]);
    expect(earlier.id).toBe("old");
    const tie = pickSurvivor([
      { id: "rss", observedAt: "2026-09-21T00:00:00.000Z", reliability: "rss", canonicalUrl: "https://news.google.com/rss/articles/ABC" },
      { id: "api", observedAt: "2026-09-21T00:00:00.000Z", reliability: "official_api", canonicalUrl: "https://publisher.example/a" },
    ]);
    expect(tie.id).toBe("api");
  });

  it("upgrades a Google URL when the other row has a publisher URL", () => {
    expect(
      upgradedCanonical("https://news.google.com/rss/articles/ABC", "https://advertisinglaw.fkks.com/post"),
    ).toBe("https://advertisinglaw.fkks.com/post");
    expect(upgradedCanonical("https://publisher.example/a", "https://news.google.com/rss/articles/ABC")).toBeNull();
  });

  it("hides collapsed rows and show-all rows from the default feed", () => {
    expect(showInDefaultFeed({ publisher: null, collapsed_into: "surv" })).toBe(false);
    expect(showInDefaultFeed({ publisher: null, d6: "show_all" })).toBe(false);
    expect(showInDefaultFeed({ publisher: "advertisinglaw.fkks.com", d6: "feed" })).toBe(true);
    expect(andMoreLabel(1)).toBe("and 1 more");
    expect(andMoreLabel(0)).toBeNull();
  });

  it("reuses the R2 key when the hash is unchanged and still judges unreviewed items", () => {
    expect(snapshotPlan({ previousHash: "a", nextHash: "a", hasUnreviewed: false, alreadyToday: false })).toEqual({
      writeRow: true,
      reuseKey: true,
      judge: false,
    });
    expect(snapshotPlan({ previousHash: "a", nextHash: "a", hasUnreviewed: true, alreadyToday: false }).judge).toBe(true);
    expect(d5Action(0.05)).toBe("drop");
    expect(d5Action(0.5)).toBe("possibly");
    expect(d5Action(0.95)).toBe("keep");
    expect(d8Collapses(0.5)).toBe(true);
    expect(d8Collapses(0.05)).toBe(false);
  });

  it("marks a zero canary degraded and clears it when the count returns", () => {
    const base = readSourceConfig('{"rateClass":"fast","canaryUrl":"https://example.test","expectNonzero":true,"approved_cost":null}');
    const down = applyCanary(base, 0, "2026-09-22T00:00:00.000Z");
    expect(down.degradedSince).toBe("2026-09-22T00:00:00.000Z");
    expect(down.approved_cost).toBeNull();
    const up = applyCanary(down, 3, "2026-09-23T00:00:00.000Z");
    expect(up.degradedSince).toBeNull();
    expect(up.lastCanaryCount).toBe(3);
  });

  it("does not render a disabled source", () => {
    const disabled = {
      pluginKey: "x.apify",
      label: "X",
      isEnabled: false,
      degradedSince: "2026-09-22T00:00:00.000Z",
      degradedReason: "closed",
      lastGoodAt: null,
      lastSnapshotAt: null,
    };
    expect(sourcePill(disabled)).toBeNull();
    expect(allSourcesDown([disabled, { ...disabled, pluginKey: "hn.algolia", label: "Hacker News", isEnabled: true, degradedSince: null }])).toBe(false);
    expect(
      allSourcesDown([{ ...disabled, pluginKey: "hn.algolia", label: "Hacker News", isEnabled: true }]),
    ).toBe(true);
  });

  it("routes Reddit and scraped pages to the paced queue", () => {
    expect(queueFor({ pluginKey: "reddit.search_rss", reliability: "rss", rateClass: "fast" })).toBe("paced");
    expect(queueFor({ pluginKey: "hn.algolia", reliability: "official_api", rateClass: "fast" })).toBe("fast");
    expect(isPolled({ entityState: "on", kind: "mentions", isEnabled: 0 })).toBe(false);
    expect(isPolled({ entityState: "off", kind: "mentions", isEnabled: 1 })).toBe(false);
    expect(isPolled({ entityState: "on", kind: "mentions", isEnabled: 1 })).toBe(true);
    const split = splitMessages([
      {
        watchId: "w",
        sourceId: "s",
        entityId: "e",
        workspaceId: "ws",
        pluginKey: "x.apify",
        reliability: "best_effort",
        rateClass: "paced",
      },
    ]);
    expect(split.paced).toHaveLength(1);
    expect(split.fast).toHaveLength(0);
  });
});
