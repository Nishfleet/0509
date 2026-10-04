import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExampleMark } from "../app/components/landing/example-mark";

const BEFORE = "Plans from $10.";
const AFTER = "Plans from $12.";

function render(before: string, after: string, className = ""): string {
  return renderToStaticMarkup(createElement(ExampleMark, { before, after, className }));
}

function marked(html: string, tag: "s" | "ins"): string {
  return html.match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`))?.[0] ?? "";
}

function srOnlyText(markup: string): string {
  return markup.match(/<span class="sr-only">([\s\S]*?)<\/span>/)?.[1] ?? "";
}

describe("ExampleMark", () => {
  it("strikes the before text and labels it Before for screen readers", () => {
    const struck = marked(render(BEFORE, AFTER), "s");
    expect(struck).toContain(BEFORE);
    expect(srOnlyText(struck)).toBe("Before: ");
  });

  it("marks the after text as inserted and labels it Now for screen readers", () => {
    const inserted = marked(render(BEFORE, AFTER), "ins");
    expect(inserted).toContain(AFTER);
    expect(srOnlyText(inserted)).toBe("Now: ");
  });

  it("writes the struck before text ahead of the inserted after text", () => {
    const html = render(BEFORE, AFTER);
    expect(html).toContain("<s");
    expect(html.indexOf("<s")).toBeLessThan(html.indexOf("<ins"));
  });

  it("hides the arrow from assistive technology", () => {
    const html = render(BEFORE, AFTER);
    const arrow = html.match(/<span\b[^>]*aria-hidden="true"[^>]*>([\s\S]*?)<\/span>/);
    expect(arrow?.[1]).toBe("→");
  });

  it("lands the className on the wrapping paragraph", () => {
    const paragraph = render(BEFORE, AFTER, "mt-3 text-mark-md").match(/<p\b[^>]*>/)?.[0] ?? "";
    expect(paragraph).toContain("mt-3");
    expect(paragraph).toContain("text-mark-md");
  });

  it("escapes a before string that holds an angle bracket", () => {
    const html = render("Plans < $10.", AFTER);
    expect(html).toContain("Plans &lt; $10.");
    expect(html).not.toContain("< $10");
  });
});
