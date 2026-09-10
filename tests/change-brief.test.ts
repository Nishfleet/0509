import { describe, expect, it } from "vitest";

import {
  buildChangeLeadSubject,
  changeBriefCapturedSuffix,
  changeBriefCriticalityLine,
  changeBriefMeaningLine,
  changeBriefNoScreenshotReason,
  CHANGE_BRIEF_CRITICALITY_NOT_SCORED,
  formatChangeBriefTime,
  readChangeBriefCaptureTimes,
  readChangeBriefCriticality,
  readChangeBriefMark,
  sanitizeEmailSubjectLine,
} from "~/lib/change-brief.server";

describe("readChangeBriefMark", () => {
  it("returns the from/to tokens when both are stored and differ", () => {
    expect(
      readChangeBriefMark({
        metadata: { from: "20% off", to: "30% off" },
      }),
    ).toEqual({ from: "20% off", to: "30% off" });
  });

  it("returns null when the values are equal, missing, or too long to read as tokens", () => {
    expect(
      readChangeBriefMark({ metadata: { from: "same", to: "same" } }),
    ).toBeNull();
    expect(readChangeBriefMark({ metadata: { from: "only" } })).toBeNull();
    expect(readChangeBriefMark({ metadata: {} })).toBeNull();
    expect(
      readChangeBriefMark({
        metadata: { from: "x".repeat(49), to: "short" },
      }),
    ).toBeNull();
  });
});

describe("readChangeBriefCriticality", () => {
  it("prefers the monitor's stored band and reasons over a recompute", () => {
    const criticality = readChangeBriefCriticality({
      eventType: "website_page_changed",
      metadata: {
        criticalityBand: "critical",
        criticalityReasons: ["price-token", "cta-string-change"],
        priorityScore: 88,
        from: "€49",
        to: "€29",
      },
    });
    expect(criticality.band).toBe("critical");
    expect(criticality.bandLabel).toBe("Critical");
    expect(criticality.score).toBe(88);
    expect(criticality.reasonLabels).toEqual([
      "price or offer terms moved",
      "the CTA text changed",
    ]);
  });

  it("scores landing-page offer changes from stored before/after values", () => {
    const criticality = readChangeBriefCriticality({
      eventType: "landing_page_offer_changed",
      metadata: { from: "20% off", to: "30% off" },
    });
    expect(criticality.band).not.toBeNull();
    expect(criticality.reasonLabels).toContain("price or offer terms moved");
  });

  it("returns the honest not-scored state when no signal exists", () => {
    const criticality = readChangeBriefCriticality({
      eventType: "ad_new",
      metadata: {},
    });
    expect(criticality.band).toBeNull();
    expect(criticality.bandLabel).toBe("Not scored");
    expect(changeBriefCriticalityLine(criticality)).toBe(
      `Criticality: ${CHANGE_BRIEF_CRITICALITY_NOT_SCORED}`,
    );
  });

  it("humanizes unknown stored reason tokens instead of dropping them", () => {
    const criticality = readChangeBriefCriticality({
      eventType: "website_page_changed",
      metadata: {
        criticalityBand: "routine",
        criticalityReasons: ["novel-future-token"],
      },
    });
    expect(criticality.reasonLabels).toEqual(["novel future token"]);
  });
});

describe("changeBriefMeaningLine", () => {
  it("is deterministic per change type and never invents specifics", () => {
    expect(
      changeBriefMeaningLine({ eventType: "landing_page_offer_changed" }),
    ).toContain("discount pressure");
    expect(changeBriefMeaningLine({ eventType: "ad_new" })).toContain(
      "fresh campaign",
    );
    expect(
      changeBriefMeaningLine({ metadata: { kind: "baseline" } }),
    ).toContain("starting snapshot");
    expect(changeBriefMeaningLine({ eventType: "unknown_future_type" })).toBe(
      "A tracked change usually means the competitor is iterating on something worth a look.",
    );
  });
});

