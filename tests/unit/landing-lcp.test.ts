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

function renderedText(html: string, tag: string): string {
  const open = html.indexOf(`<${tag}`);
  if (open < 0) throw new Error(`missing <${tag}`);
  const start = html.indexOf(">", open) + 1;
  const end = html.indexOf(`</${tag}>`, start);
  if (end < 0) throw new Error(`missing </${tag}>`);
  const decoded = html
    .slice(start, end)
    .replace(/<[^>]+>/g, "")
    .replaceAll("&rsquo;", "\u2019")
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", "\u00a0");
  if (decoded.includes("&")) throw new Error(`undecoded entity in ${tag}`);
  return decoded.replace(/\s+/g, " ").trim();
}

function faceRange(style: string, family: string): Set<number> {
  const marker = `font-family: "${family}"`;
  const start = style.indexOf(marker);
  if (start < 0) throw new Error(`missing face ${family}`);
  const block = style.slice(start, style.indexOf("}", start));
  const range = block.slice(block.indexOf("unicode-range:"));
  const covered = new Set<number>();
  for (const token of range.matchAll(/U\+([0-9A-Fa-f]{1,6})(?:-([0-9A-Fa-f]{1,6}))?/g)) {
    if (token[1] === undefined) throw new Error(`bad unicode-range token in ${family}`);
    const from = Number.parseInt(token[1], 16);
    const to = token[2] === undefined ? from : Number.parseInt(token[2], 16);
    if (Number.isNaN(from) || Number.isNaN(to)) throw new Error(`bad unicode-range token in ${family}`);
    for (let code = from; code <= to; code += 1) covered.add(code);
  }
  return covered;
}

function uncovered(text: string, range: Set<number>): string {
  let missing = "";
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) throw new Error("empty character");
    if (!range.has(code)) missing += char;
  }
  return missing;
}

describe("static home LCP critical path", () => {
  const html = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");
  const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

  it("paints the headline from the preloaded hero face and the body from the brand faces", () => {
    expect(html).toContain("Quietly, we");
    expect(html).toContain('rel="preload"');
    expect(html).toContain("/fonts/bricolage-hero.woff2");
    expect(html).toContain('fetchpriority="high"');
    expect(style).toContain('font-family: "Bricolage Grotesque"');
    expect(style).toContain('font-family: "Instrument Sans"');
    expect(style).toContain('font-family: "IBM Plex Mono"');
    expect(style).toContain("font-display: swap");
    expect(html).toContain('--font-sans: "Instrument Sans"');
    expect(html).toContain('--font-mono: "IBM Plex Mono"');
    expect(html).toContain("/fonts/instrument-sans-home.woff2");
    expect(html).toContain("/fonts/ibm-plex-mono-home.woff2");
    expect(html).not.toContain("instrument-sans-latin");
    expect(html).not.toContain("ibm-plex-mono-latin");
    expect(html).not.toContain("<script");
    expect(uncovered(renderedText(html, "h1"), faceRange(style, "Bricolage Grotesque"))).toBe("");
    expect(uncovered(renderedText(html, "p"), faceRange(style, "Instrument Sans"))).toBe("");
    expect(uncovered(renderedText(html, "footer"), faceRange(style, "IBM Plex Mono"))).toBe("");
    for (const file of ["instrument-sans-home.woff2", "ibm-plex-mono-home.woff2"]) {
      const shipped = readFileSync(join(REPO_ROOT, "public/fonts", file));
      expect(shipped.subarray(0, 4).toString("ascii")).toBe("wOF2");
      expect(shipped.length).toBeGreaterThan(1_000);
      expect(shipped.length).toBeLessThan(8_000);
    }
    expect(html).not.toContain("data:font");
    expect(html).not.toContain("bricolage-grotesque-latin");
    expect(html).not.toContain("/*");
    expect(html).not.toContain("ui-sans-serif, system-ui, sans-serif");
    expect(Buffer.byteLength(html)).toBeLessThan(8_000);
  });
});
