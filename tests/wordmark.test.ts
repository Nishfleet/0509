import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Wordmark } from "../app/components/wordmark";

function mark(className?: string): string {
  return renderToStaticMarkup(createElement(Wordmark, className ? { className } : {}));
}

function anchor(html: string): { attrs: string; inner: string } {
  const match = html.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/);
  if (!match) throw new Error(`no anchor in: ${html}`);
  return { attrs: match[1] ?? "", inner: match[2] ?? "" };
}

describe("Wordmark", () => {
  it("renders exactly one anchor and it points home", () => {
    const html = mark();
    const opens = html.match(/<a\b[^>]*>/g) ?? [];
    expect(opens).toHaveLength(1);
    expect(anchor(html).attrs).toContain('href="/"');
  });

  it("keeps the sr-only 'Five to Nine' name and the aria-hidden 05/09 inside the anchor", () => {
    const { inner } = anchor(mark());
    expect(inner).toContain('<span class="sr-only">Five to Nine</span>');
    const hidden = inner.match(/<span aria-hidden="true">([\s\S]*)<\/span>/)?.[1] ?? "";
    expect(hidden).toContain("05");
    expect(hidden).toContain("09");
  });

  it("gives the anchor itself a 44px tap target via min-h-11", () => {
    expect(anchor(mark()).attrs).toContain("min-h-11");
  });

  it("appends the className prop to the anchor's class list", () => {
    const { attrs } = anchor(mark("extra class"));
    expect(attrs).toContain("min-h-11");
    expect(attrs).toContain("extra class");
  });
});
