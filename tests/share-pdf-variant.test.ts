import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const REPORT_SNAPSHOT_PAYLOAD = {
  kind: "report",
  reportId: "shared-report",
  resourceType: "collection",
  resourceId: "shared",
  title: "Board evidence",
  subtitle: "Latest saved evidence",
  summary: "One saved item.",
  generatedAt: "2026-07-01T00:00:00.000Z",
  stats: [],
  insightDepth: {
    topHooks: [],
    mediaMix: [],
    campaignDurations: [],
    metricProof: [],
    creativeTimeline: [],
    landingPageHistory: [],
  },
  rows: [],
};

const REPORT_SHARE = {
  id: "share-1",
  token: "token-1",
  userId: "sharer-1",
  resourceType: "report" as const,
  resourceId: "collection:col-1",
  isSnapshot: true,
  snapshotPayload: REPORT_SNAPSHOT_PAYLOAD,
  createdAt: "2026-07-01T00:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
};

function mockShareLoaderCollaborators(input: {
  share?: typeof REPORT_SHARE;
  plan?: string;
  branding?: {
    brandName: string | null;
    brandWebsite: string | null;
    brandLogo: string | null;
  } | null;
}) {
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
  vi.doMock("~/lib/plan-feature-gate.server", () => ({
    resolveWorkspaceBrandIdentity: vi.fn().mockResolvedValue(input.branding ?? null),
  }));
  vi.doMock("~/lib/plan.server", async () => {
    const { canUsePlanFeature } = await vi.importActual<
      typeof import("~/lib/plan-entitlements")
    >("~/lib/plan-entitlements");
    return {
      canUsePlanFeature,
      getUserPlan: vi.fn().mockResolvedValue(input.plan ?? "agency"),
    };
  });
  vi.doMock("~/lib/data.server", () => ({
    getCollection: vi.fn(),
    getDigest: vi.fn(),
    getShareLink: vi.fn().mockResolvedValue(input.share ?? REPORT_SHARE),
    getWatchlist: vi.fn(),
    listCollectionItems: vi.fn(),
    listWatchEvents: vi.fn(),
  }));
}

function mockUseLoaderData(data: Record<string, unknown>) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
      ...actual,
      Link: ({ children, to, ...props }: { children: ReactNode; to: string }) =>
        createElement("a", { href: to, ...props }, children),
      useLoaderData: vi.fn().mockReturnValue(data),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/plan-feature-gate.server");
});

describe("/share/:token loader PDF affordances", () => {
  it("exposes only a pdf path (never plan details) for agency report snapshots", async () => {
    mockShareLoaderCollaborators({ plan: "agency" });

    const { loader } = await import("~/routes/share.$token");
    const result = (await loader({
      context: {},
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1"),
    } as never)) as Record<string, unknown>;

    expect(result.pdfPath).toBe("/share/token-1/pdf");
    expect(result.pdfVariant).toBe(false);
    expect(JSON.stringify(result)).not.toContain("agency");
  });

  it("withholds the pdf path when the sharer's plan lacks pdf_reports", async () => {
    mockShareLoaderCollaborators({ plan: "starter" });

    const { loader } = await import("~/routes/share.$token");
    const result = (await loader({
      context: {},
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1"),
    } as never)) as Record<string, unknown>;

    expect(result.pdfPath).toBeNull();
  });

  it("uses the same entitled public identity for the page and PDF variant", async () => {
    const branding = {
      brandName: "Northlight Media",
      brandWebsite: "https://northlight.example",
      brandLogo: "data:image/png;base64,iVBORw0KGgo=",
    };
    mockShareLoaderCollaborators({ plan: "agency", branding });

    const { loader } = await import("~/routes/share.$token");
    const plain = (await loader({
      context: {},
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1"),
    } as never)) as Record<string, unknown>;
    expect(plain.brandIdentity).toEqual(branding);

    vi.resetModules();
    mockShareLoaderCollaborators({ plan: "agency", branding });
    const { loader: pdfLoader } = await import("~/routes/share.$token");
    const pdf = (await pdfLoader({
      context: {},
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1?pdf=1"),
    } as never)) as Record<string, unknown>;
    expect(pdf.pdfVariant).toBe(true);
    expect(pdf.brandIdentity).toEqual(branding);
  });
});

