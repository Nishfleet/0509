import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEMO_BRAND_PAGE_DOMAINS as SOURCE_DEMO_BRANDS } from "~/lib/demo-brand-pages";

import {
  BRAND_PAGE_RATE_LIMIT_MAX,
  BRAND_PAGE_RATE_LIMIT_WINDOW_MS,
  DEFAULT_BASE_URL,
  DEFAULT_USER_AGENT,
  DEMO_BRAND_PAGE_DOMAINS,
  WATCHED_MIN_DAYS,
  WATCHED_MIN_STATES,
  buildCanonicalTimelineUrl,
  countStatesWithWorkingScreenshots,
  createRateLimiter,
  evaluateTermination,
  fetchSitemapDomains,
  formatProbeLine,
  formatSummary,
  isQualifyingWatchedCompetitor,
  parseOptionalCount,
  parseTimelineHtml,
  probeDomain,
  runLiveVerification,
} from "../scripts/bet3-live-verification.mjs";

const FROZEN_NOW_MS = Date.parse("2026-08-27T00:00:00.000Z");
const PASSING_D1 = { snapshotCount: 12, priorSnapshotCount: 5 };

const TEST_BASE_URL = "https://example.test";

function entryMarkup(input: {
  id: string;
  capturedAt: string;
  dateLabel: string;
  headline: string;
  screenshotHref?: string;
  pageTextHref?: string;
  evidenceNote?: string;
}): string {
  const receipts: string[] = [];
  if (input.screenshotHref) {
    receipts.push(`<a href="${input.screenshotHref}" rel="noreferrer">Screenshot · ${input.dateLabel}</a>`);
  }
  if (input.pageTextHref) {
    receipts.push(`<a href="${input.pageTextHref}" rel="noreferrer">Page text · ${input.dateLabel}</a>`);
  }
  const receiptsBlock =
    receipts.length > 0
      ? `<p class="f9-timeline-receipts">${receipts.join("")}</p>`
      : input.evidenceNote
        ? `<p class="f9-timeline-receipts f9-timeline-receipts-note">${input.evidenceNote}</p>`
        : "";

  return `<li class="f9-timeline-entry" id="state-${input.id}">
    <time class="f9-timeline-date" dateTime="${input.capturedAt}">${input.dateLabel}</time>
    <div class="f9-timeline-body">
      <p class="f9-timeline-headline">${input.headline}</p>
      ${receiptsBlock}
    </div>
  </li>`;
}

function timelineHtml(input: {
  domain: string;
  entries: Array<{
    id: string;
    capturedAt: string;
    dateLabel: string;
    headline: string;
    screenshotHref?: string;
    pageTextHref?: string;
    evidenceNote?: string;
  }>;
  includeShare?: boolean;
}): string {
  const shareUrl = buildCanonicalTimelineUrl(TEST_BASE_URL, input.domain);
  const shareInput = input.includeShare !== false
    ? `<p class="f9-timeline-share"><label for="offer-timeline-share-url">Share this timeline</label><input id="offer-timeline-share-url" type="text" readOnly value="${shareUrl}" /></p>`
    : "";
  const entries = input.entries.map(entryMarkup).join("");
  return `<!doctype html><html><body><main class="f9-timeline-page">
    ${shareInput}
    <section class="f9-timeline-section">
      <h2 class="f9-timeline-section-title">Dated offer states</h2>
      <ol class="f9-timeline-ledger">${entries}</ol>
    </section>
  </main></body></html>`;
}

function mockResponse(
  body: string | null,
  options: {
    status?: number;
    headers?: Record<string, string>;
  } = {},
): Response {
  return new Response(body, {
    status: options.status ?? 200,
    headers: options.headers ?? { "content-type": "text/html" },
  });
}

