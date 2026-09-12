import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #2302 — the Content-Signal AI-use reservation travels with the public
 * HTML documents it protects, not only with the markdown responses.
 *
 * `markdownResponse` already stamped
 * `content-signal: search=yes, ai-input=yes, ai-train=no, use=reference` on
 * /llms.txt, /llms-full.txt, and the public markdown pages, but the HTML pages
 * a grounding crawler actually lands on carried no such header — the
 * reservation lived only in robots.txt, which page-scraping grounding bots do
 * not re-read per page (workers/app.ts).
 *
 * This runs the REAL worker fetch handler (`workers/app.ts` default export)
 * with the React Router handler stubbed to return a document, so the assertion
 * covers the public-route branch itself — not just the header helper. The
 * private modules the worker imports for cron/backfill work are stubbed because
 * this test only exercises the request path.
 */
async function loadWorker() {
  const htmlDocument = () =>
    new Response("<!doctype html><html><body>0509</body></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  vi.doMock("react-router", () => ({
    createRequestHandler: () => async () => htmlDocument(),
    RouterContextProvider: class RouterContextProvider {
      set() {}
    },
  }));
  vi.doMock("../app/lib/cloudflare-context", () => ({
    cloudflareRuntimeContext: Symbol("cloudflareRuntimeContext"),
  }));
  vi.doMock("../app/lib/locale-markets", () => ({
    isBuyerSurfaceLocaleId: () => false,
  }));
  vi.doMock("../workers/primary-domain", () => ({
    primaryDomainRedirect: () => null,
  }));
  vi.doMock("../app/lib/seo", () => ({
    publicSeoFileForPathname: () => null,
  }));
  vi.doMock("../app/lib/public-markdown", () => ({
    PUBLIC_MARKDOWN: "# markdown",
    buildLlmsText: () => "# llms",
    isPublicMarkdownPage: () => false,
    wantsPublicMarkdown: () => false,
  }));
  vi.doMock("../app/lib/sitemap.server", () => ({
    SITEMAP_TIMELINE_READ_LIMIT: 50,
    loadIndexableBrandPageEntries: async () => [],
    loadIndexableTimelineEntries: async () => [],
    publicLocaleSitemapFile: async () => ({ body: "", contentType: "application/xml", cacheControl: "public" }),
    publicSitemapFile: async () => ({ body: "", contentType: "application/xml", cacheControl: "public" }),
    timelineSitemapEntries: () => [],
  }));
  vi.doMock("../app/lib/llms-full.server", () => ({
    buildLlmsFullText: () => "# llms-full",
    loadLlmsFullBrandBlocks: async () => [],
  }));
  vi.doMock("../app/lib/rate-limit.server", () => ({
    enforceRequestRateLimit: async () => null,
  }));
  vi.doMock("../app/lib/cron-failure-alert.server", () => ({
    reportScheduledTaskFailure: vi.fn(),
  }));
  vi.doMock("../app/lib/demo-brand-backfill.server", () => ({
    runDemoBrandBackfill: vi.fn(),
    runDemoBrandProofHoleCatchUp: vi.fn(),
    summarizeDemoBrandBackfill: vi.fn(),
  }));
  vi.doMock("../app/lib/sneaker-resale-backfill.server", () => ({
    runSneakerResaleBackfill: vi.fn(),
    summarizeSneakerResaleBackfill: vi.fn(),
  }));
  vi.doMock("../app/lib/sitemap-timeline-backfill.server", () => ({
    runSitemapTimelineBackfill: vi.fn(),
    summarizeSitemapTimelineBackfill: vi.fn(),
  }));
  vi.doMock("../app/lib/digest-orchestration.server", () => ({
    resumePendingDigestScheduleJobsDetailed: vi.fn(),
  }));
  vi.doMock("../app/lib/ads-domain-publisher.server", () => ({
    runAdsDomainPublisher: vi.fn(),
  }));
  vi.doMock("../app/lib/monitoring.server", () => ({
    flushDeferredInstantAlerts: vi.fn(),
    runScheduledDiscoveryWarmup: vi.fn(),
    runScheduledMonitoring: vi.fn(),
    sendWeeklyBusinessNumbers: vi.fn(),
  }));
  vi.doMock("../app/lib/monthly-recap.server", () => ({
    sendMonthlyCustomerRecaps: vi.fn(),
  }));
  vi.doMock("../app/lib/onboarding-nudge.server", () => ({
    runOnboardingNudgeSweep: vi.fn(),
    runWatchlistResumeSweep: vi.fn(),
  }));
  vi.doMock("../app/lib/release-scheduled-observation.server", () => ({
    observeScheduledTask: vi.fn(),
  }));
  vi.doMock("../app/lib/retention.server", () => ({ runRetentionSweep: vi.fn() }));
  vi.doMock("../app/lib/scheduled-observation-health.server", () => ({
    SCHEDULED_OBSERVATION_GAP_CHECK_CRON: "13 * * * *",
    sendScheduledObservationGapAlert: vi.fn(),
  }));
  vi.doMock("../workers/delivery-recovery", () => ({
    scheduleBillingLifecycleEmailRecovery: vi.fn(),
  }));
  vi.doMock("../workers/digest-schedule-recovery", () => ({
    scheduleDigestScheduleExhaustionRecovery: vi.fn(),
  }));
  vi.doMock("../workers/monitoring-workflow", () => ({
    MonitoringWorkflow: class MonitoringWorkflow {},
  }));
  // Spread the real module: this suite stubs the two header FUNCTIONS, but
  // the edge cache (issue #2950) imports the policy DATA (the cacheable path
  // lists) from the same module — a wholesale replacement would hand it
  // undefined sets and break every lookup.
  vi.doMock("../workers/security-headers", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    withSecurityHeaders: vi.fn((response: Response) => response),
    generateCspNonce: vi.fn(() => "test-nonce-abc"),
  }));
  vi.doMock("../app/lib/social-cards.server", () => ({
    publicSocialCardForRequest: () => null,
  }));
  vi.doMock("../app/lib/creative-thumbnail.server", () => ({
    parseCreativeArtifactPathname: () => null,
    serveCreativeArtifact: async () => null,
  }));
  vi.doMock("../app/lib/proof-screenshot", () => ({
    parseProofScreenshotPathname: () => null,
  }));
  vi.doMock("../app/lib/proof-screenshot.server", () => ({
    serveProofScreenshot: async () => null,
  }));
  vi.doMock("../app/lib/proof-page-text", () => ({
    parseProofPageTextPathname: () => null,
  }));
  vi.doMock("../app/lib/proof-page-text.server", () => ({
    serveProofPageText: async () => null,
  }));

  const workerModule = await import("../workers/app");
  return workerModule;
}

