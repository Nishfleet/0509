import { describe, expect, it } from "vitest";

import {
  fingerprintSavedQuery,
  normalizeHeadline,
  normalizeNumericPageId,
  normalizeSavedQuery,
  normalizeSearchFilters,
  parseSearchParams,
  buildSearchParams,
} from "~/lib/normalize";

describe("normalizeHeadline", () => {
  it("normalizes whitespace and casing without stripping punctuation", () => {
    expect(normalizeHeadline("  50% OFF!   Shop   Now  ")).toEqual({
      raw: "50% OFF!   Shop   Now",
      normalized: "50% off! shop now",
      hash: normalizeHeadline("50% off! shop now").hash,
    });
  });
});

describe("fingerprintSavedQuery", () => {
  it("stays stable regardless of source object key order", () => {
    const first = normalizeSavedQuery("keyword", {
      query: "cod",
      country: "India",
      platform: "Instagram",
      creativeType: "video",
      status: "active",
    });

    const second = normalizeSavedQuery("keyword", {
      status: "active",
      creativeType: "video",
      platform: "Instagram",
      country: "India",
      query: "cod",
    });

    expect(fingerprintSavedQuery(first)).toBe(fingerprintSavedQuery(second));
  });
});

describe("parseSearchParams", () => {
  it("parses keyword mode from URLSearchParams", () => {
    const params = new URLSearchParams({ mode: "keyword", query: "shoes" });
    const result = parseSearchParams(params);
    expect(result.mode).toBe("keyword");
    expect(result.filters.query).toBe("shoes");
  });

  it("accepts q as the shared-link alias for the search term", () => {
    const params = new URLSearchParams({ q: "nykaa" });
    const result = parseSearchParams(params);
    expect(result.filters.query).toBe("nykaa");
  });

  it("lets an explicit query param win when both query and q are present", () => {
    const params = new URLSearchParams({ query: "canonical", q: "shared" });
    const result = parseSearchParams(params);
    expect(result.filters.query).toBe("canonical");
  });

  it("treats an empty or whitespace q as absent", () => {
    expect(parseSearchParams(new URLSearchParams({ q: "" })).filters.query).toBe("");
    expect(
      parseSearchParams(new URLSearchParams({ q: "   " })).filters.query,
    ).toBe("");
  });

  it("fingerprints a q-param query identically to its canonical query form", () => {
    const viaQ = parseSearchParams(new URLSearchParams({ q: "nykaa", mode: "advertiser" }));
    const viaQuery = parseSearchParams(
      new URLSearchParams({ query: "nykaa", mode: "advertiser" }),
    );
    expect(viaQ.filters).toEqual(viaQuery.filters);
    expect(viaQ.fingerprint).toBe(viaQuery.fingerprint);
  });

  it("defaults to advertiser mode when mode is absent or invalid", () => {
    const paramsNoMode = new URLSearchParams({ query: "test" });
    expect(parseSearchParams(paramsNoMode).mode).toBe("advertiser");

    const paramsInvalid = new URLSearchParams({ mode: "garbage", query: "test" });
    expect(parseSearchParams(paramsInvalid).mode).toBe("advertiser");
  });

  it("applies the global-neutral 'all' default for country", () => {
    const params = new URLSearchParams({ query: "test" });
    expect(parseSearchParams(params).filters.country).toBe("all");
  });

  it("uses the caller-provided default country (visitor geo)", () => {
    const params = new URLSearchParams({ query: "test" });
    expect(parseSearchParams(params, { country: "United States" }).filters.country).toBe(
      "United States",
    );
    const explicit = new URLSearchParams({ query: "test", country: "India" });
    expect(parseSearchParams(explicit, { country: "United States" }).filters.country).toBe("India");
  });

  it("applies all default for platform", () => {
    const params = new URLSearchParams({ query: "test" });
    expect(parseSearchParams(params).filters.platform).toBe("all");
  });

  it("applies all default for creativeType and status", () => {
    const params = new URLSearchParams({ query: "test" });
    expect(parseSearchParams(params).filters.creativeType).toBe("all");
    expect(parseSearchParams(params).filters.status).toBe("all");
  });

  it("parses optional firstSeenFrom when present", () => {
    const params = new URLSearchParams({ query: "test", firstSeenFrom: "2024-01-01" });
    expect(parseSearchParams(params).filters.firstSeenFrom).toBe("2024-01-01");
  });

  it("parses optional lastSeenFrom when present", () => {
    const params = new URLSearchParams({ query: "test", lastSeenFrom: "2024-06-15" });
    expect(parseSearchParams(params).filters.lastSeenFrom).toBe("2024-06-15");
  });

  it("applies empty string default for firstSeenFrom and lastSeenFrom when absent", () => {
    const params = new URLSearchParams({ query: "test" });
    expect(parseSearchParams(params).filters.firstSeenFrom).toBe("");
    expect(parseSearchParams(params).filters.lastSeenFrom).toBe("");
  });

  it("computes fingerprint for parsed result", () => {
    const params = new URLSearchParams({ query: "cod", country: "India", platform: "Instagram" });
    const result = parseSearchParams(params);
    expect(result.fingerprint).toBeDefined();
    expect(typeof result.fingerprint).toBe("string");
    expect(result.fingerprint).toMatch(/^fnv1a-/);
  });
});

