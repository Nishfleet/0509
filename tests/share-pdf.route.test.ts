import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromiseTimeoutError } from "~/lib/fetch-timeout.server";
import { createApprovedReportSnapshot } from "~/lib/report-approval";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const PDF_TEST_REPORT = {
  kind: "report" as const,
  reportId: "watchlist:watch-1",
  resourceType: "watchlist" as const,
  resourceId: "watch-1",
  title: "Competitor Report — Q3!",
  subtitle: "Current evidence",
  summary: "One verified event.",
  generatedAt: "2026-07-15T00:00:00.000Z",
  stats: [],
  insightDepth: {
    topHooks: [], mediaMix: [], campaignDurations: [], metricProof: [],
    creativeTimeline: [], landingPageHistory: [],
  },
  sourceCoverage: {
    totalInput: 1, included: 1, excluded: 0, note: "Verified.",
    proofMix: { verifiedProof: 1, scanSpotted: 0, needsReview: 0, proofPending: 0, proofFailed: 0, excluded: 0, unknown: 0 },
    excludedCounts: {},
  },
  rows: [{
    id: "row-1", advertiser: "Competitor", previewHeadline: "Offer", offer: null, cta: null,
    formatLabel: "Image", languageLabel: null, previewImageUrl: null, creativeText: null,
    translatedText: null, landingPage: { url: null, headline: null, captureLabel: null, capturedAt: null, signals: [] },
    analysisFields: [], tags: [], note: null,
    event: {
      typeLabel: "Offer", title: "Offer changed", summary: "Verified event.", createdAt: "2026-07-15T00:00:00.000Z",
      priorityScore: 50, priorityBand: "medium", recommendedAction: "Review", proofTrail: "Saved evidence",
      proofStatusLabel: "Verified evidence", sourceTypeLabel: "Saved evidence", sourceUrl: null, metaAdId: null,
    },
  }],
};

const AGENCY_SHARE = {
  id: "share-1",
  token: "token-1",
  userId: "sharer-1",
  resourceType: "report" as const,
  resourceId: "watchlist:watch-1",
  isSnapshot: true,
  snapshotPayload: createApprovedReportSnapshot(PDF_TEST_REPORT),
  createdAt: "2026-07-01T00:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
};

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    APP_ORIGIN: "https://0509.io",
    BROWSER: { fetch: vi.fn() },
    DB: {},
    ...overrides,
  } as never;
}

function makePuppeteerMocks(options: {
  pdf?: () => Promise<unknown>;
  goto?: () => Promise<unknown>;
  limits?: { allowedBrowserAcquisitions: number; timeUntilNextAllowedBrowserAcquisition: number };
  limitsError?: unknown;
  limitsHook?: () => void;
  launchError?: unknown;
} = {}) {
  const page = {
    goto: vi.fn(async (..._args: unknown[]) => (options.goto ? options.goto() : undefined)),
    waitForSelector: vi.fn(async (..._args: unknown[]) => undefined),
    pdf: vi.fn(options.pdf ?? (async () => new Uint8Array([37, 80, 68, 70]))),
  };
  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  const launch = vi.fn(async () => {
    if (options.launchError !== undefined) {
      throw options.launchError;
    }
    return browser;
  });
  const limits = vi.fn(async () => {
    if (options.limitsError !== undefined) {
      throw options.limitsError;
    }
    options.limitsHook?.();
    return options.limits ?? {
      allowedBrowserAcquisitions: 3,
      timeUntilNextAllowedBrowserAcquisition: 0,
    };
  });

  vi.doMock("@cloudflare/puppeteer", () => ({
    default: { launch, limits },
  }));

  return { page, browser, launch, limits };
}

function mockCollaborators(input: {
  share?: Record<string, unknown> | null;
  plan?: string;
  ipLimit?: Response | null;
  dailyLimit?: Response | null;
  singleFlightLimited?: Response | null;
}) {
  const enforceSharePdfRateLimit = vi.fn(async () => input.ipLimit ?? null);
  const enforceSharePdfDailyCap = vi.fn(async () => input.dailyLimit ?? null);
  const claimSharePdfSingleFlight = vi.fn(async () => input.singleFlightLimited ?? null);
  const share = input.share === undefined ? AGENCY_SHARE : input.share;
  const getShareLink = vi.fn(async () => share);
  const getUserPlan = vi.fn(async () => input.plan ?? "agency");
  const installPublicBrowserRequestGuard = vi.fn(async () => undefined);

  vi.doMock("~/lib/rate-limit.server", () => ({
    enforceSharePdfRateLimit,
    enforceSharePdfDailyCap,
    claimSharePdfSingleFlight,
  }));
  vi.doMock("~/lib/data.server", () => ({ getShareLink }));
  vi.doMock("~/lib/plan.server", () => ({ getUserPlan }));
  vi.doMock("~/lib/browser-run.server", () => ({ installPublicBrowserRequestGuard }));

  return {
    enforceSharePdfRateLimit,
    enforceSharePdfDailyCap,
    getShareLink,
    getUserPlan,
    installPublicBrowserRequestGuard,
  };
}

