import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { SearchResultRow } from "~/components/search/result-row";
import type { AdRecord } from "~/lib/types";

/**
 * Issue #1433 — a `q=` keyword search row must render its tier label
 * (Verified / Likely / Unmatched) in `result-row.tsx`. Before the fix, the v1
 * keyword pipeline attached no `domainMatch` object, so `formatResultTierLabel`
 * returned null and the row carried no confidence marker.
 */
function baseAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "GOAT Mouth Tape",
    body: "Breathe better at night.",
    previewHeadline: "Mouth tape",
    previewSubhead: "Sleep aid",
    hook: "Mouth tape",
    offer: "Shop now",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["United States"],
    platforms: ["Instagram"],
    firstSeenAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    lastSeenAt: new Date().toISOString(),
    active: true,
    researchSummary: "Fixture evidence.",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  } as AdRecord;
}

function renderRow(ad: AdRecord) {
  const Stub = createRoutesStub([
    {
      path: "/search",
      Component: () => (
        <SearchResultRow
          ad={ad}
          canQuickSave={false}
          collections={[]}
          href="/search?selected=ad-1"
          isActive={false}
          isKeyFocused={false}
          plan="free"
        />
      ),
    },
  ]);
  return renderToStaticMarkup(<Stub initialEntries={["/search"]} />);
}

describe("issue #1433 — keyword search result row renders the tier label", () => {
  it("renders Unmatched when a keyword-search row carries an unmatched domainMatch", () => {
    const markup = renderRow(
      baseAd({
        domainMatch: {
          level: "unverified_provider_candidate",
          reason:
            "Returned for “goat” by the Meta source; no brand website was searched, so the connection is unverified",
          matchedDomain: null,
        },
      }),
    );
    // The tier word leads the summary line so the row is labelled by its
    // confidence, never a silent unlabelled list.
    expect(markup).toContain("Unmatched");
    expect(markup).toContain("GOAT Mouth Tape");
  });

  it("renders Likely when a keyword-search row carries a likely domainMatch", () => {
    const markup = renderRow(
      baseAd({
        advertiser: "Notion",
        domainMatch: {
          level: "likely_brand_name",
          reason: "Advertiser name matches notion.so — website link not captured",
          matchedDomain: "notion.so",
        },
      }),
    );
    expect(markup).toContain("Likely");
    expect(markup).toContain("Notion");
  });

  it("renders no tier word when the row carries no domainMatch (regression guard shape)", () => {
    // A legacy v1 website= row that fell through to the unlabelled path still
    // renders no tier word — this change does not extend v2 to that path.
    const markup = renderRow(baseAd());
    expect(markup).not.toContain("Unmatched");
    expect(markup).not.toContain("Likely");
  });
});
