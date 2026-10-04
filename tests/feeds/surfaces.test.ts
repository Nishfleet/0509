import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertFeedRow } from "../../app/components/alert-row";
import { ContentRow, type ContentAlertItem } from "../../app/components/content-row";
import { COVERAGE, FEATURES, LIVE_COVERAGE, WATCHED_NOUNS } from "../../app/lib/coverage";
import { countByKind, filterFeed } from "../../app/lib/developments";
import { firstSiteSweepAt } from "../../app/lib/onboarding/arrival-estimate";
import { SOURCE_KINDS, effectiveKindSql } from "../../app/lib/source-kind";
import { sourceKindNoun, sourceName } from "../../app/lib/source-name";

const POST: ContentAlertItem = {
  id: "sig-1",
  title: "Launching Rival 2",
  brand: "Rival",
  excerpt: "A big release",
  url: "https://rival.com/blog/2",
  at: "2026-10-01T00:00:00.000Z",
  when: "1 day ago",
};

describe("a content row", () => {
  it("names the brand and says it published a new post, and links out in a new tab", () => {
    const html = renderToStaticMarkup(createElement(ContentRow, { content: POST }));
    expect(html).toContain("Rival published a new post");
    expect(html).toContain('href="https://rival.com/blog/2"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("A big release");
  });

  it("prints the post title once, not again in the brand sentence", () => {
    const html = renderToStaticMarkup(
      createElement(ContentRow, { content: { ...POST, title: "Spring pricing update", brand: "Gymshark" } }),
    );
    expect(html.split("Spring pricing update")).toHaveLength(2);
    expect(html).toContain("Gymshark published a new post");
  });

  it("leaves the excerpt line out when the feed gave none", () => {
    const html = renderToStaticMarkup(createElement(ContentRow, { content: { ...POST, excerpt: null } }));
    expect(html).not.toContain("A big release");
  });

  it("is what the alerts feed renders for a content item", () => {
    const html = renderToStaticMarkup(
      createElement(AlertFeedRow, {
        item: { kind: "content", id: POST.id, at: POST.at, content: POST },
        eager: false,
      }),
    );
    expect(html).toContain('data-testid="content-row"');
  });
});

describe("source kinds", () => {
  it("names a feed source by its platform, never as a site check", () => {
    expect(sourceName("content", "feed")).toBe("Blog and changelog posts");
    expect(sourceKindNoun("content")).toBe("posts");
    expect(sourceName("site", "web")).toBe("Website checks");
  });

  it("reports a feed source as the content kind in SQL and leaves every other platform as it is", () => {
    expect(effectiveKindSql("s")).toBe("CASE WHEN s.platform = 'feed' THEN 'content' ELSE s.kind END");
    expect(SOURCE_KINDS).toContain("content");
  });

  it("does not count a feed source as a scheduled site sweep", () => {
    const now = new Date("2026-10-02T00:30:00Z");
    const feed = { key: "feed.rss", kind: "content", platform: "feed" } as const;
    const site = { key: "site.web", kind: "site", platform: "web" } as const;
    expect(firstSiteSweepAt({ now, sources: [feed] })).toBeNull();
    expect(firstSiteSweepAt({ now, sources: [feed, site] })).toEqual(new Date("2026-10-02T06:00:00Z"));
  });
});

describe("the developments feed", () => {
  const items = [
    { id: "a", kind: "content", title: "Post", summary: null, url: null, observedAt: "2026-10-01T00:00:00Z" },
    { id: "b", kind: "change", title: "Change", summary: null, url: null, observedAt: "2026-10-01T00:00:00Z" },
  ] as const;

  it("counts and filters content on its own", () => {
    expect(countByKind(items)).toMatchObject({ all: 2, content: 1, change: 1 });
    expect(filterFeed(items, "content").map((item) => item.id)).toEqual(["a"]);
  });
});

describe("coverage", () => {
  it("lists the feeds as live, so the public claim names them", () => {
    const group = COVERAGE.find((entry) => entry.kind === "Blog and changelog");
    expect(group?.sources).toEqual([
      { id: "content.feed", label: "Blog and changelog feeds", live: true, sourceKey: "feed.rss" },
    ]);
    expect(LIVE_COVERAGE.some((entry) => entry.kind === "Blog and changelog")).toBe(true);
    expect(WATCHED_NOUNS).toContain("blog and changelog posts");
    expect(FEATURES.join(" ")).toContain("Blog and changelog");
  });
});
