import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "../app/components/ui/badge";

const SPAN = /<span\b[^>]*>/;

function render(props: Parameters<typeof Badge>[0] = {}, children = "New"): string {
  return renderToStaticMarkup(createElement(Badge, props, children));
}

function spanOf(html: string): string {
  return html.match(SPAN)?.[0] ?? "";
}

function classesOf(html: string): string[] {
  return (spanOf(html).match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
}

describe("Badge", () => {
  it("renders a span carrying the badge slot, the default variant and the children", () => {
    const html = render();
    expect(html.startsWith("<span")).toBe(true);
    expect(spanOf(html)).toContain('data-slot="badge"');
    expect(spanOf(html)).toContain('data-variant="default"');
    expect(html).toContain(">New</span>");
  });

  it("marks the destructive variant and gives it the destructive text class", () => {
    const html = render({ variant: "destructive" }, "Live");
    expect(spanOf(html)).toContain('data-variant="destructive"');
    expect(classesOf(html)).toContain("text-destructive");
  });

  it("keeps a passed className next to the base classes", () => {
    const classes = classesOf(render({ className: "mt-2" }));
    expect(classes).toContain("mt-2");
    expect(classes).toContain("inline-flex");
    expect(classes).toContain("bg-primary");
  });

  it("passes an id through to the element", () => {
    expect(spanOf(render({ id: "row-1" }))).toContain('id="row-1"');
  });
});
