import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SecondaryAction } from "~/components/evidence/cta";
import {
  DIFF_PLATE_DEGRADE_COPY,
  DiffPlate,
  STORED_CAPTURE_NOTE,
  hasCaptureTime,
} from "~/components/evidence/diff-plate";

/** BL-005 — brief §6.5 and §8.2: two timestamps or no diff. */

const base = {
  headline: "They cut the price",
  why: "Their entry offer is now under yours for the first time this quarter.",
  field: "OFFER PAGE",
  caughtLabel: "CAUGHT 27 JUL · 06:05 UTC",
  verification: "VERIFIED · 2 CAPTURES",
};

describe("DiffPlate", () => {
  it("stamps both panes with their own capture time", () => {
    const markup = renderToStaticMarkup(
      <DiffPlate
        {...base}
        before={{ capturedAt: "2026-07-26T04:00:00.000Z", value: "₹1,499" }}
        now={{ capturedAt: "2026-07-27T06:05:00.000Z", value: "₹1,199" }}
      />,
    );

    expect(markup).toContain("26 Jul 2026, 04:00 UTC");
    expect(markup).toContain("27 Jul 2026, 06:05 UTC");
    expect(markup).toContain("Before");
    expect(markup).toContain("Now");
    expect(markup).toContain("<s>₹1,499</s>");
    expect(markup).toContain("<mark>₹1,199</mark>");
    expect(markup).toContain(STORED_CAPTURE_NOTE);
  });

  it("degrades to a quiet line when a capture time is missing", () => {
    const markup = renderToStaticMarkup(
      <DiffPlate
        {...base}
        before={{ capturedAt: null, value: "₹1,499" }}
        now={{ capturedAt: "2026-07-27T06:05:00.000Z", value: "₹1,199" }}
      />,
    );

    expect(markup).toContain("f9-evidence-quiet-line");
    expect(markup).toContain(DIFF_PLATE_DEGRADE_COPY);
    expect(markup).not.toContain("f9-evidence-diff-panes");
    expect(markup).not.toContain("<s>");
  });

  it("degrades on an unparseable capture time rather than printing it", () => {
    const markup = renderToStaticMarkup(
      <DiffPlate
        {...base}
        before={{ capturedAt: "yesterday-ish", value: "₹1,499" }}
        now={{ capturedAt: "2026-07-27T06:05:00.000Z", value: "₹1,199" }}
      />,
    );

    expect(markup).toContain("f9-evidence-quiet-line");
    expect(markup).not.toContain("yesterday-ish");
  });

  it("keeps further changed fields inside the same plate's now pane", () => {
    const markup = renderToStaticMarkup(
      <DiffPlate
        {...base}
        before={{ capturedAt: "2026-07-26T04:00:00.000Z", value: "₹1,499" }}
        now={{ capturedAt: "2026-07-27T06:05:00.000Z", value: "₹1,199" }}
        extraChanges={[
          { key: "CTA", value: "Book a demo → Start free" },
          { key: "Headline", value: "Rewritten" },
        ]}
        actions={<SecondaryAction type="button">Open the capture</SecondaryAction>}
      />,
    );

    expect(markup.match(/f9-evidence-diff-plate/g)).toHaveLength(1);
    expect(markup).toContain("CTA: Book a demo → Start free");
    expect(markup).toContain("f9-evidence-cta--rank2");
    expect(markup).not.toContain("f9-evidence-cta--rank1");
  });

  it("labels the stored capture rather than implying a live re-render", () => {
    const markup = renderToStaticMarkup(
      <DiffPlate
        {...base}
        before={{
          capturedAt: "2026-07-26T04:00:00.000Z",
          value: "₹1,499",
          quote: "Launch price, ends Friday",
          note: "capture 4f2a · offer page",
        }}
        now={{ capturedAt: "2026-07-27T06:05:00.000Z", value: "₹1,199" }}
      />,
    );

    expect(markup).toContain("Launch price, ends Friday");
    expect(markup).toContain("capture 4f2a · offer page");
    expect(markup).toContain(STORED_CAPTURE_NOTE);
  });

  it("validates capture times exactly the way the plate gate does", () => {
    expect(hasCaptureTime("2026-07-27T06:05:00.000Z")).toBe(true);
    expect(hasCaptureTime(null)).toBe(false);
    expect(hasCaptureTime("")).toBe(false);
    expect(hasCaptureTime("soon")).toBe(false);
  });

  it("renders the stored screenshot pair side by side inside both panes", () => {
    const markup = renderToStaticMarkup(
      <DiffPlate
        {...base}
        before={{
          capturedAt: "2026-07-26T04:00:00.000Z",
          value: "₹1,499",
          imageUrl: "/artifacts/proof/before.jpeg",
        }}
        now={{
          capturedAt: "2026-07-27T06:05:00.000Z",
          value: "₹1,199",
          imageUrl: "/artifacts/proof/now.jpeg",
        }}
      />,
    );

    expect(markup).toContain('src="/artifacts/proof/before.jpeg"');
    expect(markup).toContain('src="/artifacts/proof/now.jpeg"');
    expect(markup).toContain("The page before the change, as captured");
    expect(markup).toContain("The page after the change, as captured");
    expect(markup).toContain("f9-evidence-diff-shot");
  });

  it("renders no screenshot when a capture has none on file", () => {
    const markup = renderToStaticMarkup(
      <DiffPlate
        {...base}
        before={{ capturedAt: "2026-07-26T04:00:00.000Z", value: "₹1,499" }}
        now={{ capturedAt: "2026-07-27T06:05:00.000Z", value: "₹1,199" }}
      />,
    );

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("f9-evidence-diff-shot");
  });
});

describe("DiffPlate visual diff (BL-053)", () => {
  it("renders the stored screenshot pair side by side inside both panes", () => {
    const markup = renderToStaticMarkup(
      <DiffPlate
        {...base}
        before={{
          capturedAt: "2026-07-26T04:00:00.000Z",
          value: "₹1,499",
          imageUrl: "/artifacts/proof/before.jpeg",
        }}
        now={{
          capturedAt: "2026-07-27T06:05:00.000Z",
          value: "₹1,199",
          imageUrl: "/artifacts/proof/now.jpeg",
        }}
      />,
    );

    expect(markup).toContain('src="/artifacts/proof/before.jpeg"');
    expect(markup).toContain('src="/artifacts/proof/now.jpeg"');
    expect(markup).toContain("The page before the change, as captured");
    expect(markup).toContain("The page after the change, as captured");
    expect(markup).toContain("f9-evidence-diff-shot");
  });

  it("renders no screenshot when a capture has none on file", () => {
    const markup = renderToStaticMarkup(
      <DiffPlate
        {...base}
        before={{ capturedAt: "2026-07-26T04:00:00.000Z", value: "₹1,499" }}
        now={{ capturedAt: "2026-07-27T06:05:00.000Z", value: "₹1,199" }}
      />,
    );

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("f9-evidence-diff-shot");
  });
});
