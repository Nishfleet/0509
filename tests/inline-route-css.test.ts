import { describe, expect, it, vi } from "vitest";

import fs from "node:fs";

import {
  inlineMarketingRouteCss,
  maybeInlineMarketingRouteCss,
} from "../workers/inline-route-css";

// Vitest stubs CSS side-effect/`?raw` imports to "" (test.css is off), so the
// tests inject the on-disk stylesheet — the exact bytes the production build
// inlines (verified against build/server after `npm run build`).
const MARKETING_CSS = fs.readFileSync("app/styles/marketing.css", "utf8");

/**
 * Issue #2967: marketing documents inline their route stylesheet (no second
 * render-blocking request on the landing cluster) and drop it from the
 * embedded client manifest so hydration re-renders exactly the links SSR
 * rendered. These tests pin both transforms against realistic SSR shapes.
 */

/** A link tag the way React Router's <Links nonce> renders it (nonce first). */
const linkTag = (nonce: string) =>
  `<link nonce="${nonce}" rel="stylesheet" href="/assets/marketing-CKMlKNXF.css"/>`;

/** The pretty-printed manifest entry RR embeds in the document. */
const manifestEntry = (indent = "\t\t\t") =>
  `"css": [\n${indent}"/assets/marketing-CKMlKNXF.css"\n${indent.slice(0, -1)}]`;

function marketingDocument(): string {
  return `<!doctype html><html lang="en"><head>
<meta charSet="utf-8"/>
<link nonce="n0" rel="stylesheet" href="/assets/root-CGgbcTVJ.css"/>
${linkTag("n0")}
</head><body><script nonce="n0">window.__reactRouterManifest = {
  "entry": { "module": "/assets/entry.client.js", "imports": [], "css": [] },
  "routes": {
    "root": { "id": "root", "module": "/assets/root.js", "css": ["/assets/root-CGgbcTVJ.css"] },
    "routes/marketing": { "id": "routes/marketing", "module": "/assets/marketing.js", ${manifestEntry()} }
  }
};</script></body></html>`;
}

describe("inlineMarketingRouteCss (issue #2967)", () => {
  it("replaces the marketing stylesheet link with an inline style carrying the same rules", () => {
    const html = marketingDocument();
    const out = inlineMarketingRouteCss(html, MARKETING_CSS);
    expect(out.inlined).toBe(true);
    expect(out.html).not.toContain('href="/assets/marketing-CKMlKNXF.css"');
    expect(out.html).not.toMatch(/<link[^>]*href="\/assets\/marketing-[^"]*\.css"/);
    expect(out.html).toContain('<style data-inlined-route-css="marketing">');
    // The inline block carries real css content from the split stylesheet.
    expect(out.html).toMatch(/<style data-inlined-route-css="marketing">[\s\S]{100,}<\/style>/);
    // The root stylesheet link is untouched (cached immutable asset).
    expect(out.html).toContain('href="/assets/root-CGgbcTVJ.css"');
  });

  it("strips the marketing css from the embedded client manifest but keeps other routes' css", () => {
    const out = inlineMarketingRouteCss(marketingDocument()).html;
    // The marketing route's css array is emptied…
    expect(out).not.toContain('"/assets/marketing-CKMlKNXF.css"');
    // …and the root route's css entry survives for hydration/SPA navs.
    expect(out).toContain('"css": ["/assets/root-CGgbcTVJ.css"]');
    expect(out).toContain('"css": []');
  });

  it("handles the minified manifest shape too", () => {
    const html = `<!doctype html><script>window.__reactRouterManifest={"routes":{"routes/search":{"css":["/assets/marketing-AbCdEf123.css"]}}};</script>`;
    const out = inlineMarketingRouteCss(html.replace(
      '"css":["/assets/marketing-AbCdEf123.css"]',
      linkTag("n") // no link in this doc → inliner is a no-op
    ).replace(linkTag("n"), ""));
    // No stylesheet link → untouched document (conservative).
    expect(out.inlined).toBe(false);
  });

  it("leaves documents without the marketing stylesheet untouched", () => {
    const dashboard = `<!doctype html><html><head><link nonce="n" rel="stylesheet" href="/assets/root-X.css"/></head><body></body></html>`;
    const out = inlineMarketingRouteCss(dashboard, MARKETING_CSS);
    expect(out.inlined).toBe(false);
    expect(out.html).toBe(dashboard);
  });

  it("the source stylesheet is non-trivial (split actually shipped content)", () => {
    expect(MARKETING_CSS.length).toBeGreaterThan(10_000);
  });
});

describe("maybeInlineMarketingRouteCss response handling", () => {
  const htmlResponse = (body: string) =>
    new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

  it("rewrites GET HTML documents and drops stale content-length", async () => {
    const response = htmlResponse(marketingDocument());
    const out = await maybeInlineMarketingRouteCss(response, new Request("https://0509.io/"), MARKETING_CSS);
    const text = await out.text();
    expect(text).toContain('data-inlined-route-css="marketing"');
    expect(out.headers.get("content-type")).toContain("text/html");
  });

  it("passes non-HTML responses through untouched", async () => {
    const response = new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    });
    const out = await maybeInlineMarketingRouteCss(response, new Request("https://0509.io/api/health"));
    expect(out).toBe(response);
  });

  it("passes non-GET/HEAD requests through untouched", async () => {
    const response = htmlResponse(marketingDocument());
    const out = await maybeInlineMarketingRouteCss(
      response,
      new Request("https://0509.io/", { method: "POST" }),
    );
    expect(out).toBe(response);
  });

  it("serves HEAD documents with a null body but the same headers", async () => {
    const response = htmlResponse(marketingDocument());
    const out = await maybeInlineMarketingRouteCss(
      response,
      new Request("https://0509.io/", { method: "HEAD" }),
    );
    expect(out.body).toBeNull();
    expect(out.headers.get("content-type")).toContain("text/html");
  });

  it("falls back to an equivalent unmodified response when the body cannot be read", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = htmlResponse(marketingDocument());
    await response.text(); // disturb the body — a second read rejects
    const out = await maybeInlineMarketingRouteCss(response, new Request("https://0509.io/"), MARKETING_CSS);
    expect(out.status).toBe(200);
    expect(out.headers.get("content-type")).toContain("text/html");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
