import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAdsByAccountOwner, parseAdCards } from "~/lib/sources/linkedin-ads/linkedin-ad-library.server";
import type { AppEnv } from "~/lib/env.server";

const FIXTURE_DIR = "tests/fixtures/linkedin-ad-library";

function fixture(name: string): string {
  return readFileSync(`${FIXTURE_DIR}/${name}`, "utf8");
}

/** Build a Decodo v2/scrape success response wrapping the given HTML. */
function decodoOk(html: string, statusCode = 200): Response {
  return Response.json({
    results: [{ content: html, status_code: statusCode, url: "https://www.linkedin.com/ad-library/search", task_id: "t1" }],
  });
}

/** Build a Decodo response whose result carries a failure status_code. */
function decodoStatus(statusCode: number, html = ""): Response {
  return Response.json({
    results: [{ content: html, status_code: statusCode, url: "https://www.linkedin.com/ad-library/search", task_id: "t1" }],
  });
}

const baseEnv = {
  DECODO_SCRAPER_AUTH: "dXNlcjpwYXNz",
} satisfies Partial<AppEnv> as AppEnv;

describe("parseAdCards", () => {
  it("parses 24 ad cards from page 1, all by the advertiser", () => {
    const cards = parseAdCards(fixture("page-1.html"));
    expect(cards).toHaveLength(24);
    for (const card of cards) {
      expect(card.advertiser).toBe("Notion");
      expect(card.id).toMatch(/^\d+$/);
      expect(card.detailUrl).toBe(`https://www.linkedin.com/ad-library/detail/${card.id}`);
      expect(card.text.length).toBeGreaterThan(0);
      expect(card.creativeImageUrl).toContain("media.licdn.com");
    }
    // First and last cards have their own creative, not a neighbor's.
    expect(cards[0]!.id).toBe("1001");
    expect(cards[0]!.creativeImageUrl).toContain("ad1001");
    expect(cards[23]!.id).toBe("1024");
    expect(cards[23]!.creativeImageUrl).toContain("ad1024");
  });

  it("parses 24 different ad cards from page 2", () => {
    const cards = parseAdCards(fixture("page-2.html"));
    expect(cards).toHaveLength(24);
    expect(cards[0]!.id).toBe("2001");
    expect(cards[23]!.id).toBe("2024");
  });

  it("parses zero cards from the zero-ads fixture", () => {
    expect(parseAdCards(fixture("zero-ads.html"))).toHaveLength(0);
  });

  it("parses zero cards from the parse-break fixture", () => {
    expect(parseAdCards(fixture("parse-break.html"))).toHaveLength(0);
  });

  it("parses all three cards from the ambiguous fixture", () => {
    const cards = parseAdCards(fixture("ambiguous.html"));
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.advertiser)).toEqual(["Notion", "NotionHQ", "Notion"]);
  });
});

describe("fetchAdsByAccountOwner", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns unavailable no_credentials when DECODO_SCRAPER_AUTH is unset", async () => {
    const result = await fetchAdsByAccountOwner({} as AppEnv, "Notion");
    expect(result).toEqual({ unavailable: true, reason: "no_credentials" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches page 1 and returns the normalized ad list for an exact advertiser", async () => {
    fetchMock.mockResolvedValueOnce(decodoOk(fixture("page-1.html")));
    const result = await fetchAdsByAccountOwner(baseEnv, "Notion", { maxAds: 25 });
    expect("unavailable" in result).toBe(false);
    if ("unavailable" in result) return;
    expect(result.accountOwner).toBe("Notion");
    expect(result.totalAds).toBe(24);
    expect(result.ambiguous).toBe(false);
    expect(result.ads).toHaveLength(24);
    expect(result.ads[0]!.advertiser).toBe("Notion");
    // Exactly one Decodo request, POST, with the standard pool and Basic auth.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://scraper-api.decodo.com/v2/scrape");
    expect(init).toMatchObject({ method: "POST" });
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Basic dXNlcjpwYXNz" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ target: "universal", proxy_pool: "standard" });
    expect(body.url).toContain("accountOwner=Notion");
    expect(body.url).toContain("geo=United+States");
    // must-not: JS rendering (`headless`) and the premium pool. Asserted on the
    // serialized body so an added `headless` key fails here, not in production.
    expect(JSON.stringify(body)).not.toContain("headless");
    expect(body.proxy_pool).toBe("standard");
    // Page 1 only (start=0): no pagination parameter may reach the upstream URL.
    expect(body.url).not.toContain("start=");
    // One attempt: the request carries a timeout signal and no retry options.
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps only exact case-insensitive name matches and flags ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(decodoOk(fixture("ambiguous.html")));
    const result = await fetchAdsByAccountOwner(baseEnv, "notion");
    if ("unavailable" in result) throw new Error("expected available");
    expect(result.ambiguous).toBe(true);
    expect(result.totalAds).toBe(2);
    expect(result.ads.map((a) => a.id)).toEqual(["3001", "3003"]);
  });

  it("returns unavailable decodo_status_613 on Decodo failure status", async () => {
    fetchMock.mockResolvedValueOnce(decodoStatus(613));
    const result = await fetchAdsByAccountOwner(baseEnv, "Notion");
    expect(result).toEqual({ unavailable: true, reason: "decodo_status_613" });
  });

  it("returns unavailable on any non-200 upstream status", async () => {
    fetchMock.mockResolvedValueOnce(decodoStatus(403));
    const result = await fetchAdsByAccountOwner(baseEnv, "Notion");
    expect(result).toEqual({ unavailable: true, reason: "decodo_status_403" });
  });

  it("returns unavailable parse_break on zero cards with no Promoted text", async () => {
    fetchMock.mockResolvedValueOnce(decodoOk(fixture("parse-break.html")));
    const result = await fetchAdsByAccountOwner(baseEnv, "Notion");
    expect(result).toEqual({ unavailable: true, reason: "parse_break" });
  });

  it("returns an empty (available) list for the zero-ads fixture", async () => {
    // zero-ads.html has zero cards and carries the "Promoted" label, so it is
    // the available empty-library branch of do:1, not the parse break that
    // parse-break.html encodes (zero cards AND no "Promoted" text).
    fetchMock.mockResolvedValueOnce(decodoOk(fixture("zero-ads.html")));
    const result = await fetchAdsByAccountOwner(baseEnv, "Notion");
    if ("unavailable" in result) throw new Error("expected available");
    expect(result.totalAds).toBe(0);
    expect(result.ads).toEqual([]);
    expect(result.ambiguous).toBe(false);
  });

  it("returns unavailable fetch_error when the network call throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const result = await fetchAdsByAccountOwner(baseEnv, "Notion");
    expect(result).toEqual({ unavailable: true, reason: "fetch_error" });
  });

  it("returns unavailable decodo_http_429 when the Decodo API itself errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const result = await fetchAdsByAccountOwner(baseEnv, "Notion");
    expect(result).toEqual({ unavailable: true, reason: "decodo_http_429" });
  });

  it("respects maxAds and truncates the returned list", async () => {
    fetchMock.mockResolvedValueOnce(decodoOk(fixture("page-1.html")));
    const result = await fetchAdsByAccountOwner(baseEnv, "Notion", { maxAds: 5 });
    if ("unavailable" in result) throw new Error("expected available");
    expect(result.ads).toHaveLength(5);
    expect(result.totalAds).toBe(5);
  });
});
