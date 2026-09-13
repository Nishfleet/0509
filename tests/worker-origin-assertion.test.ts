import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #2986 — the Origin / Sec-Fetch-Site assertion must hold THROUGH the
 * real worker, not just in the helper.
 *
 * State-changing (POST/PUT/DELETE) requests under /app/* and /api/v1/* must
 * carry Sec-Fetch-Site: same-origin|none OR an Origin header matching the
 * request's own scheme+host+port, or the worker answers 403 — and neither
 * case may disturb the anonymous no-header client class (curl / undici /
 * Python-requests calling the documented Bearer-key POST /api/v1/actions),
 * which authenticates by API key and carries no session cookie.
 *
 * This runs the REAL worker fetch handler with the REAL
 * workers/origin-assertion + workers/security-headers. Only the heavy
 * collaborators past the gate are stubbed (the proven doMock set from
 * tests/worker-csp-nonce.test.ts): the 403 direction returns before the rate
 * limiter, and the allowed direction flows through the limiter (self-skipping
 * without D1, proven by the csp/edge suites) into a stubbed render.
 *
 * Both directions of the acceptance:
 *   ALLOW — Sec-Fetch-Site: same-origin|none, a matching Origin, no headers
 *           at all, GET traffic, and the /app + /api/v1 + /api/health
 *           scope boundaries;
 *   403   — cross-site Fetch-Metadata with no/mismatched Origin, mismatched
 *           Origin alone, and same-site-without-Origin (the documented
 *           one-line future widening).
 */

const RENDERED = "rendered-by-test";

async function loadWorker() {
  vi.doMock("react-router", () => ({
    createRequestHandler:
      () => async () =>
        new Response(RENDERED, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
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
    cloudflareRuntimeContext: Symbol("cloudflareRuntimeContext"),
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
  vi.doMock("../app/lib/proof-page-text", () => ({
    parseProofPageTextPathname: () => null,
  }));
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
  return workerModule.default;
}

async function fetchWorker(
  worker: { fetch: unknown },
  path: string,
  headers: Record<string, string> = {},
  method = "POST",
): Promise<Response> {
  return (worker.fetch as (r: Request, e: unknown, c: unknown) => Promise<Response>)(
    new Request(`https://0509.io${path}`, { method, headers }),
    {},
    { waitUntil() {}, passThroughOnException() {} },
  );
}

describe("worker origin / Sec-Fetch-Site assertion (issue #2986)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("403s a cross-site Fetch-Metadata POST with no Origin, on the secured response rail", async () => {
    const worker = await loadWorker();
    const response = await fetchWorker(worker, "/app/notifications", {
      "sec-fetch-site": "cross-site",
    });
    expect(response.status).toBe(403);
    // The 403 rides the same security-headers rail as every other response.
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("origin_check_failed");
  });

  it("403s when only a mismatched Origin is presented", async () => {
    const worker = await loadWorker();
    const response = await fetchWorker(worker, "/app/notifications", {
      origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
  });

  it("403s cross-site Fetch-Metadata with a mismatched Origin under /api/v1/*", async () => {
    const worker = await loadWorker();
    const response = await fetchWorker(
      worker,
      "/api/v1/collections/abc",
      {
        "sec-fetch-site": "cross-site",
        origin: "https://evil.example",
      },
      "PUT",
    );
    expect(response.status).toBe(403);
  });

  it("403s same-site Fetch-Metadata with no Origin (the documented one-line future widening)", async () => {
    const worker = await loadWorker();
    const response = await fetchWorker(worker, "/api/v1/actions", {
      "sec-fetch-site": "same-site",
    });
    expect(response.status).toBe(403);
  });

  it("allows a same-origin Fetch-Metadata POST through to the app", async () => {
    const worker = await loadWorker();
    const response = await fetchWorker(worker, "/app/notifications", {
      "sec-fetch-site": "same-origin",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(RENDERED);
  });

  it("allows Sec-Fetch-Site: none (typed/direct) through to the app", async () => {
    const worker = await loadWorker();
    const response = await fetchWorker(worker, "/app/notifications", {
      "sec-fetch-site": "none",
    });
    expect(response.status).toBe(200);
  });

  it("allows a matching Origin with no Fetch-Metadata through to the app", async () => {
    const worker = await loadWorker();
    const response = await fetchWorker(worker, "/app/notifications", {
      origin: "https://0509.io",
    });
    expect(response.status).toBe(200);
  });

  it("allows the no-header client class (curl/undici Bearer-key caller) through on both surfaces", async () => {
    const worker = await loadWorker();
    expect((await fetchWorker(worker, "/app/notifications")).status).toBe(200);
    expect((await fetchWorker(worker, "/api/v1/actions")).status).toBe(200);
    expect((await fetchWorker(worker, "/api/v1/collections/abc", {}, "DELETE")).status).toBe(200);
  });

  it("allows the bare /app layout action and keeps /apple outside the scope", async () => {
    const worker = await loadWorker();
    expect((await fetchWorker(worker, "/app")).status).toBe(200);
    expect((await fetchWorker(worker, "/apple")).status).toBe(200);
  });

  it("leaves GET traffic and /api/health (outside /app/* and /api/v1/*) ungated", async () => {
    const worker = await loadWorker();
    expect((await fetchWorker(worker, "/app/notifications", {}, "GET")).status).toBe(200);
    expect((await fetchWorker(worker, "/api/health")).status).toBe(200);
  });
});
