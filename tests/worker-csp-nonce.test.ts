import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #2348 — the nonce-based CSP must hold END TO END, not just in the
 * header-building helper.
 *
 * `tests/worker-security-headers.test.ts` unit-tests `withSecurityHeaders` with
 * a hand-supplied nonce, so it proves the header math but cannot see the
 * wiring: that the worker generates ONE nonce per request and threads the SAME
 * value both into the CSP `script-src 'nonce-…'` directive and into the
 * rendered document (via the cloudflare context → root loader → Layout). That
 * agreement is the whole safety property. If the two halves drift, the failure
 * is silent and total — the CSP authorises a nonce no script carries, so the
 * browser blocks the theme boot script (flash of the wrong theme) and the
 * font-swap script (stylesheet never leaves media="print") with no server error
 * and nothing in the logs.
 *
 * This runs the REAL worker fetch handler and — unlike the content-signal suite
 * — does NOT stub `workers/security-headers`, so the real `generateCspNonce`
 * and the real `withSecurityHeaders` both run. The React Router handler is
 * stubbed only to capture the context the worker hands it (the nonce the
 * document would be rendered with). It asserts:
 *
 *   (a) the nonce the router receives is a real non-empty value,
 *   (b) that exact nonce appears in the response's script-src directive,
 *   (c) script-src carries no 'unsafe-inline' and connect-src no bare `https:`,
 *   (d) a second request gets a DIFFERENT nonce (a reused nonce is as good as
 *       'unsafe-inline' for the second response),
 *   (e) the analytics beacon and both Google Fonts hosts are still allowed, so
 *       the tightening did not silently kill analytics or fonts.
 *
 * (b) is the one assertion no unit test can make: it crosses the worker →
 * router → header boundary in a single request.
 */
