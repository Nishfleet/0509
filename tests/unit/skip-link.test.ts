import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SkipLink } from "../../app/components/skip-link";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe("skip link and focus contrast (0509#7081)", () => {
  it("targets the one main landmark", () => {
    const html = renderToStaticMarkup(createElement(SkipLink));
    expect(html).toContain('href="#app-content"');
    expect(html).toContain("Skip to content");
  });

  it("never draws the focus ring in green", () => {
    for (const file of ["app/components/ui/button.tsx", "app/components/ui/input.tsx"]) {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      expect(source).toContain("focus-visible:outline-ink");
      expect(source).not.toContain("focus-visible:outline-green");
    }
  });

  it("ships Plex Mono 600 to both face stylesheets", () => {
    for (const file of ["public/app-faces.css", "public/home-faces.css"]) {
      expect(readFileSync(join(REPO_ROOT, file), "utf8")).toContain("/fonts/ibm-plex-mono-latin-600.woff2");
    }
  });

  it("static home has a skip link, a main target, theme-color and soft footer text", () => {
    const html = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");
    expect(html).toContain('href="#app-content"');
    expect(html).toMatch(/<main[^>]*id="app-content"/);
    expect(html.match(/name="theme-color"/g)).toHaveLength(2);
    expect(html).not.toContain("text-ink-faint border-t");
  });
});
