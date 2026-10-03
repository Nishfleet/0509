import { describe, expect, it } from "vitest";

import {
  COMMON_FEED_PATHS,
  MAX_FEED_CANDIDATES,
  feedCandidates,
  feedLinksFromHtml,
} from "../../app/lib/feeds/discover-feed";

const HOME = "https://rival.com/";

const HOSTILE_CEILING_MS = 10_000;

describe("feedLinksFromHtml on hostile input", () => {
  it("stays fast on 2 MiB of unclosed link tags or one huge attribute run, and still finds a real link", () => {
    const real = `<link rel="alternate" type="application/rss+xml" href="/feed.xml">`;
    const unclosed = "<link ".repeat(Math.floor((2 * 1024 * 1024) / 6));
    const longRun = `<link ${"a".repeat(2_000_000)}>`;

    for (const filler of [unclosed, longRun]) {
      const started = performance.now();
      const found = feedLinksFromHtml(`${real}${filler}`, HOME);
      expect(performance.now() - started).toBeLessThan(HOSTILE_CEILING_MS);
      expect(found).toEqual([new URL("/feed.xml", HOME).href]);
    }
  });

  it("reads upper-case tags and ignores a tag that only starts with link", () => {
    const html = `<LINK REL="alternate" TYPE="application/atom+xml" HREF="/atom.xml"><linkage rel="alternate" type="application/rss+xml" href="/nope">`;

    expect(feedLinksFromHtml(html, HOME)).toEqual([new URL("/atom.xml", HOME).href]);
  });
});

describe("feedLinksFromHtml", () => {
  it("finds RSS and Atom alternates, in either attribute order, with relative and absolute hrefs", () => {
    const html = `<head>
      <link rel="alternate" type="application/rss+xml" title="Blog" href="/blog/rss">
      <link href="https://feeds.rival.com/changelog.atom" type="application/atom+xml" rel="alternate"/>
      <link rel='ALTERNATE stylesheet' TYPE='application/rss+xml' href='/odd.xml?a=1&amp;b=2'>
    </head>`;
    expect(feedLinksFromHtml(html, HOME)).toEqual([
      "https://rival.com/blog/rss",
      "https://feeds.rival.com/changelog.atom",
      "https://rival.com/odd.xml?a=1&b=2",
    ]);
  });

  it("ignores stylesheets, canonical links, comment feeds on other types and non-https hrefs", () => {
    const html = `
      <link rel="stylesheet" href="/a.css">
      <link rel="canonical" href="https://rival.com/">
      <link rel="alternate" type="text/html" href="/fr">
      <link rel="alternate" type="application/rss+xml" href="http://rival.com/insecure.xml">
      <link rel="alternate" type="application/rss+xml">
      <link rel="alternate" type="application/json" href="/feed.json">`;
    expect(feedLinksFromHtml(html, HOME)).toEqual([]);
  });
});

describe("feedLinksFromHtml edge cases", () => {
  it("skips empty or unparseable hrefs and keeps a valid sibling", () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" href="">
      <link rel="alternate" type="application/rss+xml" href="   ">
      <link rel="alternate" type="application/rss+xml" href="http://">
      <link rel="alternate" type="application/rss+xml" href="/valid.xml">
    `;
    expect(feedLinksFromHtml(html, HOME)).toEqual([new URL("/valid.xml", HOME).href]);
  });

  it("skips a feed link with no rel attribute and keeps one with rel=alternate", () => {
    const html = `
      <link type="application/rss+xml" href="/norel.xml">
      <link rel="alternate" type="application/rss+xml" href="/withrel.xml">
    `;
    expect(feedLinksFromHtml(html, HOME)).toEqual([new URL("/withrel.xml", HOME).href]);
  });
});

describe("feedCandidates", () => {
  it("puts the declared feed first, then the common paths, without repeats", () => {
    const html = `<link rel="alternate" type="application/atom+xml" href="/atom.xml">`;
    const candidates = feedCandidates(html, HOME);
    expect(candidates[0]).toBe("https://rival.com/atom.xml");
    expect(candidates).toHaveLength(COMMON_FEED_PATHS.length);
    expect(candidates).toEqual([
      "https://rival.com/atom.xml",
      "https://rival.com/feed",
      "https://rival.com/rss.xml",
      "https://rival.com/blog/feed",
      "https://rival.com/changelog.xml",
    ]);
  });

  it("falls back to the common paths when the homepage could not be read", () => {
    expect(feedCandidates(null, "https://rival.com/")).toEqual(
      COMMON_FEED_PATHS.map((path) => `https://rival.com${path}`),
    );
  });

  it("returns nothing for a plain-http homepage and every common path for an https one", () => {
    expect(feedCandidates(null, "http://rival.com/")).toEqual([]);
    expect(feedCandidates(null, HOME)).toEqual(COMMON_FEED_PATHS.map((path) => new URL(path, HOME).href));
  });

  it("caps the list", () => {
    const html = Array.from(
      { length: 20 },
      (_unused, index) => `<link rel="alternate" type="application/rss+xml" href="/f${String(index)}.xml">`,
    ).join("");
    expect(feedCandidates(html, HOME)).toHaveLength(MAX_FEED_CANDIDATES);
  });
});