describe("parseTimelineHtml", () => {
  it("parses a 3-entry ledger with receipts, an evidence note, and a share URL", () => {
    const html = timelineHtml({
      domain: "competitor.test",
      entries: [
        {
          id: "a",
          capturedAt: "2024-01-10",
          dateLabel: "10 Jan 2024",
          headline: "First offer",
          screenshotHref: "/artifacts/proof/landing-pages/2024-01-10/uuid-a.jpeg",
          pageTextHref: "/artifacts/page-text/landing-pages/2024-01-10/uuid-a.html",
        },
        {
          id: "b",
          capturedAt: "2024-01-15",
          dateLabel: "15 Jan 2024",
          headline: "Second offer",
          evidenceNote: "Captured on 15 Jan 2024, no screenshot",
        },
        {
          id: "c",
          capturedAt: "2024-01-20",
          dateLabel: "20 Jan 2024",
          headline: "Third offer",
          screenshotHref: "/artifacts/proof/landing-pages/2024-01-20/uuid-c.webp",
        },
      ],
    });
    const parsed = parseTimelineHtml(html);

    expect(parsed.entryCount).toBe(3);
    expect(parsed.shareUrl).toBe(buildCanonicalTimelineUrl(TEST_BASE_URL, "competitor.test"));

    expect(parsed.entries[0]).toMatchObject({
      capturedAt: "2024-01-10",
      dateLabel: "10 Jan 2024",
      headline: "First offer",
      receiptLinks: [
        "/artifacts/proof/landing-pages/2024-01-10/uuid-a.jpeg",
        "/artifacts/page-text/landing-pages/2024-01-10/uuid-a.html",
      ],
      evidenceNote: null,
    });

    expect(parsed.entries[1]).toMatchObject({
      capturedAt: "2024-01-15",
      headline: "Second offer",
      receiptLinks: [],
      evidenceNote: "Captured on 15 Jan 2024, no screenshot",
    });

    expect(parsed.entries[2]).toMatchObject({
      capturedAt: "2024-01-20",
      receiptLinks: ["/artifacts/proof/landing-pages/2024-01-20/uuid-c.webp"],
    });
  });

  it("returns an empty ledger and the share URL when no entries exist", () => {
    const html = timelineHtml({ domain: "empty.test", entries: [] });
    const parsed = parseTimelineHtml(html);
    expect(parsed.entryCount).toBe(0);
    expect(parsed.entries).toEqual([]);
    expect(parsed.shareUrl).toBe(buildCanonicalTimelineUrl(TEST_BASE_URL, "empty.test"));
  });

  it("returns no entries and no share URL for a 404 body", () => {
    const html = `<!doctype html><html><body><main><h1>Not Found</h1></main></body></html>`;
    const parsed = parseTimelineHtml(html);
    expect(parsed.entryCount).toBe(0);
    expect(parsed.shareUrl).toBeNull();
  });

  it("returns entries but a null share URL when the share input is missing", () => {
    const html = timelineHtml({
      domain: "noshare.test",
      entries: [
        { id: "x", capturedAt: "2024-02-01", dateLabel: "1 Feb 2024", headline: "Only offer" },
      ],
      includeShare: false,
    });
    const parsed = parseTimelineHtml(html);
    expect(parsed.entryCount).toBe(1);
    expect(parsed.shareUrl).toBeNull();
  });
});

