import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageHeading } from "../app/components/page-heading";

function render(props: { title: string; lede?: ReactNode }): string {
  return renderToStaticMarkup(createElement(PageHeading, props));
}

const TITLE = "Competitor brief";

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("PageHeading", () => {
  it("puts the only h1 inside a header", () => {
    const html = render({ title: TITLE });
    expect(occurrences(html, "<h1")).toBe(1);
    expect(html).toContain(`<h1 class="`);
    expect(html).toContain(`${TITLE}</h1>`);
    expect(html).toMatch(/^<header class="min-w-0">/);
    expect(html).toMatch(/<\/header>$/);
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<h1"));
    expect(html.indexOf("</h1>")).toBeLessThan(html.indexOf("</header>"));
  });

  it("renders no paragraph when the lede is omitted", () => {
    const html = render({ title: TITLE });
    expect(html).not.toContain("<p");
  });

  it("renders one paragraph with the lede after the h1", () => {
    const html = render({ title: TITLE, lede: "What moved and why." });
    expect(occurrences(html, "<p")).toBe(1);
    expect(html).toContain("What moved and why.</p>");
    expect(html.indexOf("</h1>")).toBeLessThan(html.indexOf("<p"));
    expect(html.indexOf("</p>")).toBeLessThan(html.indexOf("</header>"));
  });

  it("renders a ReactNode lede inside the paragraph", () => {
    const html = render({
      title: TITLE,
      lede: createElement("strong", null, "A move"),
    });
    expect(occurrences(html, "<p")).toBe(1);
    expect(html).toContain("<strong>A move</strong></p>");
  });

  it("escapes a title that carries < or &", () => {
    const html = render({ title: "Rivals <n> & Co" });
    expect(html).toContain("Rivals &lt;n&gt; &amp; Co</h1>");
    expect(html).not.toContain("<n>");
  });
});
