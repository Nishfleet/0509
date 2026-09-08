import { describe, expect, it } from "vitest";

import { meta, type RootLoaderData } from "~/root";

function baseData(overrides: Partial<RootLoaderData> = {}): RootLoaderData {
  return {
    session: null,
    hasAuthCookie: false,
    allowsSiteRepScript: false,
    pricingPlans: [],
    usageBundles: [],
    countryCode: null,
    googleSiteVerification: undefined,
    ...overrides,
  };
}

// Acceptance: GOOGLE_SITE_VERIFICATION set -> meta tag rendered with the
// value; unset -> no tag, no behavior change. The value always arrives via
// the Cloudflare env (wrangler secret), never from the repo.
describe("google-site-verification meta tag", () => {
  it("emits the verification meta tag with the value when set", () => {
    const tags = meta({ data: baseData({ googleSiteVerification: "test-verify-token" }) });

    const tag = tags.find((t) => "name" in t && t.name === "google-site-verification");
    expect(tag).toEqual({ name: "google-site-verification", content: "test-verify-token" });
  });

  it("emits no verification tag when the env var is unset", () => {
    const tags = meta({ data: baseData() });
    expect(tags.find((t) => "name" in t && t.name === "google-site-verification")).toBeUndefined();
  });

  it("emits no verification tag for an empty/whitespace value", () => {
    const tags = meta({ data: baseData({ googleSiteVerification: "   " }) });
    expect(tags.find((t) => "name" in t && t.name === "google-site-verification")).toBeUndefined();
  });

  it("keeps the page title alongside the verification tag", () => {
    const tags = meta({ data: baseData({ googleSiteVerification: "tok" }) });
    expect(tags[0]).toEqual({ title: "Five to Nine" });
    expect(tags).toHaveLength(2);
  });
});
