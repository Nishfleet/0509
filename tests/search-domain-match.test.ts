import { describe, expect, it } from "vitest";

import { domainMatchTier } from "~/lib/search-domain-match";
import {
  classifyDomainMatches,
  explainDomainMatch,
  rejectGeographyKeywordOnlyMatch,
} from "~/lib/search-domain-match.server";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import type { AdRecord } from "~/lib/types";

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Example",
    body: "Body",
    previewHeadline: "Headline",
    previewSubhead: "Subhead",
    hook: "Hook",
    offer: "Offer",
    cta: "Learn more",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["Pakistan"],
    platforms: ["Facebook"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

describe("okara.ai mandatory regression", () => {
  const intent = parseSearchInputFromWebsiteField("https://okara.ai");

  it("rejects Eshal Homeopathic Clinic Okara when landing is unrelated", () => {
    const clinic = ad({
      metaAdId: "clinic-okara",
      advertiser: "ESHAL HOMEOPATHIC CLINIC OKARA",
      body: "Visit our clinic in Okara, Pakistan",
      landingPageUrl: "https://eshal-clinic.example.com",
    });

    expect(rejectGeographyKeywordOnlyMatch(clinic, intent)).toBe(true);
    expect(explainDomainMatch(clinic, intent)?.level).toBe("unverified_text_candidate");

    const exact = classifyDomainMatches([clinic], intent, { includeUnverified: false });
    expect(exact).toHaveLength(0);
  });

  it("accepts ads landing on okara.ai", () => {
    const verified = ad({
      metaAdId: "okara-product",
      advertiser: "Okara",
      landingPageUrl: "https://www.okara.ai/pricing",
    });

    const exact = classifyDomainMatches([verified], intent, { includeUnverified: false });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.match.level).toMatch(/exact_hostname|registrable_domain/);
  });

  it("includes broader keyword-only matches only when requested", () => {
    const clinic = ad({
      advertiser: "ESHAL HOMEOPATHIC CLINIC OKARA",
      body: "Okara clinic",
      landingPageUrl: null,
    });

    const broader = classifyDomainMatches([clinic], intent, { includeUnverified: true });
    expect(broader).toHaveLength(1);
    expect(broader[0]?.match.level).toBe("unverified_text_candidate");
  });
});

describe("domain match hierarchy", () => {
  const intent = parseSearchInputFromWebsiteField("https://app.okara.ai");

  it("prefers exact hostname over registrable-only matches in ranking order", () => {
    const exactHost = ad({ metaAdId: "a", landingPageUrl: "https://app.okara.ai" });
    const registrable = ad({ metaAdId: "b", landingPageUrl: "https://marketing.okara.ai" });

    const matches = classifyDomainMatches([registrable, exactHost], intent, { includeUnverified: false });
    expect(matches[0]?.ad.metaAdId).toBe("a");
  });
});

describe("regional brand properties (BET 3 demo /ads pages)", () => {
  it("verifies Allbirds ads that land on allbirds.co.uk against an allbirds.com search", () => {
    const intent = parseSearchInputFromWebsiteField("https://allbirds.com");
    const regional = ad({
      advertiser: "Allbirds",
      landingPageUrl: "https://www.allbirds.co.uk/products/womens-dasher",
    });

    const exact = classifyDomainMatches([regional], intent, { includeUnverified: false });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.match.level).toBe("verified_alias");
    expect(exact[0]?.match.confidenceCategory).toBe("verified");
  });

  it("verifies Mamaearth ads that land on mamaearth.in against a mamaearth.com search", () => {
    const intent = parseSearchInputFromWebsiteField("https://mamaearth.com");
    const regional = ad({
      advertiser: "Mamaearth",
      landingPageUrl: "https://mamaearth.in/product/ubtan-face-wash",
    });

    const exact = classifyDomainMatches([regional], intent, { includeUnverified: false });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.match.level).toBe("verified_alias");
    expect(exact[0]?.match.confidenceCategory).toBe("verified");
  });

  it("still rejects the okara.ai geography-keyword clinic", () => {
    const intent = parseSearchInputFromWebsiteField("https://okara.ai");
    const clinic = ad({
      advertiser: "ESHAL HOMEOPATHIC CLINIC OKARA",
      landingPageUrl: "https://eshal-clinic.example.com",
    });
    const exact = classifyDomainMatches([clinic], intent, { includeUnverified: false });
    expect(exact).toHaveLength(0);
  });
});

describe("domainMatchTier", () => {
  it("maps verified levels to verified, brand-name to likely, and everything else to unmatched", () => {
    expect(domainMatchTier("exact_hostname")).toBe("verified");
    expect(domainMatchTier("likely_brand_name")).toBe("likely");
    expect(domainMatchTier("unverified_text_candidate")).toBe("unmatched");
    expect(domainMatchTier("unverified_provider_candidate")).toBe("unmatched");
    expect(domainMatchTier(undefined)).toBe("unmatched");
    expect(domainMatchTier(null)).toBe("unmatched");
  });
});
