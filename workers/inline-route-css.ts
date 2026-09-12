/**
 * Inline the marketing route stylesheet into marketing HTML documents
 * (issue #2967, "inline the critical route, lazy-load the rest").
 *
 * After the marketing-only CSS was split out of the root bundle
 * (app/styles/marketing.css), every marketing document made a second
 * render-blocking stylesheet request for it. On a cold edge that is a full
 * extra round trip before first paint on the SEO-critical surfaces (/, the
 * /ads/:domain landing cluster, the public content pages). This module
 * removes that request on the server:
 *
 *   1. the `<link rel="stylesheet" href="/assets/marketing-*.css">` tag is
 *      replaced with an inline `<style>` carrying the same rules, so the
 *      browser has everything it needs in the document itself;
 *   2. the same file is dropped from the embedded client route manifest, so
 *      hydration re-renders exactly the links SSR rendered and never
 *      re-requests the inlined sheet. Client-side navigation stays correct:
 *      the inline <style> persists across SPA navigations out of a marketing
 *      page, and documents that did NOT inline it (dashboard, auth screens
 *      reached directly) still carry the stylesheet link in their manifest.
 *
 * The dashboard keeps its normal `<link>` (cached immutable asset) — only
 * marketing documents pay the inline bytes. `style-src 'unsafe-inline'` is
 * already part of the response CSP (workers/security-headers.ts), so the
 * inline block renders under the existing policy.
 *
 * Any failure falls back to the untouched HTML: inlining is an optimization,
 * never a correctness gate.
 */

import marketingCssSource from "../app/styles/marketing.css?raw";

/** Built asset name for the marketing route stylesheet (hashed by vite). */
const MARKETING_CSS_HREF = /\/assets\/marketing-[A-Za-z0-9_-]+\.css/;

/**
 * The SSR-rendered stylesheet link for the marketing css. React renders the
 * nonce attribute first (`<link nonce="…" rel="stylesheet" href="…"/>`), so
 * the href is matched anywhere inside the tag and the whole tag replaced.
 */
const MARKETING_CSS_LINK = new RegExp(
  `<link[^>]*href="${MARKETING_CSS_HREF.source}"[^>]*/?>`,
);

/**
 * The manifest entry for a route whose css array contains ONLY the marketing
 * stylesheet. Single-element arrays only: if a route ever carries additional
 * stylesheets alongside it, the conservative move is to leave the manifest
 * untouched (the hydration link re-fetch will hit the browser cache).
 * The href source is already regex-escaped; interpolated verbatim — the
 * manifest stores the href as a plain JSON string.
 */
const MARKETING_CSS_MANIFEST_ENTRY = new RegExp(
  `"css":\\s*\\[\\s*"${MARKETING_CSS_HREF.source}"\\s*\\]`,
  "g",
);

export type InlineRouteCssResult = {
  html: string;
  inlined: boolean;
};

/**
 * Replace the marketing stylesheet link with an inline style block and strip
 * it from the embedded client manifest. Returns the input unchanged when the
 * document does not load the marketing stylesheet (dashboard documents, API
 * responses) or when the expected shapes are not found.
 *
 * `cssSource` defaults to the build-inlined stylesheet (vite `?raw`). Vitest
 * stubs CSS imports to the empty string (test.css is off), so tests inject
 * the on-disk file to exercise the identical logic.
 */
export function inlineMarketingRouteCss(
  html: string,
  cssSource: string = marketingCssSource,
): InlineRouteCssResult {
  const linkMatch = MARKETING_CSS_LINK.exec(html);
  if (!linkMatch) return { html, inlined: false };

  const styleBlock = `<style data-inlined-route-css="marketing">${cssSource}</style>`;
  const stripped = html.replace(MARKETING_CSS_LINK, styleBlock);
  const out = stripped.replace(MARKETING_CSS_MANIFEST_ENTRY, '"css": []');

  return { html: out, inlined: out !== html };
}

export const MARKETING_CSS_SOURCE_BYTES = marketingCssSource.length;

/**
 * Response-level entry point for the worker fetch path. Applies the inline
 * transform to GET/HEAD HTML documents only and rebuilds the Response from the
 * (already fully rendered — entry.server awaits `allReady`) body. Never
 * throws: any failure logs and returns an equivalent unmodified response so
 * the document path cannot regress on an optimization.
 */
export async function maybeInlineMarketingRouteCss(
  response: Response,
  request: Request,
  cssSource: string = marketingCssSource,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;
  try {
    const html = await response.text();
    const { html: out, inlined } = inlineMarketingRouteCss(html, cssSource);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(request.method === "HEAD" ? null : out, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error("marketing css inline failed; serving unmodified document", error);
    return response;
  }
}
