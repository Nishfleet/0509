import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Footer, SupportLink } from "../../app/components/footer";

describe("Footer", () => {
  it("gives each footer link a 44px-tall tap target", () => {
    const html = renderToStaticMarkup(createElement(Footer));
    const links = html.match(/<a\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(7);
    for (const link of links) expect(link).toContain("min-h-11");
  });

  it("links Status and Security on every page", () => {
    const html = renderToStaticMarkup(createElement(Footer));
    expect(html).toContain('href="/status"');
    expect(html).toContain('href="/security"');
  });

  it("leaves the support link inline when it sits in a sentence", () => {
    const html = renderToStaticMarkup(createElement(SupportLink));
    expect(html).not.toContain("min-h-11");
  });
});