async function runPdfRequest(env = makeEnv(), token = "token-1") {
  const { renderShareReportPdfResponse } = await import("~/lib/report-pdf.server");
  return renderShareReportPdfResponse(
    env,
    new Request(`https://0509.io/share/${token}/pdf`),
    token,
  );
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@cloudflare/puppeteer");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/browser-run.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/report-pdf.server");
});

describe("GET /share/:token/pdf", () => {
  it("is registered as a resource route", () => {
    const routeConfig = readFileSync("app/routes.ts", "utf8");
    expect(routeConfig).toContain('route("share/:token/pdf", "routes/share.$token.pdf.ts")');
  });

  it("returns 404 for unknown, expired, or revoked tokens", async () => {
    mockCollaborators({ share: null });
    const { launch } = makePuppeteerMocks();

    const response = await runPdfRequest();

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("refuses live (non-snapshot) shares with an honest error", async () => {
    mockCollaborators({ share: { ...AGENCY_SHARE, isSnapshot: false, snapshotPayload: null } });
    const { launch } = makePuppeteerMocks();

    const response = await runPdfRequest();

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "pdf_unavailable" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("refuses non-report snapshots", async () => {
    mockCollaborators({ share: { ...AGENCY_SHARE, resourceType: "digest" as never } });
    makePuppeteerMocks();

    const response = await runPdfRequest();

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "pdf_unavailable" });
  });

  it("gates on the sharer's pdf_reports entitlement without leaking the plan", async () => {
    for (const plan of ["free", "scout", "starter"]) {
      vi.resetModules();
      const mocks = mockCollaborators({ plan });
      const { launch } = makePuppeteerMocks();

      const response = await runPdfRequest();

      expect(response.status).toBe(403);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ error: "plan_gated" });
      expect(JSON.stringify(body)).not.toContain(plan);
      expect(mocks.getUserPlan).toHaveBeenCalledWith(expect.anything(), "sharer-1");
      expect(launch).not.toHaveBeenCalled();
    }
  });

  it("returns the per-IP rate limit response before touching the token", async () => {
    const limited = new Response("{}", { status: 429 });
    const mocks = mockCollaborators({ ipLimit: limited });
    makePuppeteerMocks();

    const response = await runPdfRequest();

    expect(response.status).toBe(429);
    expect(mocks.getShareLink).not.toHaveBeenCalled();
  });

  it("enforces the per-sharer daily cap keyed by the sharer's user id", async () => {
    const limited = new Response("{}", { status: 429 });
    const mocks = mockCollaborators({ dailyLimit: limited });
    const { launch } = makePuppeteerMocks();

    const response = await runPdfRequest();

    expect(response.status).toBe(429);
    expect(mocks.enforceSharePdfDailyCap).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "sharer-1",
      undefined,
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it("returns 503 with Retry-After when browser capacity is exhausted", async () => {
    const mocks = mockCollaborators({});
    const { launch } = makePuppeteerMocks({
      limits: { allowedBrowserAcquisitions: 0, timeUntilNextAllowedBrowserAcquisition: 12_000 },
    });

    const response = await runPdfRequest();

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(await response.json()).toMatchObject({ error: "capacity_exhausted" });
    expect(mocks.enforceSharePdfDailyCap).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("fails closed when browser capacity preflight is rejected", async () => {
    const mocks = mockCollaborators({});
    const { launch } = makePuppeteerMocks({ limitsError: new Error("limits unavailable") });

    const response = await runPdfRequest();

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toMatchObject({ error: "capacity_unavailable" });
    expect(mocks.enforceSharePdfDailyCap).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("fails closed when browser capacity preflight is malformed", async () => {
    const mocks = mockCollaborators({});
    const { launch } = makePuppeteerMocks({
      limits: { allowedBrowserAcquisitions: Number.NaN, timeUntilNextAllowedBrowserAcquisition: 0 },
    });

    const response = await runPdfRequest();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "capacity_unavailable" });
    expect(mocks.enforceSharePdfDailyCap).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("returns 503 unconfigured when no server origin or BROWSER binding exists", async () => {
    const noOriginMocks = mockCollaborators({});
    makePuppeteerMocks();

    const noOrigin = await runPdfRequest(makeEnv({ APP_ORIGIN: undefined, BETTER_AUTH_URL: undefined }));
    expect(noOrigin.status).toBe(503);
    expect(await noOrigin.json()).toMatchObject({ error: "pdf_unconfigured" });
    expect(noOriginMocks.enforceSharePdfDailyCap).not.toHaveBeenCalled();

    vi.resetModules();
    const noBrowserMocks = mockCollaborators({});
    makePuppeteerMocks();
    const noBrowser = await runPdfRequest(makeEnv({ BROWSER: undefined }));
    expect(noBrowser.status).toBe(503);
    expect(await noBrowser.json()).toMatchObject({ error: "pdf_unconfigured" });
    expect(noBrowserMocks.enforceSharePdfDailyCap).not.toHaveBeenCalled();
  });

  it("renders the ?pdf=1 variant from the configured origin and returns an attachment", async () => {
    const mocks = mockCollaborators({});
    const { page, browser, launch } = makePuppeteerMocks();
    const env = makeEnv();

    const response = await runPdfRequest(env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="competitor-report-q3.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(launch).toHaveBeenCalledWith((env as { BROWSER: unknown }).BROWSER);
    expect(mocks.installPublicBrowserRequestGuard).toHaveBeenCalledWith(page);
    expect(page.goto).toHaveBeenCalledWith(
      "https://0509.io/share/token-1?pdf=1",
      expect.objectContaining({ waitUntil: "networkidle2" }),
    );
    expect(page.waitForSelector).toHaveBeenCalledWith(
      "[data-report-root]",
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(page.pdf).toHaveBeenCalledWith({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(browser.close).toHaveBeenCalled();
  });

  it("never builds the render URL from request-supplied origins", async () => {
    mockCollaborators({});
    const { page } = makePuppeteerMocks();
    const { renderShareReportPdfResponse } = await import("~/lib/report-pdf.server");

    const hostileRequest = new Request("https://attacker.example/share/token-1/pdf", {
      headers: {
        "x-forwarded-host": "attacker.example",
        forwarded: 'proto=https;host="attacker.example"',
      },
    });
    const response = await renderShareReportPdfResponse(makeEnv(), hostileRequest, "token-1");

    expect(response.status).toBe(200);
    expect(String(page.goto.mock.calls[0]?.[0])).toBe("https://0509.io/share/token-1?pdf=1");
  });

  it("rejects oversized PDFs with a retryable 502 and still closes the browser", async () => {
    mockCollaborators({});
    const { browser } = makePuppeteerMocks({
      pdf: async () => new Uint8Array(10 * 1024 * 1024 + 1),
    });

    const response = await runPdfRequest();

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "pdf_too_large" });
    expect(browser.close).toHaveBeenCalled();
  });

  it("maps render timeouts to 504 without leaking the token, and closes the browser", async () => {
    mockCollaborators({});
    const { browser } = makePuppeteerMocks({
      goto: async () => {
        throw new PromiseTimeoutError("goto https://0509.io/share/token-1?pdf=1 timed out");
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await runPdfRequest();

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: "pdf_render_timeout" });
    expect(browser.close).toHaveBeenCalled();
    const logged = consoleError.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toContain("token-1");
    expect(logged).toContain("<share-token>");
  });

  it("returns an honest retryable 502 when rendering fails", async () => {
    const mocks = mockCollaborators({});
    const { browser } = makePuppeteerMocks({
      goto: async () => {
        throw new Error("net::ERR_FAILED");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await runPdfRequest();

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "pdf_render_failed" });
    // The reservation is intentionally not refunded: a Browser Run launch was
    // attempted and may already have consumed usage-billed capacity.
    expect(mocks.enforceSharePdfDailyCap).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalled();
  });

	it("route module delegates to the renderer with the validated token", async () => {
    mockCollaborators({});
    makePuppeteerMocks();
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => makeEnv()) }));

    const { loader } = await import("~/routes/share.$token.pdf");
    const response = await loader({
      context: { cloudflare: { env: {}, ctx: undefined } },
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1/pdf"),
    } as never);

    expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/pdf");
	});

	it.each(["HEAD", "POST"])(
		"rejects %s before resolving the environment or spending render capacity",
		async (method) => {
			const getEnv = vi.fn(() => makeEnv());
			const renderShareReportPdfResponse = vi.fn();
			vi.doMock("~/lib/context.server", () => ({ getEnv }));
			vi.doMock("~/lib/report-pdf.server", () => ({ renderShareReportPdfResponse }));

			const { loader } = await import("~/routes/share.$token.pdf");
			const response = await loader({
				context: { cloudflare: { env: {}, ctx: undefined } },
				params: { token: "token-1" },
				request: new Request("https://0509.io/share/token-1/pdf", { method }),
			} as never);

			expect(response.status).toBe(405);
			expect(response.headers.get("allow")).toBe("GET");
			expect(getEnv).not.toHaveBeenCalled();
			expect(renderShareReportPdfResponse).not.toHaveBeenCalled();
		},
	);

	it("falls back to a safe filename when the snapshot title is unusable", async () => {
    const { reportPdfFilename } = await import("~/lib/report-pdf.server");
    expect(reportPdfFilename(null)).toBe("shared-report.pdf");
    expect(reportPdfFilename({ title: "   " })).toBe("shared-report.pdf");
    expect(reportPdfFilename({ title: "…—…" })).toBe("shared-report.pdf");
    expect(reportPdfFilename({ title: "Diwali Push / मेगा सेल 2026" })).toBe(
      "diwali-push-2026.pdf",
    );
  });
});

describe("report_pdf browser-job attribution rows", () => {
  function telemetryHarness() {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
    return harness;
  }

  function telemetryRows(harness: ReturnType<typeof createSqliteD1>) {
    return harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry")
      .all() as Array<Record<string, unknown>>;
  }

  it("records a succeeded report_pdf row with the sharer's paid tier", async () => {
    const harness = telemetryHarness();
    makePuppeteerMocks();
    mockCollaborators({ plan: "agency" });

    const response = await runPdfRequest(makeEnv({ DB: harness.db }));

    expect(response.status).toBe(200);
    const rows = telemetryRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job_kind: "report_pdf",
      actual_provider: "cloudflare_browser_run",
      route_context: "share_pdf",
      plan_tier: "agency",
      source: "manual",
      outcome: "succeeded",
      result_count: null,
      result_bytes: 4,
    });
    expect(String(rows[0].idempotency_key)).toMatch(/^[0-9a-f]{64}$/u);
    expect(String(rows[0].job_id)).toMatch(/^[0-9a-f-]{36}$/u);
    expect(String(rows[0].job_id)).not.toContain("token-1");
    expect(String(rows[0].job_id)).not.toBe(String(rows[0].idempotency_key));
    // Duration is measured from the same recorded started_at.
    expect(Math.abs(
      Number(rows[0].duration_ms) -
        (Date.parse(String(rows[0].ended_at)) - Date.parse(String(rows[0].started_at))),
    )).toBeLessThanOrEqual(2);
    harness.close();
  });

  it("uses a distinct random job id per request with a stable content fingerprint", async () => {
    const harness = telemetryHarness();
    makePuppeteerMocks();
    mockCollaborators({ plan: "agency" });

    const first = await runPdfRequest(makeEnv({ DB: harness.db }));
    expect(first.status).toBe(200);
    const second = await runPdfRequest(makeEnv({ DB: harness.db }));
    expect(second.status).toBe(200);

    const rows = telemetryRows(harness);
    expect(rows).toHaveLength(2);
    // Independent requests must never share a job id...
    expect(rows[0].job_id).not.toBe(rows[1].job_id);
    // ...but the same report content keeps one stable idempotency fingerprint.
    expect(rows[0].idempotency_key).toBe(rows[1].idempotency_key);
    harness.close();
  });

  it("records no provider attempt for capacity or single-flight gates", async () => {
    // Capacity gate: no Cloudflare Browser Run attempt ever started, so no
    // row may claim `cloudflare_browser_run`.
    const harness = telemetryHarness();
    mockCollaborators({});
    makePuppeteerMocks({
      limits: { allowedBrowserAcquisitions: 0, timeUntilNextAllowedBrowserAcquisition: 12_000 },
    });

    const exhausted = await runPdfRequest(makeEnv({ DB: harness.db }));
    expect(exhausted.status).toBe(503);
    expect(telemetryRows(harness)).toHaveLength(0);

    // Single-flight gate (pre-render): still no provider attempt.
    const limited = new Response("{}", { status: 429 });
    vi.resetModules();
    mockCollaborators({ singleFlightLimited: limited });
    makePuppeteerMocks();

    const blocked = await runPdfRequest(makeEnv({ DB: harness.db }));
    expect(blocked.status).toBe(429);
    expect(telemetryRows(harness)).toHaveLength(0);
    harness.close();
  });

  it("records a rate_limited row when a real render attempt is 429-limited", async () => {
    const harness = telemetryHarness();
    mockCollaborators({});
    makePuppeteerMocks({
      launchError: new Error("Unable to create new browser: code: 429: message: Rate limit exceeded"),
    });

    const response = await runPdfRequest(makeEnv({ DB: harness.db }));
    expect(response.status).toBe(502);
    const rows = telemetryRows(harness);
    expect(rows).toHaveLength(1);
    // Truthful mapping: a provider 429 during the real render attempt is
    // `rate_limited` (never a generic `failed`), while the customer-visible
    // response stays unchanged.
    expect(rows[0]).toMatchObject({
      job_kind: "report_pdf",
      actual_provider: "cloudflare_browser_run",
      outcome: "rate_limited",
    });
    harness.close();
  });

  it("records a timeout row when the real render attempt times out", async () => {
    const harness = telemetryHarness();
    mockCollaborators({});
    makePuppeteerMocks({
      goto: async () => {
        throw new PromiseTimeoutError("goto https://0509.io/share/token-1?pdf=1 timed out");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await runPdfRequest(makeEnv({ DB: harness.db }));
    expect(response.status).toBe(504);
    const rows = telemetryRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job_kind: "report_pdf",
      actual_provider: "cloudflare_browser_run",
      outcome: "timeout",
    });
    harness.close();
  });

  it("registers the row write with waitUntil when an ExecutionContext exists", async () => {
    const harness = telemetryHarness();
    makePuppeteerMocks();
    mockCollaborators({ plan: "agency" });
    const waitUntil = vi.fn();

    const { renderShareReportPdfResponse } = await import("~/lib/report-pdf.server");
    const response = await renderShareReportPdfResponse(
      makeEnv({ DB: harness.db }),
      new Request("https://0509.io/share/token-1/pdf"),
      "token-1",
      { waitUntil } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(200);
    // The bounded write is registered for background completion without ever
    // blocking the response; the row still lands.
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
    expect(telemetryRows(harness)).toHaveLength(1);
    harness.close();
  });

  it("records nothing for gates that reject before any browser-capable job", async () => {
    const harness = telemetryHarness();
    mockCollaborators({ share: null });
    makePuppeteerMocks();

    const response = await runPdfRequest(makeEnv({ DB: harness.db }));
    expect(response.status).toBe(404);
    expect(telemetryRows(harness)).toHaveLength(0);
    harness.close();
  });

  it("starts the provider duration at the actual launch, after every pre-provider gate (controlled clock)", async () => {
    // The capacity preflight consumes 5s of pre-provider time. The recorded
    // startedAt/duration must reflect the real Browser Run window only —
    // never the request start — while the job id and content fingerprint
    // stay stable and gates still claim no provider attempt.
    const harness = telemetryHarness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    mockCollaborators({ plan: "agency" });
    makePuppeteerMocks({
      limitsHook: () => {
        vi.advanceTimersByTime(5_000);
      },
    });

    const response = await runPdfRequest(makeEnv({ DB: harness.db }));
    expect(response.status).toBe(200);

    const rows = telemetryRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job_kind: "report_pdf",
      actual_provider: "cloudflare_browser_run",
      outcome: "succeeded",
      // Provider start is AFTER the 5s capacity preflight, and the recorded
      // duration is the provider window only (0ms), never ~5000ms.
      started_at: "2026-08-13T12:00:05.000Z",
      duration_ms: 0,
    });
    expect(String(rows[0].job_id)).toMatch(/^[0-9a-f-]{36}$/u);
    expect(String(rows[0].idempotency_key)).toMatch(/^[0-9a-f]{64}$/u);
    vi.useRealTimers();
    harness.close();
  });
});
