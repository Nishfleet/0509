import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Mark, markSizes, type MarkProps, type MarkSize } from "../../app/components/mark";

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

  it("inlines the email size on the light bone ground the app ships", () => {
    const html = mark({ size: "email" });
    const { light } = shippedGrounds();
    expect(html).toContain("font-size:22px");
    expect(html).toContain(light.inkSoft);
    expect(html).toContain(light.bone);
    expect(html).toContain("#e0442c");
    expect(html).toContain("#16c47f");
    expect(html).toContain("#0e0d0a");
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
    expect(html).toContain(`alt="Capture, ${capturedAt}"`);
    expect(html).not.toContain("screenshot unavailable");
    expect(mark({ size: "sm", screenshotUrl: "/captures/shot.png" })).toContain('src="/captures/shot.png"');
    expect(mark({ size: "email", screenshotUrl: "/captures/shot.png" })).toContain("screenshot unavailable");
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

  it("keeps the struck text at or above 3:1 on both grounds the app ships", () => {
    const { light, dark } = shippedGrounds();
    const lightRatio = contrastRatio(light.inkSoft, light.bone);
    const darkRatio = contrastRatio(dark.inkSoft, dark.bone);
    expect(lightRatio).toBeCloseTo(6.91, 2);
    expect(darkRatio).toBeCloseTo(7.33, 2);
    expect(lightRatio).toBeGreaterThanOrEqual(3);
    expect(darkRatio).toBeGreaterThanOrEqual(3);
    for (const size of ["lg", "md", "sm"] as const) {
      const html = mark({ size });
      expect(html).toContain("var(--ink-soft, var(--color-ink-soft))");
      expect(html).not.toContain(light.inkSoft);
      expect(html).not.toContain(dark.inkSoft);
    }
  });
});

function shippedGrounds(): {
  light: { inkSoft: string; bone: string };
  dark: { inkSoft: string; bone: string };
} {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../app/app.css"), "utf8");
  // #3984 moved the shipped values onto the canonical DESIGN.md §4 names
  // (--ink-soft, --bone); --color-* are Tailwind aliases of them. Read the
  // canonical declaration so this measures the colour the app really serves,
  // not an alias that could drift.
  const ink = [...css.matchAll(/(?:^|[^-])--ink-soft:\s*(#[0-9a-fA-F]{6})/gm)].map((match) => match[1] ?? "");
  const bone = [...css.matchAll(/(?:^|[^-])--bone:\s*(#[0-9a-fA-F]{6})/gm)].map((match) => match[1] ?? "");
  expect(ink).toEqual(["#55524a", "#a9a294", "#a9a294"]);
  expect(bone).toEqual(["#f4f1e8", "#14130f", "#14130f"]);
  return {
    light: { inkSoft: ink[0] ?? "", bone: bone[0] ?? "" },
    dark: { inkSoft: ink[1] ?? "", bone: bone[1] ?? "" },
  };
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  const digits = match?.[1];
  if (digits === undefined) throw new Error(`bad hex ${hex}`);
  const value = Number.parseInt(digits, 16);
  const channel = (shift: number) => {
    const srgb = ((value >> shift) & 255) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}
