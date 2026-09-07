import { describe, expect, it } from "vitest";

import { buildPublicProofBrief } from "~/lib/public-proof.server";
import type { AdRecord } from "~/lib/types";

/**
 * The homepage proof brief is the flagship "real proof on every public
 * surface" surface: the copy it renders is read by every visitor before they
 * trust a single claim. These cases lock the summary sentence against the
 * class of defect that shipped live on 2026-08-20, where the website and the
 * library phrase were concatenated with no separator and 0509.io served
 * "12 public Meta ads link to nykaa.comin the Meta Ad Library."
 */

const FETCHED_AT = "2026-08-20T14:27:13.848Z";
const NOW = new Date("2026-08-20T17:27:13.848Z");

function makeAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "meta-1",
    advertiser: "Nykaa",
    body: "Body copy",
    previewHeadline: "Preview headline",
    previewSubhead: "Preview subhead",
    hook: "Unlock the secret to radiant skin",
    offer: "₹400 Off",
    cta: "Learn more",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nykaa.com/lp",
    adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1",
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-19T00:00:00.000Z",
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

function buildBrief(country: string) {
  return buildPublicProofBrief([makeAd(), makeAd({ metaAdId: "meta-2" })], {
    fetchedAt: FETCHED_AT,
    country,
    freshForLiveClaim: false,
    checkedAgoLabel: "about 3 hours ago",
    website: "nykaa.com",
    now: NOW,
  });
}

describe("public proof brief summary", () => {
  it("separates the website from the library phrase for the all-country brief", () => {
    const brief = buildBrief("all");

    expect(brief?.summary).toBe(
      "2 public Meta ads link to nykaa.com in the Meta Ad Library. Every source below opens the same page any visitor can open.",
    );
    // The exact live defect: the domain glued to the following word.
    expect(brief?.summary).not.toContain("nykaa.comin");
  });

  it("separates the website from the library phrase for a country-scoped brief", () => {
    const brief = buildBrief("India");

    expect(brief?.summary).toBe(
      "2 public Meta ads link to nykaa.com in the India Ad Library. Every source below opens the same page any visitor can open.",
    );
    expect(brief?.summary).not.toContain("nykaa.comin");
  });

  it("never runs two words together anywhere in the summary sentence", () => {
    for (const country of ["all", "India", "United States"]) {
      const summary = buildBrief(country)?.summary ?? "";
      // The website is always followed by a separator, never glued to the
      // next word — that gluing is exactly what shipped live.
      expect(summary).toContain("nykaa.com ");
      expect(summary).not.toMatch(/nykaa\.com[^\s.,]/i);
    }
  });
});
