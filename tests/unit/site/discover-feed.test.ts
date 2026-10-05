import { describe, expect, it } from "vitest";

import {
  COMMON_FEED_PATHS,
  MAX_FEED_CANDIDATES,
  feedCandidates,
  feedLinksFromHtml,
} from "../../../app/lib/feeds/discover-feed";

const HOME = "https://rival.com/";

const HOSTILE_CEILING_MS = 10_000;

// This suite runs in the workers project because feed discovery is one
// HTMLRewriter selector, and HTMLRewriter is the runtime's, not the platform's
// general. A node-environment stand-in would assert against a fake, which is
// the exact class of check the hand-rolled parser got wrong.

describe("feedLinksFromHtml", () => {
  it("finds RSS and Atom alternates, in either attribute order, with relative and absolute hrefs", async () => {
    const html = `<head>
      <link rel="alternate" type="application/rss+xml" title="Blog" href="/blog/rss">
      <link href="https://feeds.rival.com/changelog.atom" type="application/atom+xml" rel="alternate"/>
      <link rel='ALTERNATE stylesheet' TYPE='application/rss+xml' href='/odd.xml?a=1&amp;b=2'>
    </head>`;
    expect(await feedLinksFromHtml(html, HOME)).toEqual([
      "https://rival.com/blog/rss",
      "https://feeds.rival.com/changelog.atom",
      "https://rival.com/odd.xml?a=1&b=2",
    ]);
  });

  it("decodes an href's entities once, so a literal &amp; in the URL survives", async () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/feed?q=a&amp;amp;b">`;
    expect(await feedLinksFromHtml(html, HOME)).toEqual(["https://rival.com/feed?q=a&amp;b"]);
  });

  it("ignores stylesheets, canonical links, other types and non-https hrefs", async () => {
    const html = `
      <link rel="stylesheet" href="/a.css">
      <link rel="canonical" href="https://rival.com/">
      <link rel="alternate" type="text/html" href="/fr">
      <link rel="alternate" type="application/rss+xml" href="http://rival.com/insecure.xml">
      <link rel="alternate" type="application/rss+xml">
      <link rel="alternate" type="application/json" href="/feed.json">`;
    expect(await feedLinksFromHtml(html, HOME)).toEqual([]);
  });

  it("reads upper-case tags and ignores a tag that only starts with link", async () => {
    // The old scanner compared a lower-cased copy of the document, so <LINK>
    // matched and <linkage> did not. HTMLRewriter's selector does both
    // correctly against real HTML tokenisation.
    const html = `<LINK REL="alternate" TYPE="application/atom+xml" HREF="/atom.xml"><linkage rel="alternate" type="application/rss+xml" href="/nope">`;
    expect(await feedLinksFromHtml(html, HOME)).toEqual([new URL("/atom.xml", HOME).href]);
  });

  it("skips blank, whitespace-only and unresolvable hrefs and keeps a valid sibling", async () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" href="">
      <link rel="alternate" type="application/rss+xml" href="   ">
      <link rel="alternate" type="application/rss+xml" href="http://">
      <link rel="alternate" type="application/rss+xml" href="/valid.xml">
    `;
    expect(await feedLinksFromHtml(html, HOME)).toEqual([new URL("/valid.xml", HOME).href]);
  });

  it("skips a feed link with no rel attribute and keeps one with rel=alternate", async () => {
    const html = `
      <link type="application/rss+xml" href="/norel.xml">
      <link rel="alternate" type="application/rss+xml" href="/withrel.xml">
    `;
    expect(await feedLinksFromHtml(html, HOME)).toEqual([new URL("/withrel.xml", HOME).href]);
  });

  it("keeps the https sibling when the same page declares a plain-http feed", async () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" href="http://rival.com/insecure.xml">
      <link rel="alternate" type="application/rss+xml" href="/secure.xml">
    `;
    expect(await feedLinksFromHtml(html, HOME)).toEqual([new URL("/secure.xml", HOME).href]);
  });
});

describe("feedLinksFromHtml on hostile input", () => {
  it("stays fast on 2 MiB of unclosed link tags or one huge attribute run, and still finds a real link", async () => {
    const real = `<link rel="alternate" type="application/rss+xml" href="/feed.xml">`;
    const unclosed = "<link ".repeat(Math.floor((2 * 1024 * 1024) / 6));
    const longRun = `<link ${"a".repeat(2_000_000)}>`;

    for (const filler of [unclosed, longRun]) {
      const started = performance.now();
      const found = await feedLinksFromHtml(`${real}${filler}`, HOME);
      expect(performance.now() - started).toBeLessThan(HOSTILE_CEILING_MS);
      expect(found).toEqual([new URL("/feed.xml", HOME).href]);
    }
  });

  it("stops collecting after 64 declared feeds and keeps the ones it read", async () => {
    const html = Array.from(
      { length: 200 },
      (_unused, index) => `<link rel="alternate" type="application/rss+xml" href="/f${String(index)}.xml">`,
    ).join("");
    expect(await feedLinksFromHtml(html, HOME)).toHaveLength(64);
  });
});

describe("feedCandidates", () => {
  it("puts the declared feed first, then the common paths, without repeats", async () => {
    const html = `<link rel="alternate" type="application/atom+xml" href="/atom.xml">`;
    const candidates = await feedCandidates(html, HOME);
    expect(candidates[0]).toBe("https://rival.com/atom.xml");
    expect(candidates).toEqual([
      "https://rival.com/atom.xml",
      "https://rival.com/feed",
      "https://rival.com/rss.xml",
      "https://rival.com/blog/feed",
      "https://rival.com/changelog.xml",
      "https://rival.com/changelog/rss.xml",
      "https://rival.com/changelog/feed.xml",
      "https://rival.com/blog/rss.xml",
      "https://rival.com/feed.xml",
      "https://rival.com/atom",
    ]);
  });

  it("falls back to the common paths when the homepage could not be read", async () => {
    expect(await feedCandidates(null, HOME)).toEqual(COMMON_FEED_PATHS.map((path) => `https://rival.com${path}`));
  });

  it("returns nothing for a plain-http homepage and every common path for an https one", async () => {
    expect(await feedCandidates(null, "http://rival.com/")).toEqual([]);
    // The declared feed goes through the same https only guard: a site that
    // serves its whole page over plain http contributes no https candidate.
    expect(
      await feedCandidates(`<link rel="alternate" type="application/rss+xml" href="/feed.xml">`, "http://rival.com/"),
    ).toEqual([]);
    expect(await feedCandidates(null, HOME)).toEqual(COMMON_FEED_PATHS.map((path) => new URL(path, HOME).href));
  });

  it("caps the list", async () => {
    const html = Array.from(
      { length: 20 },
      (_unused, index) => `<link rel="alternate" type="application/rss+xml" href="/f${String(index)}.xml">`,
    ).join("");
    expect(await feedCandidates(html, HOME)).toHaveLength(MAX_FEED_CANDIDATES);
  });
});
