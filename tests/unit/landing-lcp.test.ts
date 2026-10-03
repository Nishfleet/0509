import { createHash } from "node:crypto";
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

import { FACES_SCRIPT } from "../../app/lib/faces-script";
import { contentSecurityPolicy } from "../../app/lib/security-headers";
import { Layout } from "../../app/root";
import Landing from "../../app/routes/landing";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function renderDocument(id: string): string {
  const Stub = createRoutesStub([
    {
      id,
      path: "/",
      Component: () =>
        createElement(
          Layout,
          null,
          createElement(Landing, {
            loaderData: {
              ticker: [],
              marks: [],
              sources: [],
              claims: { nouns: "website changes", features: [] },
              now: 0,
            },
          }),
        ),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("landing LCP critical path", () => {
  it("paints the headline from the server markup without a module script", () => {
    const html = renderDocument("routes/landing");
    expect(html).toContain("Know where you stand.");
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain("modulepreload");
  });

  it.each(["routes/landing", "routes/privacy", "routes/terms"])(
    "keeps every web font out of the first paint on %s and loads the faces after the load event",
    (id) => {
      const html = renderDocument(id);
      expect(html).not.toContain('rel="preload"');
      expect(html).not.toContain("/fonts/");
      expect(html).not.toContain("app-faces.css");
      expect(html).not.toContain('type="module"');
      expect(html).not.toContain("modulepreload");
      expect(html).toContain(`<script>${FACES_SCRIPT}</script>`);
    },
  );

  it("shares one faces script with the static home", () => {
    const home = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");
    expect(home).toContain(`<script>${FACES_SCRIPT}</script>`);
  });

  it("pins the shared faces script by hash in the document CSP", () => {
    const digest = createHash("sha256").update(FACES_SCRIPT).digest("base64");
    expect(contentSecurityPolicy("abc")).toContain(`'sha256-${digest}'`);
  });

  it("still ships the module script, the faces stylesheet and the preloads on every other document", () => {
    const html = renderDocument("routes/login");
    expect(html).toContain("<script");
    expect(html).toContain('<link rel="stylesheet" href="/app-faces.css"/>');
    expect(html).toContain("/fonts/instrument-sans-latin.woff2");
    expect(html).toContain("/fonts/bricolage-hero.woff2");
  });

  it("keeps the headline face small, the app faces off the shared stylesheet and the fallbacks metric-matched", () => {
    const css = readFileSync(join(REPO_ROOT, "app/app.css"), "utf8");
    expect(css).not.toContain('font-family: "Bricolage Grotesque"');
    expect(css).not.toContain("/fonts/");
    for (const fallback of ["Bricolage Fallback", "Instrument Fallback", "Plex Mono Fallback"]) {
      expect(css).toContain(`font-family: "${fallback}"`);
      expect(css).toContain(`"${fallback}"`);
    }
    expect(css.match(/size-adjust:/g)).toHaveLength(3);
    expect(css.match(/ascent-override:/g)).toHaveLength(3);
    const faces = readFileSync(join(REPO_ROOT, "public/app-faces.css"), "utf8");
    for (const family of ["Bricolage Grotesque", "Instrument Sans", "IBM Plex Mono"]) {
      expect(faces).toContain(`font-family: "${family}"`);
    }
    expect(faces).toContain("/fonts/bricolage-hero.woff2");
    expect(faces).toContain("/fonts/instrument-sans-latin.woff2");
    expect(faces).toContain("/fonts/ibm-plex-mono-latin-400.woff2");
    expect(faces).toContain("/fonts/ibm-plex-mono-latin-500.woff2");
    const shipped = readFileSync(join(REPO_ROOT, "public/fonts/bricolage-hero.woff2"));
    expect(shipped.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(shipped.length).toBeLessThan(12_000);
  });
});

describe("static home LCP critical path", () => {
  const html = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");
  const faces = readFileSync(join(REPO_ROOT, "public/home-faces.css"), "utf8");

  it("paints the headline before the brand faces are requested", () => {
    expect(html).toContain("Quietly, we");
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("/fonts/");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script src");
    const scriptAt = html.indexOf("<script>");
    expect(scriptAt).toBeGreaterThan(html.lastIndexOf("</main>"));
    const script = html.slice(scriptAt, html.indexOf("</script>", scriptAt));
    expect(script).toContain('addEventListener("load"');
    expect(script).toContain('faces.href = "/home-faces.css"');
    // load alone races first paint: the faces must also wait for the
    // first-contentful-paint entry or they land on the LCP path (0509#6432).
    expect(script).toContain("first-contentful-paint");
    expect(faces).toContain("/fonts/bricolage-hero.woff2");
    expect(faces).toContain("/fonts/instrument-sans-latin.woff2");
    expect(faces).toContain("/fonts/ibm-plex-mono-latin-400.woff2");
    expect(faces).toContain("font-display: swap");
    for (const family of ["Bricolage Grotesque", "Instrument Sans", "IBM Plex Mono"]) {
      expect(html).toContain(`"${family}"`);
      expect(faces).toContain(`font-family: "${family}"`);
    }
    expect(html).not.toContain("data:font");
    expect(faces).not.toContain("data:font");
    expect(html).not.toContain("bricolage-grotesque-latin");
    expect(faces).not.toContain("bricolage-grotesque-latin");
    expect(html).not.toContain("/*");
    expect(html).not.toContain("ui-sans-serif, system-ui, sans-serif");
    expect(Buffer.byteLength(html)).toBeLessThan(8_000);
  });
});
