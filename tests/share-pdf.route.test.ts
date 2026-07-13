import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromiseTimeoutError } from "~/lib/fetch-timeout.server";

const AGENCY_SHARE = {
  id: "share-1",
  token: "token-1",
  userId: "sharer-1",
  resourceType: "report" as const,
  resourceId: "watchlist:watch-1",
  isSnapshot: true,
  snapshotPayload: { kind: "report", title: "Competitor Report — Q3!" },
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
  const launch = vi.fn(async () => browser);
  const limits = vi.fn(async () =>
    options.limits ?? { allowedBrowserAcquisitions: 3, timeUntilNextAllowedBrowserAcquisition: 0 },
  );

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
}) {
  const enforceSharePdfRateLimit = vi.fn(async () => input.ipLimit ?? null);
  const enforceSharePdfDailyCap = vi.fn(async () => input.dailyLimit ?? null);
  const share = input.share === undefined ? AGENCY_SHARE : input.share;
  const getShareLink = vi.fn(async () => share);
  const getUserPlan = vi.fn(async () => input.plan ?? "agency");
  const installPublicBrowserRequestGuard = vi.fn(async () => undefined);

  vi.doMock("~/lib/rate-limit.server", () => ({
    enforceSharePdfRateLimit,
    enforceSharePdfDailyCap,
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
