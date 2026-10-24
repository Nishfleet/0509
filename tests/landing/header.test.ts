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
    expect(links).toHaveLength(6);
    for (const link of links) {
      expect(link).toContain("min-h-11");
      expect(link).toContain("flex");
      expect(link).toContain("items-center");
    }
    expect(/<a\b[^>]*href="\/login"[^>]*>/.exec(html)?.[0]).toContain("min-h-11");
  });

  it("shows Sign in and no Open app by default", () => {
    const html = markup();
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Open app");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('href="/app"');
  });

  it("swaps Sign in for an Open app link to /app only when the visitor is signed in", () => {
    const html = renderToStaticMarkup(createElement(Header, { signedIn: true }));
    expect(html).toContain("Open app");
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain('href="/login"');
    const link = /<a\b[^>]*href="\/app"[^>]*>/.exec(html)?.[0];
    expect(link).toContain("min-h-11");
    expect(renderToStaticMarkup(createElement(Header, { signedIn: false }))).toBe(markup());
  });
});
