import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Footer, SupportLink } from "../../app/components/footer";

describe("Footer", () => {
  it("gives each footer link a 44px-tall tap target", () => {
    const html = renderToStaticMarkup(createElement(Footer, { status: true }));
    const links = html.match(/<a\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(7);
    for (const link of links) expect(link).toContain("min-h-11");
  });

  it("leaves the Status link out unless the page asks for it", () => {
    const html = renderToStaticMarkup(createElement(Footer));
    expect(html).not.toContain('href="/status"');
    expect(html.match(/<a\b[^>]*>/g)).toHaveLength(6);
  });

  it("asks for the Status link only on pages a visitor behind the Access wall can already reach", () => {
    const roots = ["app/routes", "app/components"];
    const users = roots.flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".tsx"))
        .map((file) => join(root, file))
        .filter((file) => /<Footer\b[^>]*\bstatus\b/.test(readFileSync(file, "utf8"))),
    );
    expect(users.sort()).toEqual(["app/components/status-page.tsx", "app/routes/app.settings.tsx"]);
  });

  it("leaves the support link inline when it sits in a sentence", () => {
    const html = renderToStaticMarkup(createElement(SupportLink));
    expect(html).not.toContain("min-h-11");
  });
});
