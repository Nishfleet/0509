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
  it("loads the 25 sneaker-resale seed-list domains from the live list (issue #1279 added saucony.co.uk; #2045 removed zappos.com while its /ads page 301s to /search)", () => {
    const domains = loadSneakerResaleDomains();
    expect(domains.length).toBe(25);
    expect(domains.map((d) => d.domain)).toContain("nike.com");
    expect(domains.map((d) => d.domain)).toContain("goat.com");
    expect(domains.map((d) => d.domain)).toContain("sneakerping.com");
    expect(domains.map((d) => d.domain)).toContain("saucony.co.uk");
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

  it("evaluateSneakerResaleRecall surfaces (does not fail) a probe still on the warming page after retries", () => {
    // A persistent warming page is the site's designed cold-cache state, not
    // evidence of a recall regression (the reference verifier counts a
    // dead-end only as rowCount == 0 && !isWarming). It is inconclusive and
    // surfaced, not failed — otherwise the guard flaps on rotating brands
    // overnight (2026-09-09 03:00/03:03 IST). A settled non-warming 0-row
    // page still fails loud.
    const results = loadSneakerResaleDomains().map((entry) =>
      entry.domain === "dsw.com"
        ? {
            domain: entry.domain,
            brand: entry.brand,
            status: 200,
            rowCount: 0,
            tierCounts: { verified: 0, likely: 0, unmatched: 0 },
            headline: "Warming up the search index",
            isWarming: true,
          }
        : {
            domain: entry.domain,
            brand: entry.brand,
            status: 200,
            rowCount: 2,
            tierCounts: { verified: 2, likely: 0, unmatched: 0 },
            headline: "2 verified ads linked to the brand",
            isWarming: false,
          },
    );
    const verdict = evaluateSneakerResaleRecall(results);
    expect(verdict.pass).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.warming.map((p) => p.domain)).toEqual(["dsw.com"]);
  });

  it("evaluateSneakerResaleRecall still fails a settled non-warming 0-row dead-end alongside a warming domain", () => {
    const results = loadSneakerResaleDomains().map((entry) =>
      entry.domain === "footlocker.com"
        ? {
            domain: entry.domain,
            brand: entry.brand,
            status: 200,
            rowCount: 0,
            tierCounts: { verified: 0, likely: 0, unmatched: 0 },
            headline: "No verified ads for the brand",
            isWarming: false,
          }
        : entry.domain === "puma.com"
          ? {
              domain: entry.domain,
              brand: entry.brand,
              status: 200,
              rowCount: 0,
              tierCounts: { verified: 0, likely: 0, unmatched: 0 },
              headline: "Warming up the search index",
              isWarming: true,
            }
          : {
              domain: entry.domain,
              brand: entry.brand,
              status: 200,
              rowCount: 2,
              tierCounts: { verified: 2, likely: 0, unmatched: 0 },
              headline: "2 verified ads linked to the brand",
              isWarming: false,
            },
    );
    const verdict = evaluateSneakerResaleRecall(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((p) => p.domain)).toEqual(["footlocker.com"]);
    expect(verdict.warming.map((p) => p.domain)).toEqual(["puma.com"]);
  });

  it("probeSneakerResaleDomain retries a warming page up to WARMING_RETRY_LIMIT before returning it", async () => {
    const { WARMING_RETRY_LIMIT, WARMING_RETRY_DELAY_MS } = await import(
      "../scripts/canary-sneaker-resale-recall.mjs"
    );
    const warmingHtml =
      '<html><body><section class="f9-results-panel"><h2 class="f9-wk-sec-title">Checking this competitor — results on the way</h2></section></body></html>';
    let calls = 0;
    const sleeps: number[] = [];
    const probe = await probeSneakerResaleDomain({
      domain: "zappos.com",
      baseUrl: "https://0509.io",
      fetchImpl: (() => {
        calls += 1;
        return Promise.resolve(mockFetchResponse(warmingHtml));
      }) as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(calls).toBe(WARMING_RETRY_LIMIT + 1);
    expect(sleeps).toEqual(Array(WARMING_RETRY_LIMIT).fill(WARMING_RETRY_DELAY_MS));
    expect(probe.isWarming).toBe(true);
    expect(probe.rowCount).toBe(0);
  });

  it("evaluateSneakerResaleRecall fails a persistent 429 even on a carve-out domain", () => {
    // A run that cannot confirm a domain (persistent 429 / request error) is
    // never a pass, regardless of which carve-out the domain is in. sneakerping
    // is in KNOWN_NO_COVERAGE, but a rate-limited probe must fail: "cannot
    // confirm" is not "no coverage". All other domains return verified rows.
    const results = loadSneakerResaleDomains().map((entry) =>
      entry.domain === "sneakerping.com"
        ? {
            domain: entry.domain,
            brand: entry.brand,
            status: 429,
            rowCount: 0,
            rateLimited: true,
            tierCounts: { verified: 0, likely: 0, unmatched: 0 },
            headline: null,
            isWarming: false,
          }
        : {
            domain: entry.domain,
            brand: entry.brand,
            status: 200,
            rowCount: 2,
            tierCounts: { verified: 1, likely: 1, unmatched: 0 },
            headline: "1 verified ad",
            isWarming: false,
          },
    );
    const verdict = evaluateSneakerResaleRecall(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((f) => f.domain)).toEqual(["sneakerping.com"]);
    expect(verdict.noCoverage).toEqual([]);
  });

  it("evaluateSneakerResaleRecall fails a request error even on an identity-gap domain", () => {
    // goat.com is a known identity gap, but a network error that returns no
    // settled page must still fail the guard — the gap's current state cannot
    // be confirmed. All other domains return verified rows.
    const results = loadSneakerResaleDomains().map((entry) =>
      entry.domain === "goat.com"
        ? {
            domain: entry.domain,
            brand: entry.brand,
            status: null,
            rowCount: 0,
            requestError: "ECONNRESET",
            tierCounts: { verified: 0, likely: 0, unmatched: 0 },
            headline: null,
            isWarming: false,
          }
        : {
            domain: entry.domain,
            brand: entry.brand,
            status: 200,
            rowCount: 2,
            tierCounts: { verified: 1, likely: 1, unmatched: 0 },
            headline: "1 verified ad",
            isWarming: false,
          },
    );
    const verdict = evaluateSneakerResaleRecall(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((f) => f.domain)).toEqual(["goat.com"]);
    expect(verdict.identityGaps).toEqual([]);
  });
});