describe("evaluateTermination", () => {
  function makeResult(input: {
    domain: string;
    entryCount: number;
    capturedAts?: string[];
    receiptStatuses?: Array<{ href: string; status: number; contentType?: string }>;
    shareUrl?: string;
    status?: number;
    outcome?: string;
  }) {
    const canonical = buildCanonicalTimelineUrl(TEST_BASE_URL, input.domain);
    const receiptChecks = (input.receiptStatuses ?? []).map((rs) => {
      const mediaType = (rs.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      const ok =
        rs.status === 200 &&
        (rs.href.startsWith("/artifacts/proof/")
          ? mediaType.startsWith("image/")
          : mediaType === "text/plain");
      return {
        url: `${TEST_BASE_URL}${rs.href}`,
        status: rs.status,
        contentType: rs.contentType ?? null,
        ok,
        elapsedMs: 10,
        error: null,
      };
    });
    const screenshotHrefs = (input.receiptStatuses ?? [])
      .filter((rs) => rs.href.startsWith("/artifacts/proof/"))
      .map((rs) => rs.href);
    const entries = Array.from({ length: input.entryCount }, (_, index) => ({
      capturedAt: input.capturedAts?.[index] ?? "2026-08-26T00:00:00.000Z",
      dateLabel: `day-${index}`,
      headline: `offer ${index}`,
      receiptLinks: screenshotHrefs[index] ? [screenshotHrefs[index]] : [],
      evidenceNote: screenshotHrefs[index] ? null : "Captured on 26 Aug 2026, no screenshot",
    }));
    return {
      domain: input.domain,
      url: canonical,
      finalUrl: canonical,
      outcome: (input.outcome as never) ?? (input.entryCount > 0 ? "verified" : "dead_end"),
      status: input.status ?? 200,
      elapsedMs: 100,
      entryCount: input.entryCount,
      entries,
      shareUrl: input.shareUrl ?? canonical,
      sharePresent: input.shareUrl !== undefined ? input.shareUrl !== null : true,
      receiptChecks,
      workingReceiptCount: receiptChecks.filter((c) => c.ok).length,
      brokenReceiptCount: receiptChecks.filter((c) => !c.ok).length,
      requestError: null,
    };
  }

  const qualifyingReceipts = [
    { href: "/artifacts/proof/landing-pages/2026-08-01/uuid.jpeg", status: 200, contentType: "image/jpeg" },
    { href: "/artifacts/page-text/landing-pages/2026-08-01/uuid.html", status: 200, contentType: "text/plain; charset=utf-8" },
    { href: "/artifacts/proof/landing-pages/2026-08-10/uuid.jpeg", status: 200, contentType: "image/jpeg" },
    { href: "/artifacts/page-text/landing-pages/2026-08-10/uuid.html", status: 200, contentType: "text/plain" },
    { href: "/artifacts/proof/landing-pages/2026-08-20/uuid.webp", status: 200, contentType: "image/webp" },
    { href: "/artifacts/page-text/landing-pages/2026-08-20/uuid.html", status: 200, contentType: "text/plain" },
  ];

  const qualifyingCapturedAts = [
    "2026-08-01T00:00:00.000Z",
    "2026-08-10T00:00:00.000Z",
    "2026-08-20T00:00:00.000Z",
  ];

  function passingOptions() {
    return { nowMs: FROZEN_NOW_MS, ...PASSING_D1 };
  }

  it("passes when all criteria are met", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 })),
      makeResult({
        domain: "gymshark.com",
        entryCount: 3,
        capturedAts: qualifyingCapturedAts,
        receiptStatuses: qualifyingReceipts,
      }),
    ];
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    expect(verdict.pass).toBe(true);
    for (const check of verdict.checks) {
      expect(check.ok).toBe(true);
      expect(check.skip ?? false).toBe(false);
    }
  });

  it("fails demo_backfill_present when a demo brand has no offer states", () => {
    const results = DEMO_BRAND_PAGE_DOMAINS.map((d, i) =>
      makeResult({ domain: d, entryCount: i === 0 ? 0 : 1 }),
    );
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const check = verdict.checks.find((c) => c.name === "demo_backfill_present");
    expect(check?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
    expect(check?.detail).toContain(DEMO_BRAND_PAGE_DOMAINS[0]);
  });

  it("fails watched_competitor_three_screenshot_states when no domain has >=3 states", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 })),
      makeResult({ domain: "gymshark.com", entryCount: 2 }),
    ];
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const check = verdict.checks.find(
      (c) => c.name === "watched_competitor_three_screenshot_states",
    );
    expect(check?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("fails watched_competitor when three states span less than 14 days", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 })),
      makeResult({
        domain: "gymshark.com",
        entryCount: 3,
        capturedAts: [
          "2026-08-20T00:00:00.000Z",
          "2026-08-23T00:00:00.000Z",
          "2026-08-26T00:00:00.000Z",
        ],
        receiptStatuses: qualifyingReceipts,
      }),
    ];
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const check = verdict.checks.find(
      (c) => c.name === "watched_competitor_three_screenshot_states",
    );
    expect(check?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("fails watched_competitor when three states have no screenshot links", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 })),
      makeResult({
        domain: "gymshark.com",
        entryCount: 3,
        capturedAts: qualifyingCapturedAts,
      }),
    ];
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const check = verdict.checks.find(
      (c) => c.name === "watched_competitor_three_screenshot_states",
    );
    expect(check?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("fails share_link_present_and_logged_out when no share URL is rendered", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 })),
      makeResult({
        domain: "gymshark.com",
        entryCount: 3,
        capturedAts: qualifyingCapturedAts,
        receiptStatuses: qualifyingReceipts,
      }),
    ].map((result) => ({ ...result, shareUrl: null, sharePresent: false }));
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const check = verdict.checks.find((c) => c.name === "share_link_present_and_logged_out");
    expect(check?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("fails snapshot_row_count_positive when the count is 0", () => {
    const results = DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 }));
    const verdict = evaluateTermination(results, TEST_BASE_URL, {
      nowMs: FROZEN_NOW_MS,
      snapshotCount: 0,
      priorSnapshotCount: 0,
    });
    const check = verdict.checks.find((c) => c.name === "snapshot_row_count_positive");
    expect(check?.ok).toBe(false);
    expect(check?.skip ?? false).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("fails timeline_route_reachable when a demo URL is 404", () => {
    const results = DEMO_BRAND_PAGE_DOMAINS.map((d, i) =>
      makeResult({
        domain: d,
        entryCount: i === 0 ? 0 : 1,
        status: i === 0 ? 404 : 200,
        outcome: i === 0 ? "not_found" : "verified",
      }),
    );
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const check = verdict.checks.find((c) => c.name === "timeline_route_reachable");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain(DEMO_BRAND_PAGE_DOMAINS[0]);
    expect(verdict.pass).toBe(false);
  });

  it("does not pass when D1 row-count checks are skipped", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 })),
      makeResult({
        domain: "gymshark.com",
        entryCount: 3,
        capturedAts: qualifyingCapturedAts,
        receiptStatuses: qualifyingReceipts,
      }),
    ];
    const verdict = evaluateTermination(results, TEST_BASE_URL, {
      nowMs: FROZEN_NOW_MS,
      snapshotCount: null,
      priorSnapshotCount: null,
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.filter((c) => c.skip).map((c) => c.name)).toEqual([
      "snapshot_row_count_positive",
      "snapshot_row_count_growing_daily",
    ]);
  });

  it("fails no_receipt_404s and watched_competitor when a screenshot 404s", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 })),
      makeResult({
        domain: "gymshark.com",
        entryCount: 3,
        capturedAts: qualifyingCapturedAts,
        receiptStatuses: [
          { href: "/artifacts/proof/landing-pages/2026-08-01/uuid.jpeg", status: 404, contentType: "image/jpeg" },
          { href: "/artifacts/proof/landing-pages/2026-08-10/uuid.jpeg", status: 200, contentType: "image/jpeg" },
          { href: "/artifacts/proof/landing-pages/2026-08-20/uuid.jpeg", status: 200, contentType: "image/jpeg" },
        ],
      }),
    ];
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const noReceipt404 = verdict.checks.find((c) => c.name === "no_receipt_404s");
    const watched = verdict.checks.find(
      (c) => c.name === "watched_competitor_three_screenshot_states",
    );
    expect(noReceipt404?.ok).toBe(false);
    expect(watched?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("passes timeline_route_reachable when a domain returns 410 (retire path, #1309)", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 })),
      makeResult({
        domain: "unseeded.example",
        entryCount: 0,
        status: 410,
        outcome: "retired",
      }),
    ];
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const reach = verdict.checks.find((c) => c.name === "timeline_route_reachable");
    expect(reach?.ok).toBe(true);
  });

  it("fails no_soft_404_shells when any domain 200s with zero entries", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d, i) =>
        makeResult({ domain: d, entryCount: i === 1 ? 0 : 1, status: i === 1 ? 200 : 200 }),
      ),
      makeResult({
        domain: "gymshark.com",
        entryCount: 3,
        capturedAts: qualifyingCapturedAts,
        receiptStatuses: qualifyingReceipts,
      }),
    ];
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const softCheck = verdict.checks.find((c) => c.name === "no_soft_404_shells");
    expect(softCheck?.ok).toBe(false);
    expect(softCheck?.detail).toContain(DEMO_BRAND_PAGE_DOMAINS[1]);
    expect(verdict.pass).toBe(false);
  });

  it("passes no_soft_404_shells when empty domains return 410 instead of 200", () => {
    const results = [
      ...DEMO_BRAND_PAGE_DOMAINS.map((d) => makeResult({ domain: d, entryCount: 1 })),
      makeResult({
        domain: "unseeded.example",
        entryCount: 0,
        status: 410,
        outcome: "retired",
      }),
      makeResult({
        domain: "gymshark.com",
        entryCount: 3,
        capturedAts: qualifyingCapturedAts,
        receiptStatuses: qualifyingReceipts,
      }),
    ];
    const verdict = evaluateTermination(results, TEST_BASE_URL, passingOptions());
    const softCheck = verdict.checks.find((c) => c.name === "no_soft_404_shells");
    expect(softCheck?.ok).toBe(true);
  });
});

