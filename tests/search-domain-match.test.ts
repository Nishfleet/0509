import { describe, expect, it } from "vitest";

import { domainMatchTier, isVerifiedDomainMatchLevel } from "~/lib/search-domain-match";
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

describe("BET 2 live gaps (issue #1202)", () => {
  it("verifies ŌURA ads that land on ouraring.com against an oura.com search", () => {
    const intent = parseSearchInputFromWebsiteField("https://oura.com");
    const ring = ad({
      advertiser: "ŌURA",
      landingPageUrl: "https://ouraring.com/store/rings/oura-ring-4",
    });

    const exact = classifyDomainMatches([ring], intent, { includeUnverified: false });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.match.confidenceCategory).toBe("verified");
  });

  it("classifies a ŌURA advertiser with no landing page as likely, not unmatched", () => {
    const intent = parseSearchInputFromWebsiteField("https://oura.com");
    const ring = ad({
      advertiser: "ŌURA",
      body: "Make health a daily practice with Oura Ring 4.",
      landingPageUrl: null,
    });

    expect(explainDomainMatch(ring, intent)?.level).toBe("likely_brand_name");
  });

  it("verifies BOSS ads that land on hugoboss.com against a hugo-boss.com search", () => {
    const intent = parseSearchInputFromWebsiteField("https://hugo-boss.com");
    const boss = ad({
      advertiser: "BOSS",
      landingPageUrl: "https://www.hugoboss.com/men",
    });

    const exact = classifyDomainMatches([boss], intent, { includeUnverified: false });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.match.confidenceCategory).toBe("verified");
  });

  it("verifies Notion ads that land on notion.com against a notion.so search", () => {
    const intent = parseSearchInputFromWebsiteField("https://notion.so");
    const notion = ad({
      advertiser: "Notion",
      landingPageUrl: "https://www.notion.com/product",
    });

    const exact = classifyDomainMatches([notion], intent, { includeUnverified: false });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.match.confidenceCategory).toBe("verified");
  });

  it("upgrades a Mamaearth brand-name match to verified when website identity confirms the name", () => {
    const intent = parseSearchInputFromWebsiteField("https://mamaearth.com");
    const mamaearth = ad({
      advertiser: "Mamaearth",
      landingPageUrl: null,
    });

    const exact = classifyDomainMatches([mamaearth], intent, {
      includeUnverified: false,
      identityAliases: ["Mamaearth"],
    });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.match.level).toBe("verified_entity");
    expect(exact[0]?.match.confidenceCategory).toBe("verified");
  });

  it("upgrades Allbirds Japan when the site name confirms Allbirds", () => {
    const intent = parseSearchInputFromWebsiteField("https://allbirds.com");
    const japan = ad({
      advertiser: "Allbirds Japan",
      landingPageUrl: null,
    });

    const exact = classifyDomainMatches([japan], intent, {
      includeUnverified: false,
      identityAliases: ["Allbirds"],
    });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.match.confidenceCategory).toBe("verified");
  });

  it("does not verify Notion Press Publishing just because notion.so's site name is Notion", () => {
    const intent = parseSearchInputFromWebsiteField("https://notion.so");
    const publisher = ad({
      advertiser: "Notion Press Publishing",
      landingPageUrl: null,
    });

    const exact = classifyDomainMatches([publisher], intent, {
      includeUnverified: true,
      identityAliases: ["Notion"],
    });
    expect(exact[0]?.match.confidenceCategory).not.toBe("verified");
  });

  it("still rejects the okara.ai clinic even with a matching-looking identity alias", () => {
    const intent = parseSearchInputFromWebsiteField("https://okara.ai");
    const clinic = ad({
      advertiser: "ESHAL HOMEOPATHIC CLINIC OKARA",
      body: "Visit our clinic in Okara, Pakistan",
      landingPageUrl: "https://eshal-clinic.example.com",
    });

    const exact = classifyDomainMatches([clinic], intent, {
      includeUnverified: false,
      identityAliases: ["Okara"],
    });
    expect(exact).toHaveLength(0);
  });
});

describe("goat.com mandatory regression (BET 2 — wrong-brand wall)", () => {
  // The sneaker marketplace goat.com is the brand a "goat" / "goat.com" query
  // is after. "The GOAT" (thegoatco.au) is an unrelated AU mouth-tape brand
  // whose advertiser name and copy contain the stem "goat". It must never be
  // classified as a verified match for goat.com — the same homonym class as
  // the okara.ai clinic. A bare "goat" keyword has no domain intent, so it
  // cannot be verified either; the live /search?q=goat path labels it
  // unmatched via the search-answer keyword verdict instead of classifying it
  // here (see tests/search-answer.test.ts).
  const mouthTape = (): AdRecord =>
    ad({
      metaAdId: "goat-mouth-tape",
      advertiser: "The GOAT",
      body: "THE NEW GOAT MOUTH TAPE IS HERE. Kirsten K., Verified Buyer",
      previewHeadline: "THE NEW GOAT MOUTH TAPE IS HERE",
      landingPageUrl: "https://thegoatco.au/products/mouth-tape",
      countries: ["Australia"],
    });

  it("does NOT verify the thegoatco.au mouth-tape ad for a goat.com query", () => {
    const intent = parseSearchInputFromWebsiteField("https://goat.com");
    const explanation = explainDomainMatch(mouthTape(), intent);

    expect(explanation).not.toBeNull();
    expect(explanation?.confidenceCategory).not.toBe("verified");
    expect(isVerifiedDomainMatchLevel(explanation!.level)).toBe(false);
    // Keyword-only homonym: the advertiser name "The GOAT" leads with "the",
    // not "goat", so it falls through to unverified_text_candidate (unmatched),
    // never likely_brand_name.
    expect(explanation?.level).toBe("unverified_text_candidate");
  });

  it("excludes the thegoatco.au mouth-tape ad from the verified-only set for goat.com", () => {
    const intent = parseSearchInputFromWebsiteField("goat.com");
    const exact = classifyDomainMatches([mouthTape()], intent, { includeUnverified: false });
    expect(exact).toHaveLength(0);
  });

  it("labels the thegoatco.au mouth-tape ad as unmatched when unverified candidates are kept", () => {
    const intent = parseSearchInputFromWebsiteField("https://goat.com");
    const broader = classifyDomainMatches([mouthTape()], intent, { includeUnverified: true });
    expect(broader).toHaveLength(1);
    expect(broader[0]?.match.confidenceCategory).toBe("unverified");
    expect(isVerifiedDomainMatchLevel(broader[0]!.match.level)).toBe(false);
  });

  it("does not verify the thegoatco.au mouth-tape ad for a bare 'goat' keyword query", () => {
    // A bare "goat" keyword parses to a text intent with no registrable
    // domain, so the domain matcher declines to classify it at all — it can
    // never come back as a verified goat.com result.
    const intent = parseSearchInputFromWebsiteField("goat");
    expect(intent.intent).toBe("text");
    expect(intent.registrableDomain).toBeNull();
    expect(explainDomainMatch(mouthTape(), intent)).toBeNull();
  });

  it("still accepts ads that genuinely land on goat.com", () => {
    const intent = parseSearchInputFromWebsiteField("https://goat.com");
    const verified = ad({
      metaAdId: "goat-sneaker-marketplace",
      advertiser: "GOAT",
      landingPageUrl: "https://www.goat.com/sneakers",
    });

    const exact = classifyDomainMatches([verified], intent, { includeUnverified: false });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.match.confidenceCategory).toBe("verified");
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