describe("changeBriefNoScreenshotReason", () => {
  it("names the honest reason for each proof state", () => {
    expect(
      changeBriefNoScreenshotReason({ metadata: { kind: "baseline" } }),
    ).toBe("No before screenshot — this is the first captured state.");
    expect(changeBriefNoScreenshotReason({ eventType: "ad_new" })).toBe(
      "No page screenshot — ad changes are tracked from the ad library, not page captures.",
    );
    expect(changeBriefNoScreenshotReason({ provisional: true })).toBe(
      "No screenshot yet — this change is still unconfirmed.",
    );
    expect(
      changeBriefNoScreenshotReason({ proofStatus: "proof_pending" }),
    ).toBe("No screenshot yet — the proof capture is still pending.");
    expect(
      changeBriefNoScreenshotReason({ proofStatus: "proof_failed" }),
    ).toBe("No screenshot captured — the proof capture did not complete.");
    expect(changeBriefNoScreenshotReason({})).toBe(
      "No screenshot stored — the scheduled scan recorded this change without a page capture.",
    );
  });
});

describe("readChangeBriefCaptureTimes", () => {
  it("returns both sides only when stored, parseable, and ordered", () => {
    expect(
      readChangeBriefCaptureTimes({
        beforeCapturedAt: "2026-04-18T09:00:00.000Z",
        capturedAt: "2026-04-19T09:00:00.000Z",
      }),
    ).toEqual({
      beforeCapturedAt: "2026-04-18T09:00:00.000Z",
      nowCapturedAt: "2026-04-19T09:00:00.000Z",
    });
    expect(
      readChangeBriefCaptureTimes({ capturedAt: "2026-04-19T09:00:00.000Z" }),
    ).toBeNull();
    expect(
      readChangeBriefCaptureTimes({
        beforeCapturedAt: "2026-04-19T09:00:00.000Z",
        capturedAt: "2026-04-18T09:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      readChangeBriefCaptureTimes({
        beforeCapturedAt: "not-a-date",
        capturedAt: "2026-04-19T09:00:00.000Z",
      }),
    ).toBeNull();
  });
});

describe("formatChangeBriefTime", () => {
  it("formats in the viewer timezone with a short zone label", () => {
    expect(
      formatChangeBriefTime("2026-04-18T09:12:00.000Z", "UTC"),
    ).toBe("18 Apr 2026, 09:12 UTC");
  });

  it("never fabricates a time for an unparseable value", () => {
    expect(formatChangeBriefTime("garbage", "UTC")).toBe("time unavailable");
  });
});

describe("buildChangeLeadSubject", () => {
  it("leads with competitor, what moved, and the capture time — never a count", () => {
    const subject = buildChangeLeadSubject({
      competitor: "Nike",
      eventType: "landing_page_offer_changed",
      metadata: {
        from: "20% off",
        to: "30% off",
        capturedAt: "2026-04-18T09:12:00.000Z",
      },
      timeZone: "UTC",
    });
    expect(subject).toBe("Nike changed the offer to 30% off — captured 09:12 UTC");
  });

  it("uses the record-level capture fallback when metadata has no timestamp", () => {
    const subject = buildChangeLeadSubject({
      competitor: "Nykaa",
      eventType: "landing_page_url_changed",
      metadata: {},
      timeZone: "UTC",
      capturedAtFallback: "2026-04-19T00:00:00.000Z",
    });
    expect(subject).toBe(
      "Nykaa changed a landing page destination — captured 00:00 UTC",
    );
  });

  it("drops the suffix rather than fabricating a timestamp", () => {
    const subject = buildChangeLeadSubject({
      competitor: "Nike",
      eventType: "ad_new",
      metadata: {},
      timeZone: "UTC",
    });
    expect(subject).toBe("Nike launched a new ad");
  });

  it("strips header-unsafe characters from competitor names and subjects", () => {
    const subject = buildChangeLeadSubject({
      competitor: "Nike\r\nBcc: victim@example.com",
      eventType: "ad_new",
      metadata: {},
    });
    expect(subject).toBe("Nike Bcc: victim@example.com launched a new ad");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(sanitizeEmailSubjectLine(` ${"x".repeat(200)} `)).toHaveLength(142);
  });

  it("falls back to a truthful generic competitor label", () => {
    expect(
      buildChangeLeadSubject({ competitor: "  ", eventType: "ad_new" }),
    ).toBe("A tracked competitor launched a new ad");
  });
});

describe("changeBriefCapturedSuffix", () => {
  it("prefers metadata timestamps over the record fallback", () => {
    expect(
      changeBriefCapturedSuffix(
        { capturedAt: "2026-04-18T09:12:00.000Z" },
        "UTC",
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBe(" — captured 09:12 UTC");
  });
});
