import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { domainsFromHit, hnCoMentions, HN_GENERATOR } from "../../../app/lib/discovery/generators/hn";
import { googleNewsRoundups, NEWS_GENERATOR, parseNewsFeed } from "../../../app/lib/discovery/generators/news";
import {
  cleanCandidateName,
  likeListNames,
  namesFromTitle,
  stripPublisherSuffix,
  titleLeadListNames,
  versusNames,
} from "../../../app/lib/discovery/names";

const GNEWS_XML = readFileSync("tests/fixtures/gnews-gymshark-2026-09-22.xml", "utf8");
const GNEWS_VS_XML = readFileSync("tests/fixtures/gnews-vs-gymshark-2026-09-22.xml", "utf8");
const GNEWS_LIKE_XML = readFileSync("tests/fixtures/gnews-like-gymshark-2026-09-22.xml", "utf8");
const HN_JSON = JSON.parse(readFileSync("tests/fixtures/hn-gymshark-2026-09-22.json", "utf8")) as {
  nbHits: number;
  hits: Record<string, unknown>[];
};

const GYMSHARK = { name: "Gymshark", domain: "gymshark.com" };

describe("parseNewsFeed", () => {
  const items = parseNewsFeed(GNEWS_XML);

  it("parses every item with title, link and publisher domain", () => {
    expect(items.length).toBeGreaterThanOrEqual(40);
    expect(items[0]?.title).toContain("activewear");
    expect(items[0]?.link).toContain("news.google.com/rss/articles/");
    expect(items[0]?.publisherDomain).toBe("gq-magazine.co.uk");
  });

  it("keeps publisher domains off the google redirect", () => {
    const domains = new Set(items.map((i) => i.publisherDomain));
    expect(domains.has("gq-magazine.co.uk")).toBe(true);
    expect(domains.has("marieclaire.co.uk")).toBe(true);
    expect(domains.has("news.google.com")).toBe(false);
  });
});

describe("name extractors", () => {
  it("strips the publisher suffix", () => {
    expect(stripPublisherSuffix("The best activewear brands - British GQ")).toBe(
      "The best activewear brands",
    );
  });

  it("reads a leading capitalised list", () => {
    expect(titleLeadListNames("Uniqlo, Gymshark and Lush stop hiring UK workers - The Guardian", "Gymshark"))
      .toEqual(["Uniqlo", "Lush"]);
  });

  it("reads brands after 'like'", () => {
    expect(likeListNames("Brands Like Gymshark, Helimix, and Ghost - Net Influencer", "Gymshark"))
      .toEqual(expect.arrayContaining(["Helimix", "Ghost"]));
  });

  it("reads both sides of a versus title minus the subject", () => {
    expect(versusNames("GYMSHARK vs SHARKYS GYM: BOIP refuses registration - Dirkzwager", "Gymshark"))
      .toEqual(["SHARKYS GYM"]);
  });

  it("cleans enumeration and review noise", () => {
    expect(cleanCandidateName("1. Alphalete Athletics")).toBe("Alphalete Athletics");
    expect(cleanCandidateName("Vuori Review:")).toBe("Vuori");
    expect(cleanCandidateName("Follow us on Instagram")).toBe("Follow us on Instagram");
    expect(cleanCandidateName("https://example.com")).toBeNull();
    expect(cleanCandidateName("a")).toBeNull();
  });

  it("namesFromTitle merges the patterns without duplicates", () => {
    const names = namesFromTitle("Uniqlo, Gymshark and Lush stop hiring UK workers", "Gymshark");
    expect(names).toEqual(["Uniqlo", "Lush"]);
  });
});

describe("hn co-mentions", () => {
  it("extracts registrable domains from hit urls and entity-encoded comment links", () => {
    const hit = HN_JSON.hits.find((h) => h["objectID"] === "42603967") ?? {};
    const domains = domainsFromHit(hit, "gymshark.com");
    expect(domains).toContain("theguardian.com");
    expect(domains).not.toContain("gymshark.com");
  });

  it("decodes &#x2F; href entities in comment_text", () => {
    const domains = domainsFromHit(
      { comment_text: 'see <a href="https:&#x2F;&#x2F;adlibrary.com&#x2F;brands&#x2F;gymshark">this</a>' },
      "gymshark.com",
    );
    expect(domains).toContain("adlibrary.com");
  });

  it("emits candidates with domain and evidence from a fixture feed", async () => {
    const fetchImpl = async () => new Response(JSON.stringify(HN_JSON), { status: 200 });
    const candidates = await hnCoMentions(GYMSHARK, { fetchImpl: fetchImpl as typeof fetch });
    const byDomain = new Map(candidates.map((c) => [c.domain, c]));
    expect(byDomain.has("theguardian.com")).toBe(true);
    expect(byDomain.get("theguardian.com")?.evidence[0]?.generator).toBe(HN_GENERATOR);
    expect(byDomain.get("theguardian.com")?.evidence[0]?.sourceUrl).toContain("news.ycombinator.com/item?id=42603967");
    expect(candidates.every((c) => c.domain !== "gymshark.com")).toBe(true);
  });
});

describe("googleNewsRoundups", () => {
  it("emits title-pattern candidates with publisher evidence from the three real feeds", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rss/search")) {
        const q = decodeURIComponent(url);
        const xml = q.includes(" alternatives")
          ? GNEWS_XML
          : q.includes(" vs") && !q.includes("like")
            ? GNEWS_VS_XML
            : GNEWS_LIKE_XML;
        return new Response(xml, { status: 200 });
      }
      return new Response("<html><body><h2>Navigation</h2></body></html>", { status: 200 });
    };
    const candidates = await googleNewsRoundups(GYMSHARK, { fetchImpl: fetchImpl as typeof fetch });
    const names = candidates.map((c) => c.name);
    expect(names).toContain("Helimix");
    expect(names).toContain("Ghost");
    expect(names).toContain("SHARKYS GYM");
    const helimix = candidates.find((c) => c.name === "Helimix");
    expect(helimix?.evidence[0]?.generator).toBe(NEWS_GENERATOR);
    expect(helimix?.evidence[0]?.publisherDomain).toBeTruthy();
    expect(names).not.toContain("Gymshark");
  });
});