describe("buildSearchParams", () => {
  it("builds params for keyword mode", () => {
    const query = normalizeSavedQuery("keyword", { query: "shoes", country: "India", platform: "all" });
    const params = buildSearchParams(query);
    expect(params.get("mode")).toBe("keyword");
    expect(params.get("query")).toBe("shoes");
  });

  it("builds params for advertiser mode", () => {
    const query = normalizeSavedQuery("advertiser", { query: "nike", country: "US", platform: "Facebook" });
    const params = buildSearchParams(query);
    expect(params.get("mode")).toBe("advertiser");
    expect(params.get("country")).toBe("US");
    expect(params.get("platform")).toBe("Facebook");
  });

  it("includes firstSeenFrom when set", () => {
    const query = normalizeSavedQuery("keyword", {
      query: "test",
      firstSeenFrom: "2024-01-01",
      lastSeenFrom: "",
    });
    const params = buildSearchParams(query);
    expect(params.get("firstSeenFrom")).toBe("2024-01-01");
    expect(params.has("lastSeenFrom")).toBe(false);
  });

  it("includes lastSeenFrom when set", () => {
    const query = normalizeSavedQuery("keyword", {
      query: "test",
      firstSeenFrom: "",
      lastSeenFrom: "2024-06-15",
    });
    const params = buildSearchParams(query);
    expect(params.get("lastSeenFrom")).toBe("2024-06-15");
    expect(params.has("firstSeenFrom")).toBe(false);
  });

  it("omits firstSeenFrom and lastSeenFrom when empty", () => {
    const query = normalizeSavedQuery("keyword", {
      query: "test",
      firstSeenFrom: "",
      lastSeenFrom: "",
    });
    const params = buildSearchParams(query);
    expect(params.has("firstSeenFrom")).toBe(false);
    expect(params.has("lastSeenFrom")).toBe(false);
  });
});

