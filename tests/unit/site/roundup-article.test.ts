import { describe, expect, it } from "vitest";

import { newsGenerator } from "../../../app/lib/discovery/generators/news";
import { harvestHeadings } from "../../../app/lib/discovery/roundup-article";
import type { FetchText, Subject } from "../../../app/lib/discovery/types";

const SUBJECT: Subject = { name: "Gymshark", domain: "gymshark.com" };

const ROUNDUP = `<article>
  <h2>1. Alphalete Athletics</h2>
  <h2>Best overall: Lululemon Align</h2>
  <h3>2) Gymshark</h3>
  <h2>how we tested</h2>
  <h2>1. Alphalete <em>Athletics</em></h2>
</article>`;

const ARTICLE_URL = "https://www.glamourmagazine.co.uk/article/best-leggings";

const ARTICLE_BODY = "<article><h2>1. Alphalete Athletics</h2></article>";

const ITEM_TITLE = "The best gym leggings for lifts, tried and tested - Glamour UK";

const FEED_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Gymshark news</title>
    <link>https://news.google.com/</link>
    <description>Google News</description>
    <item>
      <title>${ITEM_TITLE}</title>
      <link>https://news.google.com/rss/articles/X</link>
    </item>
  </channel>
</rss>`;

function fetchTextWithArticle(articleUrl: string, articleRequests: string[] = []): FetchText {
  return async (url) => {
    if (url.startsWith("https://news.google.com/rss/search")) {
      return { ok: true, url, contentType: "application/rss+xml", body: FEED_BODY };
    }
    articleRequests.push(url);
    return { ok: true, url: articleUrl, contentType: "text/html", body: ARTICLE_BODY };
  };
}

describe("harvestHeadings", () => {
  it("reads a roundup's ranked headings as brand names", async () => {
    const names = await harvestHeadings(ROUNDUP, SUBJECT.name);

    expect(names).toEqual(["Alphalete Athletics", "Lululemon Align"]);
  });

  it("keeps the first spelling of a heading a nested element splits in two", async () => {
    const names = await harvestHeadings("<h2>1. Alphalete <em>Athletics</em></h2>", SUBJECT.name);

    expect(names).toEqual(["Alphalete Athletics"]);
  });

  it("drops the brand itself and every heading without a leading capital", async () => {
    const names = await harvestHeadings(
      "<h2>2) Gymshark</h2><h2>how we tested</h2><h2>1. Lululemon Align</h2>",
      SUBJECT.name,
    );

    expect(names).toEqual(["Lululemon Align"]);
  });

  it("returns nothing when the page has no h2 or h3", async () => {
    const names = await harvestHeadings("<h1>Best leggings</h1><p>1. Alphalete</p>", SUBJECT.name);

    expect(names).toEqual([]);
  });

  it("takes the brand out of a heading whose label sits in a nested tag", async () => {
    const names = await harvestHeadings(
      "<h3><span>Top pick:</span>Alphalete Athletics</h3>",
      SUBJECT.name,
    );

    expect(names).toEqual(["Alphalete Athletics"]);
  });
});

describe("newsGenerator roundup headings", () => {
  it("adds the redirected article url as evidence for a heading name", async () => {
    const candidates = await newsGenerator(SUBJECT, fetchTextWithArticle(ARTICLE_URL));

    const alphalete = candidates.find((candidate) => candidate.name === "Alphalete Athletics");
    expect(alphalete).toBeDefined();
    const evidence = alphalete?.evidence.find((item) => item.sourceUrl === ARTICLE_URL);
    expect(evidence).toBeDefined();
    expect(evidence?.excerpt).toBe(ITEM_TITLE);
    expect(evidence?.generator).toBe("news");
  });

  it("opens the alternatives-feed link once and adds only that heading", async () => {
    const articleRequests: string[] = [];
    const candidates = await newsGenerator(
      SUBJECT,
      fetchTextWithArticle(ARTICLE_URL, articleRequests),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe("Alphalete Athletics");
    expect(articleRequests).toEqual(["https://news.google.com/rss/articles/X"]);
  });

  it("adds no heading candidate when the article fetch stays on Google News", async () => {
    const candidates = await newsGenerator(
      SUBJECT,
      fetchTextWithArticle("https://news.google.com/rss/articles/X"),
    );

    expect(candidates).toEqual([]);
  });

  it("opens no article when both feed fetches fail", async () => {
    const articleRequests: string[] = [];
    const fetchText: FetchText = async (url) => {
      if (!url.startsWith("https://news.google.com/rss/search")) articleRequests.push(url);
      return { ok: false, url, contentType: null, body: "" };
    };

    const candidates = await newsGenerator(SUBJECT, fetchText);

    expect(candidates).toEqual([]);
    expect(articleRequests).toEqual([]);
  });
});
