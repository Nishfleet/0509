import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Monogram } from "../../app/components/monogram";

function render(name: string, flags: { self?: boolean; off?: boolean } = {}): string {
  return renderToStaticMarkup(createElement(Monogram, { name, ...flags }));
}

function classOf(html: string): string {
  return /<span\b[^>]*\bclass="([^"]*)"/.exec(html)?.[1] ?? "";
}

describe("the monogram", () => {
  it("uses the card surface and the ink border by default", () => {
    const css = classOf(render("gymshark"));

    expect(css).toContain("bg-card");
    expect(css).toContain("border-ink");
    expect(css).not.toContain("bg-green");
  });

  it("fills the span with green for the workspace's own brand", () => {
    const css = classOf(render("gymshark", { self: true }));

    expect(css).toContain("bg-green");
    expect(css).not.toContain("bg-card");
  });

  it("switches to the line border for a brand that is off", () => {
    const css = classOf(render("gymshark", { off: true }));

    expect(css).toContain("border-line");
    expect(css).not.toContain("border-ink");
  });
});
