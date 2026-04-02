import { describe, expect, it } from "vitest";

import {
  formatAnalysisSourceLabel,
  formatCaptureMethodLabel,
  formatLandingPageSignalValue,
  formatLandingPageFormValue,
} from "~/lib/landing-page-display";

describe("formatCaptureMethodLabel", () => {
  it("maps capture methods to explicit UI labels", () => {
    expect(formatCaptureMethodLabel("landing_page_fetch")).toBe("Fetch capture");
    expect(formatCaptureMethodLabel("browser_render")).toBe("Browser-rendered");
    expect(formatCaptureMethodLabel("manual")).toBe("Capture unavailable");
  });
});

describe("formatLandingPageSignalValue", () => {
  it("returns Not detected for missing string signals", () => {
    expect(formatLandingPageSignalValue(null)).toBe("Not detected");
    expect(formatLandingPageSignalValue("")).toBe("Not detected");
  });

  it("returns the detected string value when present", () => {
    expect(formatLandingPageSignalValue("Shop now")).toBe("Shop now");
  });
});

describe("formatLandingPageFormValue", () => {
  it("formats booleans and unknown values honestly", () => {
    expect(formatLandingPageFormValue(true)).toBe("Yes");
    expect(formatLandingPageFormValue(false)).toBe("No");
    expect(formatLandingPageFormValue(null)).toBe("Not detected");
  });
});

describe("formatAnalysisSourceLabel", () => {
  it("maps OCR and landing-page provenance sources to readable labels", () => {
    expect(formatAnalysisSourceLabel("ad_snapshot_fetch")).toBe("Ad snapshot fetch");
    expect(formatAnalysisSourceLabel("browser_render")).toBe("Browser-rendered");
    expect(formatAnalysisSourceLabel("landing_page_fetch")).toBe("Fetch capture");
    expect(formatAnalysisSourceLabel("user")).toBe("Manual");
  });
});