describe("/share/:token PDF variant markup", () => {
  it("headlines agency branding, drops interactive chrome, credits Five to Nine in the footer", async () => {
    mockUseLoaderData({
      mode: "snapshot",
      resourceType: "report",
      payload: REPORT_SNAPSHOT_PAYLOAD,
      preparedBy: "Northlight Media",
      pdfVariant: true,
      brandIdentity: {
        brandName: "Northlight Media",
        brandWebsite: "https://northlight.example",
        brandLogo: "data:image/png;base64,iVBORw0KGgo=",
      },
      pdfPath: "/share/token-1/pdf",
    });

    const { default: ShareRoute } = await import("~/routes/share.$token");
    const markup = renderToStaticMarkup(createElement(ShareRoute));

    expect(markup).toContain("f9-share-pdf");
    expect(markup).toContain("data-report-root");
    expect(markup).toContain("Northlight Media");
    expect(markup).toContain("https://northlight.example");
    expect(markup).toContain("Prepared with Five to Nine");
    expect(markup).not.toContain("Download PDF");
    expect(markup).not.toContain("Print report");
    expect(markup).not.toContain("<button");
  });

  it("keeps the Five to Nine wordmark headline when the sharer has no branding", async () => {
    mockUseLoaderData({
      mode: "snapshot",
      resourceType: "report",
      payload: REPORT_SNAPSHOT_PAYLOAD,
      preparedBy: null,
      pdfVariant: true,
      brandIdentity: null,
      pdfPath: null,
    });

    const { default: ShareRoute } = await import("~/routes/share.$token");
    const markup = renderToStaticMarkup(createElement(ShareRoute));

    expect(markup).toContain("f9-pdf-masthead");
    expect(markup).toContain("f9-wordmark");
    expect(markup).toContain("Prepared with Five to Nine");
  });

  it("links Download PDF to the pdf route when the sharer's plan allows it", async () => {
    mockUseLoaderData({
      mode: "snapshot",
      resourceType: "report",
      payload: REPORT_SNAPSHOT_PAYLOAD,
      preparedBy: null,
      pdfVariant: false,
      brandIdentity: null,
      pdfPath: "/share/token-1/pdf",
    });

    const { default: ShareRoute } = await import("~/routes/share.$token");
    const markup = renderToStaticMarkup(createElement(ShareRoute));

    expect(markup).toContain('href="/share/token-1/pdf"');
    expect(markup).toContain("Download PDF");
    expect(markup).not.toContain("Print report");
  });

  it("offers an honest Print button (never labeled PDF) when the plan disallows PDFs", async () => {
    mockUseLoaderData({
      mode: "snapshot",
      resourceType: "report",
      payload: REPORT_SNAPSHOT_PAYLOAD,
      preparedBy: null,
      pdfVariant: false,
      brandIdentity: null,
      pdfPath: null,
    });

    const { default: ShareRoute } = await import("~/routes/share.$token");
    const markup = renderToStaticMarkup(createElement(ShareRoute));

    expect(markup).toContain("Print report");
    expect(markup).not.toContain("Download PDF");
  });
});

