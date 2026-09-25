import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { meta as homeMeta } from "../../app/routes/app.home";
import { meta as competitorsMeta } from "../../app/routes/app.competitors";
import { meta as onboardingMeta } from "../../app/routes/onboarding";

describe("document titles", () => {
  it("names Home, Competitors and the first onboarding screen", () => {
    expect(homeMeta()).toEqual([{ title: "Home · Five to Nine" }]);
    expect(competitorsMeta()).toEqual([{ title: "Competitors · Five to Nine" }]);
    expect(onboardingMeta()).toEqual([{ title: "Start with your website or a handle · Five to Nine" }]);
  });
});
