import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LegalPage } from "../../app/components/legal-page";
import { PRIVACY } from "../../app/lib/legal/privacy";

// 0509#6532: the on-this-page links on /privacy and /terms were one text line
// (~15px) tall, under the 44px minimum in DESIGN.md:473. This renders the real
// page and measures the nav's own anchors, so a future edit that drops the
// class is red here rather than only on a phone.
describe("the legal page on-this-page list", () => {
  const html = renderToStaticMarkup(createElement(LegalPage, { doc: PRIVACY }));
  const nav = html.match(/<nav aria-label="On this page"[\s\S]*?<\/nav>/)?.[0] ?? "";

  it("gives every on-this-page link a 44px-tall tap target", () => {
    const links = nav.match(/<a\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(PRIVACY.sections.length + 1);
    for (const link of links) expect(link).toContain("min-h-11");
  });

  it("drops the row gap so the taller targets do not add spacing", () => {
    const list = nav.match(/<ol\b[^>]*>/)?.[0] ?? "";
    expect(list).toContain("gap-y-0");
    expect(list).not.toContain("gap-y-2");
  });
});
