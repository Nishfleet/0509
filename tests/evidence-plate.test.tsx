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
    expect(markup).toContain("f9-evidence-mock-frame");
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

  /**
   * BL-009 additions. The report's reading column needs each plate to state
   * its finding as a real heading (R4 numbered sections) and to carry the
   * stored capture itself, not only its transcript — dropping a capture we
   * hold would break brief §8.1.
   */
  it("states the finding as a heading at the level the surrounding document needs", () => {
    const markup = renderToStaticMarkup(
      <EvidencePlate
        capturedAt="2026-07-27T06:05:00.000Z"
        facts={[{ key: "What changed", value: "Price" }]}
        headingLevel={2}
        headline="Okara cut its team price"
        number={1}
        title="OFFER PAGE"
        why="The anchor price moved down before the weekend."
      />,
    );

    expect(markup).toContain('<h2 class="f9-evidence-headline">Okara cut its team price</h2>');
    expect(markup).toContain("The anchor price moved down before the weekend.");
  });

  it("renders without a headline or a why when there is no finding to state", () => {
    const markup = renderToStaticMarkup(
      <EvidencePlate
        capturedAt="2026-07-27T06:05:00.000Z"
        captureLines={["Headline copy"]}
        facts={[{ key: "Source", value: "Meta Ad Library" }]}
        number={1}
        title="AD CREATIVE"
      />,
    );

    expect(markup).not.toContain("f9-evidence-headline");
    expect(markup).not.toContain("f9-evidence-why");
  });

  it("keeps a stored capture in the frame and does not call it unreadable", () => {
    const markup = renderToStaticMarkup(
      <EvidencePlate
        capture={<img alt="stored capture" src="https://cdn.example.com/creative.png" />}
        capturedAt="2026-07-27T06:05:00.000Z"
        captureLines={[]}
        facts={[{ key: "Source", value: "Meta Ad Library" }]}
        number={4}
        title="AD CREATIVE"
      />,
    );

    expect(markup).toContain('src="https://cdn.example.com/creative.png"');
    // We hold a capture, so the honest-degrade sentence must NOT fire.
    expect(markup).not.toContain(UNREADABLE_CAPTURE_COPY);
  });
});