async function loadWorker() {
  // The document the stubbed router returns. It reflects the nonce the worker
  // put in the context, exactly as app/root.tsx's Layout does when it stamps
  // `nonce={rootData.cspNonce}` onto the inline scripts.
  let capturedNonce: string | undefined;
  const htmlDocument = () =>
    new Response(
      `<!doctype html><html><head><script nonce="${capturedNonce ?? ""}">/*boot*/</script></head><body>0509</body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );

  vi.doMock("react-router", () => ({
    createRequestHandler: () => async (_request: Request, context: { get: (k: unknown) => unknown }) => {
      // The worker sets `{ env, ctx, country, cspNonce }` on the context.
      const value = context.get(SYMBOL_FOR_TEST) as { cspNonce?: string } | undefined;
      capturedNonce = value?.cspNonce;
      return htmlDocument();
    },
    RouterContextProvider: class RouterContextProvider {
      private readonly store = new Map<unknown, unknown>();
      set(key: unknown, value: unknown) {
        this.store.set(key, value);
      }
      get(key: unknown) {
        return this.store.get(key);
      }
    },
  }));
  vi.doMock("../app/lib/cloudflare-context", () => ({
    cloudflareRuntimeContext: SYMBOL_FOR_TEST,
  }));
  vi.doMock("../app/lib/locale-markets", () => ({ isBuyerSurfaceLocaleId: () => false }));
  vi.doMock("../workers/primary-domain", () => ({ primaryDomainRedirect: () => null }));
  vi.doMock("../app/lib/seo", () => ({ publicSeoFileForPathname: () => null }));
  vi.doMock("../app/lib/public-markdown", () => ({
    PUBLIC_MARKDOWN: "# markdown",
    buildLlmsText: () => "# llms",
    isPublicMarkdownPage: () => false,
    wantsPublicMarkdown: () => false,
  }));
  vi.doMock("../app/lib/sitemap.server", () => ({ publicSitemapForPathname: () => null }));
  vi.doMock("../app/lib/social-cards.server", () => ({ publicSocialCardForRequest: () => null }));
  vi.doMock("../app/lib/creative-thumbnail.server", () => ({
    parseCreativeArtifactPathname: () => null,
    serveCreativeArtifact: async () => null,
  }));
  vi.doMock("../app/lib/proof-screenshot", () => ({ parseProofScreenshotPathname: () => null }));
  vi.doMock("../app/lib/proof-screenshot.server", () => ({ serveProofScreenshot: async () => null }));
  vi.doMock("../app/lib/proof-page-text", () => ({ parseProofPageTextPathname: () => null }));
  vi.doMock("../app/lib/proof-page-text.server", () => ({ serveProofPageText: async () => null }));
  vi.doMock("../app/lib/marketing-page-html.server", () => ({
    marketingPageHtmlForPathname: () => null,
  }));
  vi.doMock("../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class {} }));
  vi.doMock("../workers/delivery-recovery", () => ({
    scheduleBillingLifecycleEmailRecovery: vi.fn(),
  }));
  vi.doMock("../workers/digest-schedule-recovery", () => ({
    scheduleDigestScheduleExhaustionRecovery: vi.fn(),
  }));

  const workerModule = await import("../workers/app");
  return { worker: workerModule.default, capturedNonce: () => capturedNonce };
}

const SYMBOL_FOR_TEST = Symbol("cloudflareRuntimeContext");

function fetchDocument(worker: { fetch: unknown }, path: string) {
  return (
    worker.fetch as (request: Request, env: unknown, ctx: unknown) => Promise<Response>
  )(
    new Request(`https://0509.io${path}`, { headers: { accept: "text/html" } }),
    {},
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function scriptSrcOf(csp: string): string {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("script-src "));
  return directive ?? "";
}

function directiveSourcesOf(csp: string, name: string): string[] {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (directive === undefined || directive === name) return [];
  return directive.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("per-request CSP nonce through the worker fetch handler (issue #2348)", () => {
  it("threads the SAME nonce into the rendered document and the CSP header", async () => {
    const { worker, capturedNonce } = await loadWorker();
    const response = await fetchDocument(worker, "/");

    const nonce = capturedNonce();
    expect(nonce, "the router must receive a nonce from the worker context").toBeTruthy();
    expect(typeof nonce).toBe("string");
    expect(nonce).not.toBe("");

    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp, "CSP header must be present on the document response").not.toBe("");
    // The load-bearing assertion: the nonce the document was rendered with is
    // the nonce the header authorises. Two separate values would block every
    // inline script while looking perfectly correct in each test alone.
    expect(scriptSrcOf(csp)).toContain(`'nonce-${nonce}'`);

    // ...and the body the browser receives carries that same nonce.
    const html = await response.text();
    expect(html).toContain(`nonce="${nonce}"`);
  });

  it("sends no 'unsafe-inline' in script-src and no bare https: in connect-src", async () => {
    const { worker } = await loadWorker();
    const response = await fetchDocument(worker, "/");
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(scriptSrcOf(csp)).not.toContain("'unsafe-inline'");
    // The bare scheme token specifically — a full URL such as
    // https://fonts.gstatic.com is a legitimate source and must not match.
    expect(directiveSourcesOf(csp, "connect-src")).not.toContain("https:");
  });

  it("issues a fresh nonce per request rather than reusing one", async () => {
    const { worker, capturedNonce } = await loadWorker();

    // Two requests through the SAME loaded worker: the nonce must be generated
    // per fetch, not once at module load. (Re-importing the module would test
    // module initialisation instead of the per-request path.)
    const firstResponse = await fetchDocument(worker, "/");
    const firstNonce = capturedNonce();
    const secondResponse = await fetchDocument(worker, "/");
    const secondNonce = capturedNonce();

    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    // A nonce reused across responses is guessable from a previous response and
    // hands an injected script a valid token — equivalent to 'unsafe-inline'.
    expect(secondNonce).not.toBe(firstNonce);

    // Each response's header must authorise the nonce its own document got.
    const firstCsp = firstResponse.headers.get("content-security-policy") ?? "";
    const secondCsp = secondResponse.headers.get("content-security-policy") ?? "";
    expect(scriptSrcOf(firstCsp)).toContain(`'nonce-${firstNonce}'`);
    expect(scriptSrcOf(secondCsp)).toContain(`'nonce-${secondNonce}'`);
    expect(scriptSrcOf(firstCsp)).not.toContain(`'nonce-${secondNonce}'`);
  });

  it("still allows the analytics beacon and both Google Fonts hosts", async () => {
    const { worker } = await loadWorker();
    const response = await fetchDocument(worker, "/");
    const csp = response.headers.get("content-security-policy") ?? "";

    // The tightening must not silently kill either dependency: the beacon is
    // edge-injected (analytics records zero with no error), and fonts need both
    // style-src (stylesheet) and font-src (font files).
    expect(scriptSrcOf(csp)).toContain("https://static.cloudflareinsights.com/beacon.min.js");
    expect(directiveSourcesOf(csp, "style-src")).toContain("https://fonts.googleapis.com");
    expect(directiveSourcesOf(csp, "font-src")).toContain("https://fonts.gstatic.com");
  });
});
