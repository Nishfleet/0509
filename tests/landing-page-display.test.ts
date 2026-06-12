import { describe, expect, it } from "vitest";

import {
  formatAnalysisSourceLabel,
  formatCaptureMethodLabel,
  formatConfidenceBandLabel,
  formatDeliveryAttemptStatusLabel,
  formatImportanceBandLabel,
  formatLandingPageSignalValue,
  formatLandingPageFormValue,
  formatProofAgeLabel,
  formatWhyAlertedLabel,
} from "~/lib/landing-page-display";

describe("formatCaptureMethodLabel", () => {
  it("maps capture methods to explicit UI labels", () => {
    expect(formatCaptureMethodLabel("landing_page_fetch")).toBe("Page text checked");
    expect(formatCaptureMethodLabel("browser_render")).toBe("Checked in browser");
    expect(formatCaptureMethodLabel("manual")).toBe("Not checked yet");
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
    expect(formatAnalysisSourceLabel("ad_snapshot_fetch")).toBe("Ad snapshot");
    expect(formatAnalysisSourceLabel("browser_render")).toBe("Browser check");
    expect(formatAnalysisSourceLabel("landing_page_fetch")).toBe("Page text");
    expect(formatAnalysisSourceLabel("meta_library_browser")).toBe("Live ad check");
    expect(formatAnalysisSourceLabel("user")).toBe("Edited by user");
  });
});

describe("formatImportanceBandLabel", () => {
  it("maps scores to user-facing importance bands", () => {
    expect(formatImportanceBandLabel(92)).toBe("High priority");
    expect(formatImportanceBandLabel(74)).toBe("Medium priority");
    expect(formatImportanceBandLabel(42)).toBe("Low priority");
  });
});

describe("formatConfidenceBandLabel", () => {
  it("maps proof field confidence into clear trust labels", () => {
    expect(formatConfidenceBandLabel({ headline: 0.92, ctaText: 0.88 })).toBe("High confidence");
    expect(formatConfidenceBandLabel({ headline: 0.72 })).toBe("Medium confidence");
    expect(formatConfidenceBandLabel({ headline: 0.4 })).toBe("Low confidence");
    expect(formatConfidenceBandLabel({})).toBe("Confidence pending");
  });
});

describe("formatProofAgeLabel", () => {
  it("shows relative proof freshness", () => {
    expect(
      formatProofAgeLabel("2026-04-18T11:00:00.000Z", {
        now: "2026-04-18T12:00:00.000Z",
      }),
    ).toBe("1h ago");
    expect(
      formatProofAgeLabel("2026-04-16T12:00:00.000Z", {
        now: "2026-04-18T12:00:00.000Z",
      }),
    ).toBe("2d ago");
    expect(formatProofAgeLabel(null)).toBe("No proof yet");
  });
});

describe("formatWhyAlertedLabel", () => {
  it("explains why a confirmed proof-backed change surfaced", () => {
    expect(
      formatWhyAlertedLabel({
        eventType: "landing_page_offer_changed",
        status: "confirmed",
        metadata: {
          from: "Starting at ₹499",
          to: "Starting at ₹799",
        },
      }),
    ).toBe("Offer moved from Starting at ₹499 to Starting at ₹799.");
  });

  it("keeps provisional events clearly provisional", () => {
    expect(
      formatWhyAlertedLabel({
        eventType: "landing_page_headline_changed",
        status: "proof_pending",
        metadata: {},
      }),
    ).toBe("Possible change detected. Proof is still running.");
  });
});

describe("formatDeliveryAttemptStatusLabel", () => {
  it("maps delivery statuses to concise trust wording", () => {
    expect(formatDeliveryAttemptStatusLabel("sent", "email")).toBe("Delivered by email");
    expect(formatDeliveryAttemptStatusLabel("failed", "whatsapp")).toBe("WhatsApp failed");
    expect(formatDeliveryAttemptStatusLabel("skipped_due_to_quiet_hours", "email")).toBe("Deferred by quiet hours");
  });
});

describe("formatAdvertiserLabel", () => {
  it("labels missing advertisers honestly instead of guessing", async () => {
    const { formatAdvertiserLabel } = await import("~/lib/landing-page-display");

    expect(formatAdvertiserLabel("Nykaa")).toBe("Nykaa");
    expect(formatAdvertiserLabel("  Nykaa  ")).toBe("Nykaa");
    expect(formatAdvertiserLabel("")).toBe("Advertiser unconfirmed");
    expect(formatAdvertiserLabel("   ")).toBe("Advertiser unconfirmed");
    expect(formatAdvertiserLabel(null)).toBe("Advertiser unconfirmed");
    expect(formatAdvertiserLabel(undefined)).toBe("Advertiser unconfirmed");
  });
});