describe("probeDomain 410 retire outcome (#1309)", () => {
  it("returns outcome=retired for a 410 response", async () => {
    const fetchMock = (async () =>
      mockResponse("Gone", { status: 410 })) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "unseeded.example",
      baseUrl: TEST_BASE_URL,
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
    });
    expect(result.outcome).toBe("retired");
    expect(result.status).toBe(410);
    expect(result.entryCount).toBe(0);
  });
});

describe("fetchSitemapDomains (#1309)", () => {
  it("extracts /ads/:domain entries from sitemap.xml, de-duplicated", async () => {
    const xml = [
      `<?xml version="1.0"?>`,
      `<urlset>`,
      `<url><loc>https://0509.io/ads/nike.com</loc></url>`,
      `<url><loc>https://0509.io/ads/gymshark.com</loc></url>`,
      `<url><loc>https://0509.io/ads/gymshark.com</loc></url>`,
      `<url><loc>https://0509.io/ads/allbirds.com</loc></url>`,
      `<url><loc>https://0509.io/</loc></url>`,
      `<url><loc>https://0509.io/ads/ridgewallet.com</loc></url>`,
      `</urlset>`,
    ].join("\n");
    const fetchMock = (async () =>
      mockResponse(xml, {
        headers: { "content-type": "application/xml" },
      })) as unknown as typeof fetch;
    const domains = await fetchSitemapDomains({
      baseUrl: TEST_BASE_URL,
      fetchImpl: fetchMock,
    });
    expect(domains).toEqual([
      "nike.com",
      "gymshark.com",
      "allbirds.com",
      "ridgewallet.com",
    ]);
  });

  it("throws when the sitemap fetch fails", async () => {
    const fetchMock = (async () =>
      mockResponse("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchSitemapDomains({ baseUrl: TEST_BASE_URL, fetchImpl: fetchMock }),
    ).rejects.toThrow(/sitemap fetch failed/);
  });
});

describe("watched-competitor helpers", () => {
  it("counts only states whose screenshot receipts returned 200 images", () => {
    const result = {
      domain: "gymshark.com",
      url: buildCanonicalTimelineUrl(TEST_BASE_URL, "gymshark.com"),
      finalUrl: buildCanonicalTimelineUrl(TEST_BASE_URL, "gymshark.com"),
      outcome: "verified" as const,
      status: 200,
      elapsedMs: 10,
      entryCount: 2,
      entries: [
        {
          capturedAt: "2026-08-01T00:00:00.000Z",
          dateLabel: "1 Aug",
          headline: "one",
          receiptLinks: ["/artifacts/proof/a.jpeg"],
          evidenceNote: null,
        },
        {
          capturedAt: "2026-08-20T00:00:00.000Z",
          dateLabel: "20 Aug",
          headline: "two",
          receiptLinks: ["/artifacts/page-text/b.html"],
          evidenceNote: null,
        },
      ],
      shareUrl: buildCanonicalTimelineUrl(TEST_BASE_URL, "gymshark.com"),
      sharePresent: true,
      receiptChecks: [
        {
          url: `${TEST_BASE_URL}/artifacts/proof/a.jpeg`,
          status: 200,
          contentType: "image/jpeg",
          ok: true,
          elapsedMs: 1,
          error: null,
        },
        {
          url: `${TEST_BASE_URL}/artifacts/page-text/b.html`,
          status: 200,
          contentType: "text/plain",
          ok: true,
          elapsedMs: 1,
          error: null,
        },
      ],
      workingReceiptCount: 2,
      brokenReceiptCount: 0,
      requestError: null,
    };
    expect(countStatesWithWorkingScreenshots(result, TEST_BASE_URL)).toBe(1);
    expect(
      isQualifyingWatchedCompetitor(result, { baseUrl: TEST_BASE_URL, nowMs: FROZEN_NOW_MS }),
    ).toBe(false);
  });
});

describe("runLiveVerification", () => {
  it("probes all domains, verifies receipts, and returns a summary", async () => {
    const calls: string[] = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);

      if (url.includes("/timeline/")) {
        const domain = new URL(url).pathname.replace("/timeline/", "");
        if (domain === "competitor.test") {
          return mockResponse(
            timelineHtml({
              domain,
              entries: [
                { id: "1", capturedAt: "2024-01-10", dateLabel: "10 Jan 2024", headline: "First", screenshotHref: "/artifacts/proof/landing-pages/2024-01-10/uuid-1.jpeg", pageTextHref: "/artifacts/page-text/landing-pages/2024-01-10/uuid-1.html" },
                { id: "2", capturedAt: "2024-01-15", dateLabel: "15 Jan 2024", headline: "Second", screenshotHref: "/artifacts/proof/landing-pages/2024-01-15/uuid-2.jpeg", pageTextHref: "/artifacts/page-text/landing-pages/2024-01-15/uuid-2.html" },
                { id: "3", capturedAt: "2024-01-20", dateLabel: "20 Jan 2024", headline: "Third", screenshotHref: "/artifacts/proof/landing-pages/2024-01-20/uuid-3.webp", pageTextHref: "/artifacts/page-text/landing-pages/2024-01-20/uuid-3.html" },
              ],
            }),
          );
        }
        return mockResponse(
          timelineHtml({
            domain,
            entries: [{ id: "x", capturedAt: "2024-02-01", dateLabel: "1 Feb 2024", headline: "Solo offer", screenshotHref: "/artifacts/proof/landing-pages/2024-02-01/uuid-x.jpeg", pageTextHref: "/artifacts/page-text/landing-pages/2024-02-01/uuid-x.html" }],
          }),
        );
      }

      if (url.includes("/artifacts/proof/")) {
        return mockResponse(null, { headers: { "content-type": "image/jpeg" } });
      }

      if (url.includes("/artifacts/page-text/")) {
        return mockResponse(null, { headers: { "content-type": "text/plain; charset=utf-8" } });
      }

      return mockResponse("", { status: 404 });
    }) as unknown as typeof fetch;

    const domains = ["nike.com", "competitor.test"];
    const run = await runLiveVerification({
      domains,
      baseUrl: TEST_BASE_URL,
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      paceRequests: false,
      requestSpacingMs: 0,
    });

    expect(run.summary.total).toBe(2);
    expect(run.summary.verified).toBe(2);
    expect(run.summary.deadEnds).toBe(0);
    expect(run.summary.totalEntries).toBe(4);
    expect(run.summary.workingReceipts).toBe(8);
    expect(run.summary.brokenReceipts).toBe(0);
    expect(run.summary.sharePresent).toBe(2);

    const competitor = run.results.find((r) => r.domain === "competitor.test")!;
    expect(competitor.entryCount).toBe(3);
    expect(competitor.workingReceiptCount).toBe(6);
    expect(competitor.outcome).toBe("verified");

    const nike = run.results.find((r) => r.domain === "nike.com")!;
    expect(nike.entryCount).toBe(1);
    expect(nike.outcome).toBe("verified");

    // All receipt fetches should be HEAD probes.
    const receiptCalls = calls.filter((c) => c.includes("/artifacts/"));
    expect(receiptCalls.every((c) => c.startsWith("HEAD "))).toBe(true);
  });

  it("emits onResult for each probe", async () => {
    const fetchMock = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const domain = new URL(url).pathname.replace("/timeline/", "");
      return mockResponse(
        timelineHtml({ domain, entries: [{ id: "x", capturedAt: "2024-02-01", dateLabel: "1 Feb 2024", headline: "Offer" }] }),
      );
    }) as unknown as typeof fetch;

    const seen: Array<{ domain: string; index: number; total: number }> = [];
    await runLiveVerification({
      domains: ["a.test", "b.test"],
      baseUrl: TEST_BASE_URL,
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      paceRequests: false,
      requestSpacingMs: 0,
      onResult: (probe, index, total) => {
        seen.push({ domain: probe.domain, index, total });
      },
    });
    expect(seen).toEqual([
      { domain: "a.test", index: 1, total: 2 },
      { domain: "b.test", index: 2, total: 2 },
    ]);
  });
});

