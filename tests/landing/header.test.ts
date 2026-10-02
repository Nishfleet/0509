import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Header } from "../../app/components/landing/header";

function markup(): string {
  return renderToStaticMarkup(createElement(Header));
}

// `min-h-11` is the unit of 44px in this repo (tests/unit/onboarding-competitors.test.ts).
// A gate that looks only for that token passes if the display that makes the box
// real is dropped, so each link's whole mechanism is asserted.
describe("landing header", () => {
  it("gives each section link and the sign-in link a 44px-tall tap target", () => {
    const html = markup();
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    const links = nav.match(/<a\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(5);
    for (const link of links) {
      expect(link).toContain("min-h-11");
      expect(link).toContain("flex");
      expect(link).toContain("items-center");
    }
    expect(html.match(/<a\b[^>]*href="\/login"[^>]*>/)?.[0]).toContain("min-h-11");
  });
});
