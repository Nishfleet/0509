import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EvidencePlate,
  MISSING_CAPTURE_TIME_LABEL,
  UNREADABLE_CAPTURE_COPY,
  formatPlateNumber,
} from "~/components/evidence/evidence-plate";

/** BL-005 — brief §6.9: numbered, stamped, quotable evidence plates. */

describe("EvidencePlate", () => {
  it("numbers the plate so the prose can reference it", () => {
    expect(formatPlateNumber(1)).toBe("01");
    expect(formatPlateNumber(12)).toBe("12");

    const markup = renderToStaticMarkup(
      <EvidencePlate
        number={3}
        title="OFFER PAGE"
        verification="VERIFIED"
        capturedAt="2026-07-27T06:05:00.000Z"
        captureLines={["₹1,199 — launch price", "Start free · no card"]}
        facts={[
          { key: "What changed", value: "Price" },
          { key: "First seen", value: "26 Jul 2026" },
        ]}
        footnote="Captured from the live offer page; stored copy, not a re-render."
      />,
    );

    expect(markup).toContain("PLATE 03 — OFFER PAGE · VERIFIED");
    expect(markup).toContain("27 Jul 2026, 06:05 UTC");
    expect(markup).toContain("₹1,199 — launch price");
    expect(markup).toContain("stored copy, not a re-render");
  });

  it("says the capture time is not recorded rather than printing a plausible one", () => {
    const markup = renderToStaticMarkup(
      <EvidencePlate
        number={1}
        title="AD CREATIVE"
        capturedAt={null}
        captureLines={["Headline copy"]}
        facts={[{ key: "Source", value: "Meta Ad Library" }]}
      />,
    );

    expect(markup).toContain(MISSING_CAPTURE_TIME_LABEL);
    expect(markup).not.toContain("Invalid Date");
  });

  it("degrades an unreadable capture to one muted sentence inside the frame", () => {
    const markup = renderToStaticMarkup(
      <EvidencePlate
        number={2}
        title="LANDING PAGE"
        capturedAt="2026-07-27T06:05:00.000Z"
        captureLines={["", "   "]}
        facts={[{ key: "Price", value: null, missingLabel: "not published" }]}
      />,
    );

    expect(markup).toContain(UNREADABLE_CAPTURE_COPY);
    expect(markup).toContain("f9-ed-mock-frame");
    expect(markup).toContain("not published");
    expect(markup).toContain("is-missing");
  });

  it("labels sample data inline, adjacent to the plate itself (brief §8.3)", () => {
    const markup = renderToStaticMarkup(
      <EvidencePlate
        number={1}
        title="OFFER PAGE"
        verification="DEMO DATA — SAMPLE RESULTS"
        capturedAt="2026-07-27T06:05:00.000Z"
        captureLines={["Sample offer"]}
        facts={[{ key: "Source", value: "Sample" }]}
      />,
    );

    expect(markup).toContain("DEMO DATA — SAMPLE RESULTS");
  });
});
