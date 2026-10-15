import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PricingPage } from "../../app/components/pricing-page";
import { ErrorPage } from "../../app/components/error-page";

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the public skip link", () => {
  it("leads the pricing page and targets its one main", () => {
    const html = renderToStaticMarkup(createElement(PricingPage, { source: null }));
    expect(html.indexOf("Skip to content")).toBeLessThan(html.indexOf("<header"));
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('<main id="main-content" tabindex="-1">');
    expect(count(html, "<main")).toBe(1);
  });

  it("is absent from the single-link error page", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorPage, { title: "Not found", detail: "d", actionHref: "/", actionLabel: "Back to home" }),
    );
    expect(html).not.toContain("Skip to content");
    expect(count(html, "<a ")).toBe(1);
  });
});
