import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/lib/auth.server", () => ({
  hasSessionCookie: () => false,
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { Layout } from "../../app/root";
import Landing from "../../app/routes/landing";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function renderDocument(id: string): string {
  const Stub = createRoutesStub([
    {
      id,
      path: "/",
      Component: () => createElement(Layout, null, createElement(Landing, { loaderData: { ticker: [] } })),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("landing LCP critical path", () => {
  it("paints the headline from the server markup without a module script", () => {
    const html = renderDocument("routes/landing");
    expect(html).toContain("Know where you stand.");
    expect(html).toContain('rel="preload"');
    expect(html).toContain("/fonts/bricolage-hero.woff2");
    expect(html).not.toContain("bricolage-grotesque-latin");
    expect(html).not.toContain("instrument-sans");
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain("modulepreload");
  });

  it("still ships the module script and the body face on every other document", () => {
    const html = renderDocument("routes/login");
    expect(html).toContain("<script");
    expect(html).toContain("/fonts/instrument-sans-latin.woff2");
    expect(html).toContain("/fonts/bricolage-hero.woff2");
  });

  it("keeps the headline face small and the text faces in the one stylesheet", () => {
    const css = readFileSync(join(REPO_ROOT, "app/app.css"), "utf8");
    for (const family of ["Bricolage Grotesque", "Instrument Sans", "IBM Plex Mono"]) {
      expect(css).toContain(`font-family: "${family}"`);
    }
    expect(css).toContain("/fonts/bricolage-hero.woff2");
    expect(css).toContain("/fonts/instrument-sans-latin.woff2");
    expect(css).toContain("/fonts/ibm-plex-mono-latin-400.woff2");
    expect(css).toContain("/fonts/ibm-plex-mono-latin-500.woff2");
    const shipped = readFileSync(join(REPO_ROOT, "public/fonts/bricolage-hero.woff2"));
    expect(shipped.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(shipped.length).toBeLessThan(12_000);
  });
});

describe("static home LCP critical path", () => {
  const html = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");

  it("paints the headline in the brand faces from the one self-hosted font path", () => {
    expect(html).toContain("Quietly, we");
    expect(html).toContain('rel="preload"');
    expect(html).toContain("/fonts/bricolage-hero.woff2");
    expect(html).toContain('fetchpriority="high"');
    expect(html).toContain("/fonts/instrument-sans-latin.woff2");
    expect(html).toContain("/fonts/ibm-plex-mono-latin-400.woff2");
    expect(html).toContain("font-display: swap");
    for (const family of ["Bricolage Grotesque", "Instrument Sans", "IBM Plex Mono"]) {
      expect(html).toContain(`font-family: "${family}"`);
    }
    expect(html).not.toContain("data:font");
    expect(html).not.toContain("bricolage-grotesque-latin");
    expect(html).not.toContain("/*");
    expect(html).not.toContain("ui-sans-serif, system-ui, sans-serif");
    expect(Buffer.byteLength(html)).toBeLessThan(8_000);
  });
});