function fetchDocument(worker: { fetch: unknown }, path: string, headers: Record<string, string> = {}) {
  return (
    worker.fetch as (
      request: Request,
      env: unknown,
      ctx: unknown,
    ) => Promise<Response>
  )(new Request(`https://0509.io${path}`, { headers }), {}, { waitUntil() {}, passThroughOnException() {} });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("public HTML content-signal through the worker fetch handler (issue #2302)", () => {
  it("sends content-signal on the public home page document", async () => {
    const { default: worker, CONTENT_SIGNAL } = await loadWorker();
    const response = await fetchDocument(worker, "/");

    expect(response.headers.get("content-signal")).toBe(CONTENT_SIGNAL);
  });

  it("sends content-signal on public deep pages", async () => {
    const { default: worker, CONTENT_SIGNAL } = await loadWorker();
    for (const path of ["/pricing", "/ads/nike.com", "/compare/visualping"]) {
      const response = await fetchDocument(worker, path);
      expect(response.headers.get("content-signal"), path).toBe(CONTENT_SIGNAL);
    }
  });

  it("leaves the authed route without content-signal", async () => {
    const { default: worker } = await loadWorker();
    const response = await fetchDocument(worker, "/app");

    expect(response.headers.has("content-signal")).toBe(false);
  });

  it("leaves a signed-in request on a public path without content-signal", async () => {
    const { default: worker } = await loadWorker();
    const response = await fetchDocument(worker, "/", {
      cookie: "better-auth.session_token=session-123",
    });

    expect(response.headers.has("content-signal")).toBe(false);
  });
});
