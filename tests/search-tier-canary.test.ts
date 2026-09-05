import { describe, expect, it } from "vitest";

import {
  SIX_DOMAINS,
  evaluateSixDomainTiers,
  probeKeywordTier,
  runCanary,
} from "../scripts/search-tier-canary.mjs";

function htmlForRows(rows: Array<{ tier: "verified" | "likely" | "unmatched"; summary: string }>): string {
  const rowMarkup = rows
    .map((row) => {
      const say = row.tier === "verified"
        ? row.summary
        : `${row.tier.charAt(0).toUpperCase()}${row.tier.slice(1)} — ${row.summary}`;
      return `<div class="f9-wk-row has-trail"><span class="f9-wk-say">${say}</span></div>`;
    })
    .join("");
  const verifiedCount = rows.filter((row) => row.tier === "verified").length;
  const headline = verifiedCount > 0
    ? `${verifiedCount} verified ads linked to the brand`
    : "No verified ads for the brand — 0 likely matches, 0 unmatched candidates";
  return `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit"><h2 class="f9-wk-sec-title">${headline}</h2>${rowMarkup}</section></body></html>`;
}

function mockFetchResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

describe("search.tier.canary", () => {
  it("exposes the six-domain set", () => {
    expect(SIX_DOMAINS).toEqual([
      "allbirds",
      "notion",
      "oura",
      "gymshark",
      "hubspot",
      "mamaearth",
    ]);
  });

  it("probeKeywordTier parses verified/likely/unmatched rows from the rendered HTML", async () => {
    const fetchImpl = async () =>
      mockFetchResponse(
        htmlForRows([
          { tier: "verified", summary: "Allbirds shoes" },
          { tier: "likely", summary: "Allbirds Japan" },
          { tier: "unmatched", summary: "Reseller" },
        ]),
      );
    const probe = await probeKeywordTier({
      keyword: "allbirds",
      baseUrl: "https://0509.io",
      fetchImpl,
    });
    expect(probe.status).toBe(200);
    expect(probe.rowCount).toBe(3);
    expect(probe.tierCounts).toEqual({ verified: 1, likely: 1, unmatched: 1 });
  });

  it("evaluateSixDomainTiers passes when every domain has a verified or likely row", () => {
    const results = SIX_DOMAINS.map((keyword) => ({
      keyword,
      status: 200,
      rowCount: 2,
      tierCounts: { verified: 1, likely: 1, unmatched: 0 },
      headline: "1 verified ads linked to the brand",
      isWarming: false,
    }));
    const verdict = evaluateSixDomainTiers(results);
    expect(verdict.pass).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it("evaluateSixDomainTiers fails when a domain returns 0 verified/likely rows", () => {
    const results = SIX_DOMAINS.map((keyword) => ({
      keyword,
      status: 200,
      rowCount: keyword === "allbirds" ? 0 : 2,
      tierCounts:
        keyword === "allbirds"
          ? { verified: 0, likely: 0, unmatched: 0 }
          : { verified: 1, likely: 1, unmatched: 0 },
      headline: keyword === "allbirds" ? "No verified ads" : "1 verified ads",
      isWarming: false,
    }));
    const verdict = evaluateSixDomainTiers(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((f) => f.keyword)).toEqual(["allbirds"]);
  });

  it("runCanary fails when any domain dead-ends", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const q = url.searchParams.get("q") ?? "";
      const body =
        q === "allbirds"
          ? htmlForRows([])
          : htmlForRows([{ tier: "verified", summary: `${q} ad` }]);
      return mockFetchResponse(body);
    };
    const { verdict } = await runCanary({ baseUrl: "https://0509.io", fetchImpl });
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((f) => f.keyword)).toEqual(["allbirds"]);
  });

  it("runCanary passes when every domain returns a verified row", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const q = url.searchParams.get("q") ?? "";
      return mockFetchResponse(
        htmlForRows([{ tier: "verified", summary: `${q} ad` }]),
      );
    };
    const { verdict } = await runCanary({ baseUrl: "https://0509.io", fetchImpl });
    expect(verdict.pass).toBe(true);
  });

  it("probeKeywordTier retries a 429 and succeeds on the next attempt", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "1" },
        });
      }
      return mockFetchResponse(
        htmlForRows([{ tier: "likely", summary: "Oura ring" }]),
      );
    };
    const probe = await probeKeywordTier({
      keyword: "oura",
      baseUrl: "https://0509.io",
      fetchImpl,
      sleepImpl: async () => {},
    });
    expect(calls).toBe(2);
    expect(probe.status).toBe(200);
    expect(probe.tierCounts.likely).toBe(1);
    expect(probe.rateLimited).toBeUndefined();
  });

  it("probeKeywordTier reports a persistent 429 as rate-limited, not a dead-end", async () => {
    const fetchImpl = async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "1" },
      });
    const probe = await probeKeywordTier({
      keyword: "oura",
      baseUrl: "https://0509.io",
      fetchImpl,
      sleepImpl: async () => {},
      max429Retries: 2,
    });
    expect(probe.status).toBe(429);
    expect(probe.rateLimited).toBe(true);
    expect(probe.tierCounts).toEqual({ verified: 0, likely: 0, unmatched: 0 });
  });
});
