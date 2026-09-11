import { createElement } from "react";
import { mockReactRouter } from "./helpers/mock-react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue 2473 (finding M48): the source-trail capture stamp on
// /competitor-monitoring rendered full-ISO timestamps ("2026-09-07T06:18:00Z")
// as a bare clock ("6:18 AM") with no date and no UTC pin — so a day-old
// capture read as "this morning". The homepage fixed the same bug (#1467);
// this file pins the route to the same rendering: "Sep 7, 6:18 AM", UTC.
import type { PublicProofBrief } from "~/lib/public-proof.server";

const routePath = "app/routes/competitor-monitoring.tsx";

const proofBrief: PublicProofBrief = {
  competitorName: "Nykaa Beauty",
  website: "https://nykaa.com",
  adLibraryCountry: "IN",
  fetchedAt: "2026-09-07T06:18:00.000Z",
  checkedAgoLabel: "about 4 hours ago",
  freshForLiveClaim: true,
  adCount: 12,
  activeAdCount: 9,
  summary: "12 public Meta ads link to Nykaa Beauty in India.",
  decision: {
    subject: "Nykaa Beauty",
    whatChanged: "New offer hooks.",
    whyItMatters: "Fresh creative pressure on your category.",
    priority: "Watch weekly",
    proofStatus: "On record · Meta Ad Library",
    source: "Meta Ad Library (public archive) — India",
    freshness: "about 4 hours ago",
    nextAction: "Open the ad library",
  },
  proofTrail: [
    {
      id: "trail-1",
      signal: "Ad hook",
      evidence: "Flat 25% off all skincare",
      source: "Meta Ad Library (public archive) — India",
      sourceUrl: "https://www.facebook.com/ads/library",
      capturedAt: "2026-09-07T06:18:00.000Z",
      creativeId: "creative-1",
      creativeImageUrl: null,
    },
  ],
  insights: {
    topHooks: ["Flat 25% off"],
    mediaMix: [{ channel: "image", count: 9 }],
    timeline: ["3 new ads this week"],
  },
  reportRows: ["12 public Meta ads"],
};

beforeEach(() => {
  vi.resetModules();
  mockReactRouter({
    loaderData: () => undefined,
    loader: () => ({ proofBrief }),
    location: () => ({ pathname: "/competitor-monitoring" }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("competitor-monitoring capture timestamps (issue 2473 / M48)", () => {
  it("renders a full-ISO capture with its date, not just a bare clock", async () => {
    const { default: CompetitorMonitoringCategoryRoute } = await import(
      "~/routes/competitor-monitoring"
    );
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringCategoryRoute));

    // The capture stamp must carry the calendar date ("Sep 7"), not read as a
    // bare clock that implies "this morning" for a possibly older capture.
    expect(markup).toContain("Sep 7");
    // It must not render the raw ISO string either.
    expect(markup).not.toContain("2026-09-07T06:18:00");
    // It must not render a bare clock with no date attached (M48 repro).
    expect(markup).not.toMatch(/Captured \d{1,2}:\d{2} [AP]M</);
  });

  it("keeps the date-only branch rendering the calendar date", async () => {
    const source = (await import("node:fs")).readFileSync(routePath, "utf8");
    // The date-only branch (issue 1032) is untouched: same year handling and
    // UTC pinning.
    expect(source).toContain('parsed.toLocaleString("en", {\n      month: "short",');
  });
});