describe("format helpers", () => {
  it("formatProbeLine includes status, row count, receipts, share, and elapsed", () => {
    const probe = {
      domain: "nike.com",
      url: buildCanonicalTimelineUrl(DEFAULT_BASE_URL, "nike.com"),
      finalUrl: buildCanonicalTimelineUrl(DEFAULT_BASE_URL, "nike.com"),
      outcome: "verified" as const,
      status: 200,
      elapsedMs: 1234,
      entryCount: 2,
      entries: [],
      shareUrl: buildCanonicalTimelineUrl(DEFAULT_BASE_URL, "nike.com"),
      sharePresent: true,
      receiptChecks: [],
      workingReceiptCount: 2,
      brokenReceiptCount: 0,
      requestError: null,
    };
    const line = formatProbeLine(probe, 1, 5);
    expect(line).toContain("nike.com");
    expect(line).toContain("status=200");
    expect(line).toContain("rows=  2");
    expect(line).toContain("receipts= 2/ 2");
    expect(line).toContain("share=yes");
    expect(line).toContain("elapsed= 1234ms");
  });

  it("formatSummary renders the run summary", () => {
    const run = {
      baseUrl: TEST_BASE_URL,
      results: [],
      summary: {
        total: 5,
        verified: 3,
        deadEnds: 1,
        notFound: 1,
        retired: 0,
        rateLimited: 0,
        errors: 0,
        sharePresent: 4,
        workingReceipts: 6,
        brokenReceipts: 1,
        totalEntries: 9,
      },
    };
    const summary = formatSummary({ run });
    expect(summary).toContain("BET 3 live verification");
    expect(summary).toContain("Probed 5 domain(s)");
    expect(summary).toContain("verified: 3");
    expect(summary).toContain("receipt links: 6 working / 1 broken");
  });
});

