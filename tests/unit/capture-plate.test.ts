import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CapturePlate,
  shotSrc,
  type CapturePlateProps,
} from "../../app/components/capture-plate";

function render(props: CapturePlateProps): string {
  return renderToStaticMarkup(createElement(CapturePlate, props));
}

describe("shotSrc", () => {
  it("appends the width as a query parameter", () => {
    expect(shotSrc("/a.png", 208)).toBe("/a.png?w=208");
    expect(shotSrc("/a?k=1", 76)).toBe("/a?k=1&w=76");
  });
});

describe("the capture plate", () => {
  it("renders the after shot at 104×74 and shrinks to 76×56 on a phone", () => {
    const html = render({
      label: "Pricing page",
      before: { src: "/before.png", capturedAt: "2026-09-20" },
      after: { src: "/after.png", capturedAt: "2026-09-21" },
    });
    expect(html).toContain('width="104"');
    expect(html).toContain('height="74"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('src="/after.png?w=208"');
    expect(html).toContain("max-[859px]:w-[76px]");
    expect(html).toContain("max-[859px]:h-[56px]");
    expect(html).toContain('aria-label="Open before and after: Pricing page"');
  });

  it("reads the first plate eagerly with high fetch priority", () => {
    const html = render({
      label: "Homepage",
      before: { src: "/before.png", capturedAt: "2026-09-20" },
      after: { src: "/after.png", capturedAt: "2026-09-21" },
      eager: true,
    });
    expect(html).toContain('loading="eager"');
    expect(html.toLowerCase()).toContain("fetchpriority");
  });

  it("renders a reason instead of a broken image when the capture is missing", () => {
    const html = render({
      label: "Pricing page",
      before: { missing: "Capture failed: timeout" },
      after: { missing: "Capture failed: timeout" },
    });
    expect(html).toContain('data-slot="capture-missing"');
    expect(html).toContain("Capture failed: timeout");
    expect(html).not.toContain("<img");
  });
});
