import { describe, expect, it } from "vitest";

import { googleAdsAdapter } from "~/lib/sources/google-ads.server";
import { getSourceAdapter } from "~/lib/sources/registry.server";

/**
 * Adapter identity for the Google Ads source — issue #2189.
 *
 * The generic seam tests (tests/presence-source-coverage.test.ts) DERIVE
 * "configured" from `implemented` + `requiresEnv(env)` and quietly
 * reclassify the adapter instead of failing if `implemented` flips back to
 * false. These assertions live with the source, so a flip fails here. Shape
 * mirrors tests/sources/subdomains-adapter.test.ts.
 */
describe("googleAdsAdapter", () => {
  it("exports the id, label, implemented flag and requiresEnv the coverage rule depends on", () => {
    expect(googleAdsAdapter.id).toBe("google_ads");
    expect(googleAdsAdapter.label).toBe("Google Ads (Transparency Center)");
    expect(googleAdsAdapter.implemented).toBe(true);
    // No credentials: requiresEnv is always true, so coverage resolves to
    // "configured" without any env var present.
    expect(googleAdsAdapter.requiresEnv({} as never)).toBe(true);
  });

  it("is the adapter the registry resolves for google_ads", () => {
    expect(getSourceAdapter("google_ads")).toBe(googleAdsAdapter);
  });
});
