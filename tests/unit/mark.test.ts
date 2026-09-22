import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { contrastRatio, Mark, markGrounds, markSizes, type MarkProps, type MarkSize } from "../../app/components/mark";

const sourceUrl = "https://example.com/pricing";
const capturedAt = "2026-09-22T06:02:00.000Z";

function mark(props: Partial<MarkProps> & { size: MarkSize }): string {
  const element: ReactElement | null = createElement(Mark, {
    before: "20% off annual",
    after: "30% off annual",
    sourceUrl,
    capturedAt,
    ...props,
  });
  return renderToStaticMarkup(element);
}

describe("the mark", () => {
  it("draws four sizes from s and ins, each with its source and captured-at time", () => {
    for (const size of markSizes) {
      const html = mark({ size });
      expect(html).toContain(`data-size="${size}"`);
      expect(html).toContain("<s");
      expect(html).toContain("<ins");
      expect(html).toContain("20% off annual");
      expect(html).toContain("30% off annual");
      expect(html).toContain(`href="${sourceUrl}"`);
      expect(html).toContain("color:inherit");
      expect(html).toContain(`dateTime="${capturedAt}"`);
      expect(html).toContain(capturedAt);
      expect(html.toLowerCase()).not.toContain("legend");
      expect(html).not.toContain("ink-faint");
      expect(html).not.toContain("#8e8878");
      expect(html).not.toContain("#7b7568");
    }
  });

  it("drives lg, md and sm from the mark size tokens and --ink-soft", () => {
    expect(mark({ size: "lg" })).toContain("var(--mark-lg,");
    expect(mark({ size: "md" })).toContain("var(--mark-md,");
    expect(mark({ size: "sm" })).toContain("var(--mark-sm,");
    for (const size of ["lg", "md", "sm"] as const) {
      const html = mark({ size });
      expect(html).toContain("var(--ink-soft,");
      expect(html).toContain("var(--red,");
      expect(html).toContain("var(--green,");
      expect(html).not.toContain("font-size:22px");
    }
  });

  it("inlines the email size on the light bone ground", () => {
    const html = mark({ size: "email" });
    expect(html).toContain("font-size:22px");
    expect(html).toContain(markGrounds.light.inkSoft);
    expect(html).toContain(markGrounds.light.bone);
    expect(html).toContain(markGrounds.light.red);
    expect(html).toContain(markGrounds.light.green);
    expect(html).toContain(markGrounds.light.onGreen);
    expect(html).not.toContain("var(--");
  });

  it("still renders when the screenshot is missing", () => {
    for (const screenshotUrl of [undefined, "", "   ", "javascript:alert(1)"]) {
      const html = mark({ size: "md", screenshotUrl });
      expect(html).toContain("screenshot unavailable");
      expect(html).toContain("<s");
      expect(html).toContain(sourceUrl);
      expect(html).not.toContain("<img");
    }
  });

  it("shows a capture when a screenshot URL is present", () => {
    const html = mark({ size: "sm", screenshotUrl: "https://cdn.example.com/shot.png" });
    expect(html).toContain('src="https://cdn.example.com/shot.png"');
    expect(html).not.toContain("screenshot unavailable");
  });

  it("is never shown without a source URL and a captured-at time", () => {
    expect(mark({ size: "lg", sourceUrl: "" })).toBe("");
    expect(mark({ size: "lg", sourceUrl: "   " })).toBe("");
    expect(mark({ size: "lg", sourceUrl: "javascript:alert(1)" })).toBe("");
    expect(mark({ size: "lg", sourceUrl: "not a url" })).toBe("");
    expect(mark({ size: "lg", capturedAt: "" })).toBe("");
    expect(mark({ size: "lg", capturedAt: "yesterday" })).toBe("");
    expect(mark({ size: "lg", before: "  " })).toBe("");
    expect(mark({ size: "lg", after: "" })).toBe("");
  });

  it("keeps the struck text at or above 3:1 on both grounds", () => {
    const light = contrastRatio(markGrounds.light.inkSoft, markGrounds.light.bone);
    const dark = contrastRatio(markGrounds.dark.inkSoft, markGrounds.dark.bone);
    expect(light).toBeCloseTo(6.91, 2);
    expect(dark).toBeCloseTo(7.33, 2);
    expect(light).toBeGreaterThanOrEqual(3);
    expect(dark).toBeGreaterThanOrEqual(3);
    expect(markGrounds.light.inkSoft).toBe("#55524a");
    expect(markGrounds.dark.inkSoft).toBe("#a9a294");
    expect(markGrounds.light.bone).toBe("#f4f1e8");
    expect(markGrounds.dark.bone).toBe("#14130f");
  });
});
