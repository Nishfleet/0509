import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Wordmark } from "../app/components/wordmark";

function mark(className?: string): string {
  return renderToStaticMarkup(createElement(Wordmark, className ? { className } : {}));
}

describe("Wordmark", () => {
  it("renders exactly one anchor pointing home", () => {
    const anchors = mark().match(/<a\b/g) ?? [];
    const home = mark().match(/<a\b[^>]*href="\/"/g) ?? [];
    expect(anchors).toHaveLength(1);
    expect(home).toHaveLength(1);
  });

  it("announces 'Five to Nine' to screen readers", () => {
    const html = mark();
    expect(html).toContain('class="sr-only"');
    expect(html.match(/<span class="sr-only">([^<]*)<\/span>/)?.[1]).toBe("Five to Nine");
  });

  it("keeps the visible 05 and 09 inside an aria-hidden span", () => {
    const html = mark();
    const hidden = html.match(/<span aria-hidden="true">([\s\S]*?)<\/span>/)?.[1] ?? "";
    expect(hidden).toContain("05");
    expect(hidden).toContain("09");
  });

  it("gives the anchor a 44px tap target via min-h-11", () => {
    expect(mark()).toContain("min-h-11");
  });

  it("appends the className prop to the anchor's class list", () => {
    expect(mark("extra class")).toContain(" extra class");
    expect(mark("extra class")).toContain("min-h-11");
  });
});
