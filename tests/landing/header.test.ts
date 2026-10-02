import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Header } from "../../app/components/landing/header";

function markup(): string {
  return renderToStaticMarkup(createElement(Header));
}

describe("landing header", () => {
  it("gives each section link and the sign-in link a 44px-tall tap target", () => {
    const html = markup();
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    const links = nav.match(/<a\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(5);
    for (const link of links) expect(link).toContain("min-h-11");
    expect(html.match(/<a\b[^>]*href="\/login"[^>]*>/)?.[0]).toContain("min-h-11");
  });
});
