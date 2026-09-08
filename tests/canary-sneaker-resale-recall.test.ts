import { describe, expect, it } from "vitest";

import {
  KNOWN_IDENTITY_GAPS,
  KNOWN_NO_COVERAGE,
  evaluateSneakerResaleRecall,
  loadSneakerResaleDomains,
  probeSneakerResaleDomain,
  runCanary,
} from "../scripts/canary-sneaker-resale-recall.mjs";

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

describe("canary.sneaker-resale-recall", () => {
  it("loads the 25 sneaker-resale seed-list domains from the live list", () => {
    const domains = loadSneakerResaleDomains();
    expect(domains.length).toBe(25);
    expect(domains.map((d) => d.domain)).toContain("nike.com");
    expect(domains.map((d) => d.domain)).toContain("goat.com");
    expect(domains.map((d) => d.domain)).toContain("sneakerping.com");
  });

  it("probeSneakerResaleDomain parses verified/likely/unmatched rows from the rendered HTML", async () => {
    const fetchImpl = async () =>
      mockFetchResponse(
        htmlForRows([
          { tier: "verified", summary: "Nike shoes" },
          { tier: "likely", summary: "Nike Japan" },
          { tier: "unmatched", summary: "Reseller" },
        ]),
      );
    const probe = await probeSneakerResaleDomain({
      domain: "nike.com",
      baseUrl: "https://0509.io",
      fetchImpl,
    });
    expect(probe.status).toBe(200);
    expect(probe.rowCount).toBe(3);
    expect(probe.tierCounts).toEqual({ verified: 1, likely: 1, unmatched: 1 });
  });

  it("evaluateSneakerResaleRecall passes when every domain has a verified or likely row", () => {
    const results = loadSneakerResaleDomains().map((entry) => ({
      domain: entry.domain,
      brand: entry.brand,
      status: 200,
      rowCount: 2,
      tierCounts: { verified: 1, likely: 1, unmatched: 0 },
      headline: "1 verified ads linked to the brand",
      isWarming: false,
    }));
    const verdict = evaluateSneakerResaleRecall(results);
    expect(verdict.pass).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it("evaluateSneakerResaleRecall fails when an unknown domain returns 0 verified/likely rows", () => {
    // nike.com is not in any carve-out, so a 0-row dead-end there is a real
    // recall/alias regression and must fail the guard.
    const results = loadSneakerResaleDomains().map((entry) => ({
      domain: entry.domain,
      brand: entry.brand,
      status: 200,
      rowCount: entry.domain === "nike.com" ? 0 : 2,
      tierCounts:
        entry.domain === "nike.com"
          ? { verified: 0, likely: 0, unmatched: 0 }
          : { verified: 1, likely: 1, unmatched: 0 },
      headline: entry.domain === "nike.com" ? "No verified ads" : "1 verified ad",
      isWarming: false,
    }));
    const verdict = evaluateSneakerResaleRecall(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((f) => f.domain)).toEqual(["nike.com"]);
  });

  it("evaluateSneakerResaleRecall fails a blanket-unmatched unknown domain (rows present, all Unmatched)", () => {
    // stockx.com is not in any carve-out, so a blanket-unmatched page there is
    // a real tier-label regression and must fail the guard.
    const results = loadSneakerResaleDomains().map((entry) => ({
      domain: entry.domain,
      brand: entry.brand,
      status: 200,
      rowCount: 2,
      tierCounts:
        entry.domain === "stockx.com"
          ? { verified: 0, likely: 0, unmatched: 2 }
          : { verified: 1, likely: 1, unmatched: 0 },
      headline: entry.domain === "stockx.com" ? "2 unverified keyword matches" : "1 verified ad",
      isWarming: false,
    }));
    const verdict = evaluateSneakerResaleRecall(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((f) => f.domain)).toEqual(["stockx.com"]);
  });

  it("evaluateSneakerResaleRecall reports (does not fail) a genuine no-coverage brand", () => {
    // sneakerping.com is classified in KNOWN_NO_COVERAGE: the live surface
    // reports no verified Meta coverage for it, so the honest treatment is
    // no-coverage (no page), not a failed canary.
    const results = loadSneakerResaleDomains().map((entry) => ({
      domain: entry.domain,
      brand: entry.brand,
      status: 200,
      rowCount: entry.domain === "sneakerping.com" ? 0 : 2,
      tierCounts:
        entry.domain === "sneakerping.com"
          ? { verified: 0, likely: 0, unmatched: 0 }
          : { verified: 1, likely: 1, unmatched: 0 },
      headline: entry.domain === "sneakerping.com" ? "No verified ads" : "1 verified ad",
      isWarming: false,
    }));
    const verdict = evaluateSneakerResaleRecall(results);
    expect(verdict.pass).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.noCoverage.map((p) => p.domain)).toEqual(["sneakerping.com"]);
  });

  it("evaluateSneakerResaleRecall surfaces (does not fail) known identity-gap brands", () => {
    // goat.com / on.com / reebok.com are classified as identity-resolution
    // gaps (major advertisers whose ads the pipeline does not yet connect to
    // their domain). The canary reports them with their tracking issue rather
    // than hard-failing the guard, mirroring search-tier-canary's alias-gap
    // handling.
    const results = loadSneakerResaleDomains().map((entry) => ({
      domain: entry.domain,
      brand: entry.brand,
      status: 200,
      rowCount: KNOWN_IDENTITY_GAPS.has(entry.domain) ? 0 : 2,
      tierCounts: KNOWN_IDENTITY_GAPS.has(entry.domain)
        ? { verified: 0, likely: 0, unmatched: 0 }
        : { verified: 1, likely: 1, unmatched: 0 },
      headline: KNOWN_IDENTITY_GAPS.has(entry.domain) ? "No verified ads" : "1 verified ad",
      isWarming: false,
    }));
    const verdict = evaluateSneakerResaleRecall(results);
    expect(verdict.pass).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.identityGaps.map((g) => g.probe.domain).sort()).toEqual([
      "goat.com",
      "on.com",
      "reebok.com",
    ]);
    for (const { probe, issue } of verdict.identityGaps) {
      expect(KNOWN_IDENTITY_GAPS.get(probe.domain)).toBe(issue);
    }
  });

  it("runCanary fails when an unknown domain dead-ends", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const website = url.searchParams.get("website") ?? "";
      const body =
        website === "nike.com"
          ? htmlForRows([])
          : htmlForRows([{ tier: "verified", summary: `${website} ad` }]);
      return mockFetchResponse(body);
    };
    const { verdict } = await runCanary({ baseUrl: "https://0509.io", fetchImpl });
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((f) => f.domain)).toEqual(["nike.com"]);
  });

  it("runCanary passes when every domain returns a verified row", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const website = url.searchParams.get("website") ?? "";
      return mockFetchResponse(
        htmlForRows([{ tier: "verified", summary: `${website} ad` }]),
      );
    };
    const { verdict } = await runCanary({ baseUrl: "https://0509.io", fetchImpl });
    expect(verdict.pass).toBe(true);
  });
});