describe("parseSearchParams + buildSearchParams round-trip", () => {
  it("round-trips from URLSearchParams through normalized query and back", () => {
    const originalParams = new URLSearchParams({
      mode: "keyword",
      query: "summer sale",
      country: "India",
      platform: "Instagram",
      creativeType: "video",
      status: "active",
      firstSeenFrom: "2024-01-01",
      lastSeenFrom: "2024-12-31",
    });

    const parsed = parseSearchParams(originalParams);
    expect(parsed.mode).toBe("keyword");
    expect(parsed.filters.query).toBe("summer sale");
    expect(parsed.filters.country).toBe("India");
    expect(parsed.filters.platform).toBe("Instagram");
    expect(parsed.filters.creativeType).toBe("video");
    expect(parsed.filters.status).toBe("active");
    expect(parsed.filters.firstSeenFrom).toBe("2024-01-01");
    expect(parsed.filters.lastSeenFrom).toBe("2024-12-31");

    const rebuilt = buildSearchParams(parsed);
    expect(rebuilt.get("mode")).toBe("keyword");
    expect(rebuilt.get("query")).toBe("summer sale");
    expect(rebuilt.get("country")).toBe("India");
    expect(rebuilt.get("platform")).toBe("Instagram");
    expect(rebuilt.get("creativeType")).toBe("video");
    expect(rebuilt.get("status")).toBe("active");
    expect(rebuilt.get("firstSeenFrom")).toBe("2024-01-01");
    expect(rebuilt.get("lastSeenFrom")).toBe("2024-12-31");
  });

  it("round-trips Refine panel date filters (firstSeenFrom / lastSeenFrom)", () => {
    // Mirrors form submission: date inputs → URL params → parse → rebuild.
    const refineParams = new URLSearchParams({
      mode: "advertiser",
      query: "nykaa.com",
      country: "all",
      platform: "all",
      creativeType: "all",
      status: "all",
      firstSeenFrom: "2026-01-15",
      lastSeenFrom: "2026-06-01",
    });

    const parsed = parseSearchParams(refineParams);
    expect(parsed.filters.firstSeenFrom).toBe("2026-01-15");
    expect(parsed.filters.lastSeenFrom).toBe("2026-06-01");

    const rebuilt = buildSearchParams(parsed);
    expect(rebuilt.get("firstSeenFrom")).toBe("2026-01-15");
    expect(rebuilt.get("lastSeenFrom")).toBe("2026-06-01");

    const reparsed = parseSearchParams(rebuilt);
    expect(reparsed.filters.firstSeenFrom).toBe("2026-01-15");
    expect(reparsed.filters.lastSeenFrom).toBe("2026-06-01");
  });

  it("round-trips with defaults applied (no explicit country/platform in original)", () => {
    const originalParams = new URLSearchParams({
      mode: "advertiser",
      query: "tech",
    });

    const parsed = parseSearchParams(originalParams);
    expect(parsed.filters.country).toBe("all");
    expect(parsed.filters.platform).toBe("all");

    const rebuilt = buildSearchParams(parsed);
    expect(rebuilt.get("country")).toBe("all");
    expect(rebuilt.get("platform")).toBe("all");
  });
});
describe("numeric page id handling", () => {
  it("accepts an all-digit page id and rejects anything else", () => {
    expect(normalizeNumericPageId("15087023444")).toBe("15087023444");
    expect(normalizeNumericPageId("  15087023444  ")).toBe("15087023444");
    expect(normalizeNumericPageId("nike")).toBeNull();
    expect(normalizeNumericPageId("1234")).toBeNull(); // too short to be a page id
    expect(normalizeNumericPageId("150; DROP")).toBeNull();
    expect(normalizeNumericPageId("")).toBeNull();
    expect(normalizeNumericPageId(null)).toBeNull();
  });

  it("preserves a valid page id in filters and omits the key otherwise", () => {
    const scoped = normalizeSearchFilters({ query: "nike", pageId: "15087023444" });
    expect(scoped.pageId).toBe("15087023444");

    const keyword = normalizeSearchFilters({ query: "nike", pageId: "not-a-page" });
    expect("pageId" in keyword).toBe(false);

    const plain = normalizeSearchFilters({ query: "nike" });
    expect("pageId" in plain).toBe(false);
  });

  it("keeps keyword query fingerprints byte-identical when no page id is set", () => {
    const before = fingerprintSavedQuery(normalizeSavedQuery("keyword", { query: "nike" }));
    const after = fingerprintSavedQuery(
      normalizeSavedQuery("keyword", { query: "nike", pageId: "bogus" }),
    );
    expect(after).toBe(before);

    // A real page id is a genuinely different query and must fingerprint apart.
    const scoped = fingerprintSavedQuery(
      normalizeSavedQuery("keyword", { query: "nike", pageId: "15087023444" }),
    );
    expect(scoped).not.toBe(before);
  });
});
