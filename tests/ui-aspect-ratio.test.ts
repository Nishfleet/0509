import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AspectRatio } from "../app/components/ui/aspect-ratio";

function render(props: { ratio: number; className?: string }, children?: ReactNode): string {
  return renderToStaticMarkup(createElement(AspectRatio, props, children));
}

function classAttr(html: string): string | null {
  const match = html.match(/class="([^"]*)"/);
  return match ? match[1] : null;
}

describe("AspectRatio (ui/aspect-ratio.tsx)", () => {
  it("exposes the ratio as a --ratio custom property on data-slot=aspect-ratio", () => {
    const html = render({ ratio: 1.6 });

    expect(html).toContain('data-slot="aspect-ratio"');
    expect(html).toContain("--ratio:1.6");
  });

  it("keeps the full precision of a 1440-wide 16:9 division", () => {
    const html = render({ ratio: 1440 / 810 });

    expect(html).toContain("--ratio:1.7777777777777777");
  });

  it("renders the relative base class and keeps a passed className next to it", () => {
    const html = render({ ratio: 1.6, className: "extra" });

    const cls = classAttr(html);
    expect(cls).not.toBeNull();
    expect(cls).toContain("relative");
    expect(cls).toContain("aspect-(--ratio)");
    expect(cls).toContain("extra");
  });

  it("renders children inside the div", () => {
    const html = render({ ratio: 1.6, className: "extra" }, "child");

    expect(html).toContain(">child</div>");
    expect(html).toMatch(/<\/div>\s*$/);
  });
});
