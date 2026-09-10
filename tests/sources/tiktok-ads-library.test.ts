import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchAds,
  parseTiktokLibraryHtml,
  renderTiktokLibrary,
  resolveAdvertiser,
} from "~/lib/sources/tiktok-ads/tiktok-ad-library.server";

const FIXTURES = path.join(__dirname, "..", "fixtures", "tiktok-ad-library");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

const exactHtml = readFixture("exact-advertiser.html");
const resolveHtml = readFixture("resolve-keyword.html");
const zeroHtml = readFixture("zero-ads.html");
const parseBreakHtml = readFixture("parse-break.html");
const decodo613Body = JSON.parse(readFixture("decodo-613.json"));

/**
 * Build a Decodo "universal + headless:html" 200 response wrapping the given
 * rendered HTML (or a JSON body) in the `{ content: { html } }` shape.
 */
function decodoOk(body: unknown = {}) {
  const payload =
    typeof body === "string"
      ? { content: { html: body } }
      : body;
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

function decodoStatus(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const baseEnv = {
  DECODO_SCRAPER_AUTH: "dGVzdC1hdXRo",
} as never;

// Default budget mock: allow all renders (no KV wired).
vi.mock("~/lib/decodo-budget.server", () => ({
  reserveDecodoBudget: vi.fn().mockResolvedValue({ ok: true, reason: "no_kv" }),
}));

const { reserveDecodoBudget } = await import("~/lib/decodo-budget.server");

describe("parseTiktokLibraryHtml", () => {
  it("extracts 12 ads with correct fields and totalAds 12 from exact-advertiser.html", () => {
    const parsed = parseTiktokLibraryHtml(exactHtml);
    expect(parsed.totalAds).toBe(12);
    expect(parsed.ads).toHaveLength(12);
    const first = parsed.ads[0];
    expect(first.adId).toBe("100000000001");
    expect(first.advertiser).toBe("NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED");
    expect(first.firstShown).toBe("01/15/2026");
    expect(first.lastShown).toBe("02/20/2026");
    expect(first.uniqueUsers).toBe("5000");
    expect(first.thumbnail).toBe("https://p16-sign.tiktokcdn.com/thumb-1.jpg");
    // A card without an <img> has a null thumbnail.
    const second = parsed.ads[1];
    expect(second.thumbnail).toBeNull();
    // A card with "-" unique users keeps the raw text.
    const third = parsed.ads[2];
    expect(third.uniqueUsers).toBe("-");
    // Last card adId.
    expect(parsed.ads[11].adId).toBe("100000000012");
  });

  it("returns ads [] and totalAds 0 from zero-ads.html (real zero)", () => {
    const parsed = parseTiktokLibraryHtml(zeroHtml);
    expect(parsed.totalAds).toBe(0);
    expect(parsed.ads).toEqual([]);
  });

  it("returns totalAds null and ads [] from parse-break.html (no header, no cards)", () => {
    const parsed = parseTiktokLibraryHtml(parseBreakHtml);
    expect(parsed.totalAds).toBeNull();
    expect(parsed.ads).toEqual([]);
  });
});

describe("resolveAdvertiser", () => {
  beforeEach(() => {
    vi.mocked(reserveDecodoBudget).mockResolvedValue({ ok: true, reason: "no_kv" });
    vi.restoreAllMocks();
  });

  it("picks the candidate with the most cards whose name contains the competitor", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoOk(resolveHtml));
    const result = await resolveAdvertiser(baseEnv, "new balance");
    expect(result).toEqual({
      legalName: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
      candidates: ["NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED"],
    });
    // query_type=1 (keyword) was used.
    const call = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(call?.[1]?.body));
    expect(call?.[1]?.method).toBe("POST");
    expect(body.url).toContain("query_type=1");
    expect(body.url).toContain("adv_name=new+balance");
    expect(body.proxy_pool).toBe("standard");
    fetchSpy.mockRestore();
  });

  it("returns unavailable no_match when no card advertiser contains the competitor", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoOk(resolveHtml));
    const result = await resolveAdvertiser(baseEnv, "acme nonexistent brand");
    expect(result).toEqual({ unavailable: true, reason: "no_match" });
    fetchSpy.mockRestore();
  });

  it("returns unavailable quota on Decodo 613", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoStatus(613, decodo613Body));
    const result = await resolveAdvertiser(baseEnv, "new balance");
    expect(result).toEqual({ unavailable: true, reason: "quota" });
    fetchSpy.mockRestore();
  });

  it("returns unavailable quota on Decodo 200 body with status 613", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoOk(decodo613Body));
    const result = await resolveAdvertiser(baseEnv, "new balance");
    expect(result).toEqual({ unavailable: true, reason: "quota" });
    fetchSpy.mockRestore();
  });
});

describe("fetchAds", () => {
  beforeEach(() => {
    vi.mocked(reserveDecodoBudget).mockResolvedValue({ ok: true, reason: "no_kv" });
    vi.restoreAllMocks();
  });

  it("returns 12 ads and totalAds 12 from exact-advertiser.html", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoOk(exactHtml));
    const result = await fetchAds(baseEnv, "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED");
    expect("unavailable" in result).toBe(false);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.ads).toHaveLength(12);
    expect(result.totalAds).toBe(12);
    // query_type=2 (exact advertiser) was used.
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.url).toContain("query_type=2");
    fetchSpy.mockRestore();
  });

  it("returns ads [] and totalAds 0 from zero-ads.html (NOT unavailable)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoOk(zeroHtml));
    const result = await fetchAds(baseEnv, "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED");
    expect("unavailable" in result).toBe(false);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.ads).toEqual([]);
    expect(result.totalAds).toBe(0);
    fetchSpy.mockRestore();
  });

  it("returns unavailable parse_break from parse-break.html (no header, no cards)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoOk(parseBreakHtml));
    const result = await fetchAds(baseEnv, "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED");
    expect(result).toEqual({ unavailable: true, reason: "parse_break" });
    fetchSpy.mockRestore();
  });

  it("returns unavailable quota on Decodo 613", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoStatus(613, decodo613Body));
    const result = await fetchAds(baseEnv, "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED");
    expect(result).toEqual({ unavailable: true, reason: "quota" });
    fetchSpy.mockRestore();
  });

  it("returns unavailable decodo_error on non-200 (non-613)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoStatus(500, { error: "boom" }));
    const result = await fetchAds(baseEnv, "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED");
    expect(result).toEqual({ unavailable: true, reason: "decodo_error", status: 500 });
    fetchSpy.mockRestore();
  });
});

describe("renderTiktokLibrary budget gate", () => {
  it("returns unavailable quota WITHOUT calling fetch when the budget denies", async () => {
    vi.mocked(reserveDecodoBudget).mockResolvedValueOnce({ ok: false, reason: "quota" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(decodoOk(exactHtml));
    const result = await renderTiktokLibrary(baseEnv, {
      queryType: 2,
      advName: "x",
    });
    expect(result).toEqual({ unavailable: true, reason: "quota" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
