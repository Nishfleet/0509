import { describe, expect, it } from "vitest";

import {
  buildSignupTrackingPath,
  registrableDomainFromLandingPage,
  resolveSignupDomainFromAds,
} from "~/lib/competitor-website";

interface LiteAd {
  landingPageUrl: string | null;
}

function ads(...items: LiteAd[]): LiteAd[] {
  return items;
}

describe("registrableDomainFromLandingPage", () => {
  it("extracts the bare registrable domain from a full landing-page URL", () => {
    expect(registrableDomainFromLandingPage("https://www.nike.com/air-max")).toBe(
      "nike.com",
    );
  });

  it("drops trailing dots and lowercases the host", () => {
    expect(registrableDomainFromLandingPage("https://Nike.com./path")).toBe(
      "nike.com",
    );
  });

  it("returns null for non-http(s) URLs", () => {
    expect(registrableDomainFromLandingPage("ftp://nike.com/x")).toBeNull();
    expect(registrableDomainFromLandingPage("wa.me/919999999999")).toBeNull();
  });

  it("returns null for missing or unparseable input", () => {
    expect(registrableDomainFromLandingPage(null)).toBeNull();
    expect(registrableDomainFromLandingPage("")).toBeNull();
    expect(registrableDomainFromLandingPage("not a url")).toBeNull();
  });
});

describe("resolveSignupDomainFromAds", () => {
  it("returns the first ad's registrable domain in display order", () => {
    expect(
      resolveSignupDomainFromAds(
        ads(
          { landingPageUrl: "https://www.nike.com/air-max" },
          { landingPageUrl: "https://adidas.com/" },
        ),
      ),
    ).toBe("nike.com");
  });

  it("skips ads with missing or non-web landing pages and uses the next usable one", () => {
    expect(
      resolveSignupDomainFromAds(
        ads(
          { landingPageUrl: null },
          { landingPageUrl: "wa.me/919999999999" },
          { landingPageUrl: "https://nykaa.com/glow-days" },
        ),
      ),
    ).toBe("nykaa.com");
  });

  it("returns null when no ad carries a usable landing page", () => {
    expect(resolveSignupDomainFromAds(ads({ landingPageUrl: null }))).toBeNull();
    expect(resolveSignupDomainFromAds([])).toBeNull();
  });
});

describe("buildSignupTrackingPath", () => {
  it("threads the resolved domain from the top result on a keyword search", () => {
    const path = buildSignupTrackingPath({
      competitorWebsiteRaw: "",
      ads: ads({ landingPageUrl: "https://www.nike.com/air-max" }),
      country: "all",
    });
    expect(path).toBe(
      "/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dnike.com%23setup-checklist",
    );
  });

  it("preserves an explicit ?website= input unchanged", () => {
    const path = buildSignupTrackingPath({
      competitorWebsiteRaw: "nike.com",
      ads: ads({ landingPageUrl: "https://www.nike.com/air-max" }),
      country: "all",
    });
    expect(path).toBe(
      "/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dnike.com%23setup-checklist",
    );
  });

  it("preserves a full-URL ?website= input unchanged", () => {
    const path = buildSignupTrackingPath({
      competitorWebsiteRaw: "https://nykaa.com",
      ads: ads({ landingPageUrl: "https://nykaa.com/glow-days" }),
      country: "all",
    });
    expect(path).toBe(
      "/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dhttps%253A%252F%252Fnykaa.com%23setup-checklist",
    );
  });

  it("propagates a non-default country alongside the resolved domain", () => {
    const path = buildSignupTrackingPath({
      competitorWebsiteRaw: "",
      ads: ads({ landingPageUrl: "https://www.nike.com/air-max" }),
      country: "in",
    });
    expect(path).toBe(
      "/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dnike.com%26country%3Din%23setup-checklist",
    );
  });

  it("propagates a non-default country alongside an explicit ?website= input", () => {
    const path = buildSignupTrackingPath({
      competitorWebsiteRaw: "nike.com",
      ads: ads({ landingPageUrl: "https://www.nike.com/air-max" }),
      country: "in",
    });
    expect(path).toBe(
      "/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dnike.com%26country%3Din%23setup-checklist",
    );
  });

  it("omits country when it is the onboarding default 'all'", () => {
    const path = buildSignupTrackingPath({
      competitorWebsiteRaw: "",
      ads: ads({ landingPageUrl: "https://www.nike.com/air-max" }),
      country: "all",
    });
    expect(path).not.toContain("country");
  });

  it("falls back to the generic setup checklist when no brand resolves", () => {
    const path = buildSignupTrackingPath({
      competitorWebsiteRaw: "",
      ads: ads({ landingPageUrl: null }),
      country: "all",
    });
    expect(path).toBe(
      "/auth/signup?redirectTo=%2Fapp%23setup-checklist",
    );
  });

  it("falls back to the generic setup checklist on empty results", () => {
    const path = buildSignupTrackingPath({
      competitorWebsiteRaw: "",
      ads: [],
      country: "all",
    });
    expect(path).toBe(
      "/auth/signup?redirectTo=%2Fapp%23setup-checklist",
    );
  });

  it("does not invent a domain when the only landing page is non-web", () => {
    const path = buildSignupTrackingPath({
      competitorWebsiteRaw: "",
      ads: ads({ landingPageUrl: "wa.me/919999999999" }),
      country: "all",
    });
    expect(path).toBe(
      "/auth/signup?redirectTo=%2Fapp%23setup-checklist",
    );
  });
});