describe("/app/reports/:id PDF wiring", () => {
  const session = {
    user: { id: "user-1", email: "owner@example.com", name: "Owner" },
    session: { id: "session-1", userId: "user-1" },
  };

  function mockReportsCollaborators(input: {
    pdfAllowed: boolean;
    existingShares?: Array<Record<string, unknown>>;
    createShareLink?: ReturnType<typeof vi.fn>;
  }) {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: "user-1",
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      requireWorkspacePlanFeature: vi.fn(async (_env: unknown, _userId: string, feature: string) => {
        if (feature === "pdf_reports" && !input.pdfAllowed) {
          return { ok: false, plan: "starter", response: new Response("denied", { status: 403 }) };
        }
        return { ok: true, plan: "agency" };
      }),
      resolveWorkspacePreparedBy: vi.fn().mockResolvedValue(null),
    }));
    const createShareLink =
      input.createShareLink ?? vi.fn().mockResolvedValue({ id: "share-new", token: "fresh-token", expiresAt: null });
    vi.doMock("~/lib/data.server", () => ({
      createShareLink,
      listActiveShareLinks: vi.fn().mockResolvedValue(input.existingShares ?? []),
      getCollection: vi.fn().mockResolvedValue({ id: "col-1", name: "Board", userId: "user-1" }),
      getWatchlist: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listCollectionItems: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn(),
    }));
    return { createShareLink };
  }

  it("download-pdf mints a snapshot share and 303-redirects to its /pdf", async () => {
    const { createShareLink } = mockReportsCollaborators({ pdfAllowed: true });

    const { action } = await import("~/routes/app.reports");
    const body = new URLSearchParams({ intent: "download-pdf" });
    let redirected: Response | null = null;
    try {
      await action({
        context: {},
        params: { id: "collection:col-1" },
        request: new Request("https://0509.io/app/reports/collection:col-1", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        }),
      } as never);
    } catch (thrown) {
      redirected = thrown as Response;
    }

    expect(redirected?.status).toBe(303);
    expect(redirected?.headers.get("location")).toBe("/share/fresh-token/pdf");
    expect(createShareLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }),
      expect.objectContaining({ resourceType: "report", isSnapshot: true }),
    );
  });

  it("reuses a snapshot share minted moments ago instead of creating another", async () => {
    const { createShareLink } = mockReportsCollaborators({
      pdfAllowed: true,
      existingShares: [
        {
          id: "share-recent",
          token: "recent-token",
          userId: "user-1",
          resourceType: "report",
          resourceId: "collection:col-1",
          isSnapshot: true,
          snapshotPayload: null,
          createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
          expiresAt: null,
          revokedAt: null,
        },
      ],
    });

    const { action } = await import("~/routes/app.reports");
    let redirected: Response | null = null;
    try {
      await action({
        context: {},
        params: { id: "collection:col-1" },
        request: new Request("https://0509.io/app/reports/collection:col-1", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ intent: "download-pdf" }).toString(),
        }),
      } as never);
    } catch (thrown) {
      redirected = thrown as Response;
    }

    expect(redirected?.headers.get("location")).toBe("/share/recent-token/pdf");
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it("throws the plan-gate response for non-agency download-pdf attempts", async () => {
    mockReportsCollaborators({ pdfAllowed: false });

    const { action } = await import("~/routes/app.reports");
    let thrown: Response | null = null;
    try {
      await action({
        context: {},
        params: { id: "collection:col-1" },
        request: new Request("https://0509.io/app/reports/collection:col-1", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ intent: "download-pdf" }).toString(),
        }),
      } as never);
    } catch (error) {
      thrown = error as Response;
    }

    expect(thrown?.status).toBe(403);
  });
});

describe("share-pdf rate limit policies", () => {
  it("keeps the bearer token out of rate_limit_events and fails closed", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
    const env = { DB: harness.db } as never;

    const { enforceSharePdfRateLimit, enforceSharePdfDailyCap } = await import(
      "~/lib/rate-limit.server"
    );
    const request = new Request("https://0509.io/share/super-secret-token/pdf", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });

    expect(await enforceSharePdfRateLimit(request, env)).toBeNull();
    expect(await enforceSharePdfDailyCap(request, env, "sharer-1")).toBeNull();

    const rows = harness.sqlite
      .prepare("SELECT scope, route FROM rate_limit_events")
      .all() as Array<{ scope: string; route: string }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.route).toBe("/share/:token/pdf");
      expect(row.route).not.toContain("super-secret-token");
    }
    expect(rows.map((row) => row.scope).sort()).toEqual(["share-pdf", "share-pdf-daily"]);

    // Fail closed without a DB binding — these are the only spend gates.
    const closed = await enforceSharePdfRateLimit(request, {} as never);
    expect(closed?.status).toBe(503);
    harness.close();
  });

  it("blocks the sixth per-IP request in a minute and the 41st sharer render in a day", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
    const env = { DB: harness.db } as never;

    const { enforceSharePdfRateLimit, enforceSharePdfDailyCap } = await import(
      "~/lib/rate-limit.server"
    );
    const request = new Request("https://0509.io/share/token-x/pdf", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });

    for (let index = 0; index < 5; index += 1) {
      expect(await enforceSharePdfRateLimit(request, env)).toBeNull();
    }
    const ipBlocked = await enforceSharePdfRateLimit(request, env);
    expect(ipBlocked?.status).toBe(429);

    for (let index = 0; index < 40; index += 1) {
      expect(await enforceSharePdfDailyCap(request, env, "sharer-1")).toBeNull();
    }
    const dailyBlocked = await enforceSharePdfDailyCap(request, env, "sharer-1");
    expect(dailyBlocked?.status).toBe(429);
    // A different sharer's budget is untouched.
    expect(await enforceSharePdfDailyCap(request, env, "sharer-2")).toBeNull();
    harness.close();
  });

  it("retains daily-cap events past the short cleanup horizon", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/lib/rate-limit.server.ts", "utf8");
    // The 24h cap only works if cleanup keeps its scope for >= 24h.
    expect(source).toContain("LONG_WINDOW_CLEANUP_SECONDS = 25 * 60 * 60");
    expect(source).toMatch(/scope != \? AND created_at < \?/);
  });
});