describe("module exports", () => {
  it("exports the default base URL, user agent, and demo brand set", () => {
    expect(DEFAULT_BASE_URL).toBe("https://0509.io");
    expect(DEFAULT_USER_AGENT).toBe("0509-bet3-live-verification/1.0");
    expect(DEMO_BRAND_PAGE_DOMAINS).toEqual([
      "nike.com",
      "nykaa.com",
      "allbirds.com",
      "lenskart.com",
      "mamaearth.com",
    ]);
    expect(Object.isFrozen(DEMO_BRAND_PAGE_DOMAINS)).toBe(true);
    expect(WATCHED_MIN_DAYS).toBe(14);
    expect(WATCHED_MIN_STATES).toBe(3);
  });

  it("uses the public-brand-page rate limit window (120 / 10 min)", () => {
    expect(BRAND_PAGE_RATE_LIMIT_MAX).toBe(120);
    expect(BRAND_PAGE_RATE_LIMIT_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("builds canonical timeline URLs", () => {
    expect(buildCanonicalTimelineUrl("https://0509.io", "nike.com")).toBe(
      "https://0509.io/timeline/nike.com",
    );
  });

  it("stays in lockstep with DEMO_BRAND_PAGE_DOMAINS", () => {
    expect([...DEMO_BRAND_PAGE_DOMAINS]).toEqual([...SOURCE_DEMO_BRANDS]);
  });

  it("keeps npm run canary:bet3 pointing at the live verification script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["canary:bet3"]).toBe(
      "node scripts/bet3-live-verification.mjs --from-sitemap --json",
    );
  });

  it("parses optional D1 counts from env strings", () => {
    expect(parseOptionalCount(undefined)).toBeNull();
    expect(parseOptionalCount("")).toBeNull();
    expect(parseOptionalCount("  ")).toBeNull();
    expect(parseOptionalCount("12")).toBe(12);
    expect(parseOptionalCount("not-a-number")).toBeNull();
  });
});

describe("createRateLimiter", () => {
  it("waits for a slot when the window is full", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = createRateLimiter({
      nowImpl: () => now,
      sleepImpl: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      maxRequests: 2,
      windowMs: 1_000,
    });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThanOrEqual(1_000);
  });
});
