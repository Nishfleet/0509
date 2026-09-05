import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCollectionReport } from "~/lib/report-builder.server";
import type { ReportDocument } from "~/lib/report";
import {
  createApprovedReportSnapshot,
  reportEvidenceFingerprint,
} from "~/lib/report-approval";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const REPORT_BASE_PAYLOAD = {
  kind: "report",
  reportId: "shared-report",
  resourceType: "collection",
  resourceId: "shared",
  title: "Board evidence",
  subtitle: "Latest saved evidence",
  summary: "One saved item.",
  generatedAt: "2026-07-01T00:00:00.000Z",
  aiWeeklySummary: {
    paragraph:
      "Competitors concentrated this week's movement on promotional offers.",
    generatedAt: "2026-07-01T00:05:00.000Z",
    periodEnd: "2026-07-01T00:00:00.000Z",
  },
  stats: [],
  insightDepth: {
    topHooks: [],
    mediaMix: [],
    campaignDurations: [],
    metricProof: [],
    creativeTimeline: [],
    landingPageHistory: [],
  },
  rows: [
    {
      id: "row-1",
      advertiser: "Competitor",
      previewHeadline: "Board evidence",
      offer: null,
      cta: null,
      formatLabel: "Image",
      languageLabel: null,
      previewImageUrl: null,
      creativeText: null,
      translatedText: null,
      captureReasonCode: "ocr_provider_failed",
      landingPage: {
        url: "https://example.com/evidence",
        headline: "Current evidence",
        captureLabel: "Browser proof",
        capturedAt: "2026-07-01T00:00:00.000Z",
        signals: [],
      },
      analysisFields: [],
      tags: [],
      note: null,
    },
  ],
} satisfies ReportDocument;

const REPORT_SNAPSHOT_PAYLOAD =
  createApprovedReportSnapshot(REPORT_BASE_PAYLOAD)!;

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

type MockShare = Omit<typeof REPORT_SHARE, "snapshotPayload"> & {
  snapshotPayload: unknown;
};

function collectionSnapshotPayload({
  generatedAt = "2026-07-01T00:00:00.000Z",
  title = "Board",
}: {
  generatedAt?: string;
  title?: string;
} = {}) {
  const report = buildCollectionReport({
    collection: {
      id: "col-1",
      userId: "user-1",
      name: title,
      description: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    items: [
      {
        id: "item-1",
        collectionId: "col-1",
        adId: "meta-1",
        note: "Saved evidence",
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
        tags: ["evidence"],
        ad: {
          metaAdId: "meta-1",
          advertiser: "Competitor",
          body: "Offer",
          previewHeadline: "Offer",
          previewSubhead: "",
          hook: "Offer",
          offer: "",
          cta: "",
          format: "image",
          languageLabel: "English",
          destinationType: "website",
          landingPageUrl: "https://example.com/offer",
          adSnapshotUrl: null,
          countries: [],
          platforms: [],
          firstSeenAt: "2026-07-15T00:00:00.000Z",
          lastSeenAt: "2026-07-15T00:00:00.000Z",
          active: true,
          researchSummary: "",
          source: "external",
          analysisFields: [],
          landingPage: {
            rawUrl: "https://example.com/offer",
            canonicalUrl: "https://example.com/offer",
            rawHeadline: "Current offer",
            normalizedHeadline: "current offer",
            normalizedHeadlineHash: "current-offer",
            captureMethod: "browser_render",
            capturedAt: "2026-07-15T00:00:00.000Z",
          },
        },
      },
    ],
    generatedAt,
  });
  return createApprovedReportSnapshot({
    ...report,
    reportId: "shared-report",
    resourceId: "shared",
  })!;
}

const REVIEW_NONCE = "00000000-0000-4000-8000-000000000001";

function reviewedBody(
  intent: string,
  reviewFingerprint: string,
  reviewNonce = REVIEW_NONCE,
) {
  return new URLSearchParams({
    intent,
    reviewed: "true",
    reviewFingerprint,
    reviewNonce,
  });
}

function collectionReviewFingerprint(
  collectionName = "Board",
  collectionItems?: unknown[],
) {
  const items = collectionItems ?? [
    {
      id: "item-1",
      collectionId: "col-1",
      adId: "meta-1",
      note: "Saved evidence",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      tags: ["evidence"],
      ad: {
        metaAdId: "meta-1",
        advertiser: "Competitor",
        body: "Offer",
        previewHeadline: "Offer",
        previewSubhead: null,
        hook: "Offer",
        offer: null,
        cta: null,
        format: "image",
        languageLabel: "English",
        destinationType: "website",
        landingPageUrl: "https://example.com/offer",
        adSnapshotUrl: null,
        countries: [],
        platforms: [],
        firstSeenAt: "2026-07-15T00:00:00.000Z",
        lastSeenAt: "2026-07-15T00:00:00.000Z",
        active: true,
        researchSummary: null,
        source: "external",
        analysisFields: [],
        landingPage: {
          rawUrl: "https://example.com/offer",
          canonicalUrl: "https://example.com/offer",
          rawHeadline: "Current offer",
          normalizedHeadline: "current offer",
          normalizedHeadlineHash: "current-offer",
          captureMethod: "browser_render",
          capturedAt: "2026-07-15T00:00:00.000Z",
        },
      },
    },
  ];
  return reportEvidenceFingerprint(
    buildCollectionReport({
      collection: {
        id: "col-1",
        userId: "user-1",
        name: collectionName,
        description: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      items: items as never,
      generatedAt: "2026-07-15T00:00:00.000Z",
    }),
  );
}

function withSynchronizedStaleCountReads(
  baseDb: ReturnType<typeof createSqliteD1>["db"],
  participants: number,
) {
  let reads = 0;
  let releaseReads: (() => void) | null = null;
  const allReadsStarted = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });

  return {
    ...baseDb,
    prepare(sql: string) {
      const statement = baseDb.prepare(sql);
      if (!sql.includes("SELECT COUNT(*) AS count")) {
        return statement;
      }

      return {
        bind(...bindings: unknown[]) {
          const bound = statement.bind(...bindings);
          return {
            ...bound,
            async first<T>() {
              reads += 1;
              if (reads === participants) {
                releaseReads?.();
              }
              await allReadsStarted;
              return { count: 0 } as T;
            },
          };
        },
      };
    },
  };
}

function mockShareLoaderCollaborators(input: {
  share?: MockShare;
  plan?: string;
  branding?: {
    brandName: string | null;
    brandWebsite: string | null;
    brandLogo: string | null;
  } | null;
}) {
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
  vi.doMock("~/lib/plan-feature-gate.server", () => ({
    resolveWorkspaceBrandIdentity: vi
      .fn()
      .mockResolvedValue(input.branding ?? null),
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
    listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn(),
  }));
}

function mockUseLoaderData(data: Record<string, unknown>) {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
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
  it("fails closed for an unreviewed report snapshot", async () => {
    mockShareLoaderCollaborators({
      share: {
        ...REPORT_SHARE,
        snapshotPayload: {
          ...REPORT_SNAPSHOT_PAYLOAD,
          reviewState: "draft",
        },
      },
    });
    const { loader } = await import("~/routes/share.$token");
    const result = (await loader({
      context: {},
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1"),
    } as never)) as Record<string, unknown>;
    expect(result.payload).toBeNull();
  });

  it("fails closed for an expired approved report snapshot", async () => {
    mockShareLoaderCollaborators({
      share: {
        ...REPORT_SHARE,
        snapshotPayload: {
          ...REPORT_SNAPSHOT_PAYLOAD,
          approvalExpiresAt: "2020-01-01T00:00:00.000Z",
        },
      },
    });
    const { loader } = await import("~/routes/share.$token");
    const result = (await loader({
      context: {},
      params: { token: "token-1" },
      request: new Request("https://0509.io/share/token-1"),
    } as never)) as Record<string, unknown>;
    expect(result.payload).toBeNull();
  });

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
    expect(result.payload).toMatchObject({
      aiWeeklySummary: {
        paragraph:
          "Competitors concentrated this week's movement on promotional offers.",
        generatedAt: "2026-07-01T00:05:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
      },
      rows: [
        expect.objectContaining({
          captureReasonCode: "ocr_provider_failed",
        }),
      ],
    });
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
    expect(markup).toContain(
      "Competitors concentrated this week&#x27;s movement",
    );
    expect(markup).not.toContain("Download PDF");
    expect(markup).not.toContain("Print report");
    expect(markup).not.toContain("<button");
    expect(markup.indexOf("<h1")).toBeGreaterThan(-1);
    expect(markup.indexOf("<h1")).toBeLessThan(markup.indexOf("<h2"));
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

    expect(markup).toContain("Download PDF");
    expect(markup).not.toContain("Print report");
    expect(markup).toContain('class="f9-evidence-report-actions"');
    expect(markup).not.toContain("f9-panel-toolbar-heading");
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
    collectionName?: string;
    collectionItems?: unknown[];
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
      requireWorkspacePlanFeature: vi.fn(
        async (_env: unknown, _userId: string, feature: string) => {
          if (feature === "pdf_reports" && !input.pdfAllowed) {
            return {
              ok: false,
              plan: "starter",
              response: new Response("denied", { status: 403 }),
            };
          }
          return { ok: true, plan: "agency" };
        },
      ),
      resolveWorkspacePreparedBy: vi.fn().mockResolvedValue(null),
    }));
    const createShareLink =
      input.createShareLink ??
      vi.fn().mockResolvedValue({
        id: "share-new",
        token: "fresh-token",
        expiresAt: null,
      });
    const collectionItems = input.collectionItems ?? undefined;
    const reviewFingerprint = collectionReviewFingerprint(
      input.collectionName ?? "Board",
      collectionItems,
    );
    vi.doMock("~/lib/data.server", () => ({
      createShareLink,
      getLatestDigestRunSummaryForWatchlist: vi.fn().mockResolvedValue(null),
      listActiveShareLinks: vi
        .fn()
        .mockResolvedValue(input.existingShares ?? []),
      getCollection: vi.fn().mockResolvedValue({
        id: "col-1",
        name: input.collectionName ?? "Board",
        userId: "user-1",
      }),
      getWatchlist: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listCollectionItems: vi.fn().mockResolvedValue(
        collectionItems ?? [
          {
            id: "item-1",
            collectionId: "col-1",
            adId: "meta-1",
            note: "Saved evidence",
            createdAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:00:00.000Z",
            tags: ["evidence"],
            ad: {
              metaAdId: "meta-1",
              advertiser: "Competitor",
              body: "Offer",
              previewHeadline: "Offer",
              previewSubhead: null,
              hook: "Offer",
              offer: null,
              cta: null,
              format: "image",
              languageLabel: "English",
              destinationType: "website",
              landingPageUrl: "https://example.com/offer",
              adSnapshotUrl: null,
              countries: [],
              platforms: [],
              firstSeenAt: "2026-07-15T00:00:00.000Z",
              lastSeenAt: "2026-07-15T00:00:00.000Z",
              active: true,
              researchSummary: null,
              source: "external",
              analysisFields: [],
              landingPage: {
                rawUrl: "https://example.com/offer",
                canonicalUrl: "https://example.com/offer",
                rawHeadline: "Current offer",
                normalizedHeadline: "current offer",
                normalizedHeadlineHash: "current-offer",
                captureMethod: "browser_render",
                capturedAt: "2026-07-15T00:00:00.000Z",
              },
            },
          },
        ],
      ),
      listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn(),
    }));
    return { createShareLink, reviewFingerprint };
  }

  it("requires an explicit owner review before minting a PDF snapshot", async () => {
    const { createShareLink } = mockReportsCollaborators({ pdfAllowed: true });
    const { action } = await import("~/routes/app.reports");
    const result = await action({
      context: {},
      params: { id: "collection:col-1" },
      request: new Request("https://0509.io/app/reports/collection:col-1", {
        method: "POST",
        body: new URLSearchParams({ intent: "download-pdf" }),
      }),
    } as never);

    expect(result).toMatchObject({
      error: "review_required",
      intent: "download-pdf",
    });
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it("fails closed when the current report has no saved evidence", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
      collectionItems: [],
    });
    const { action } = await import("~/routes/app.reports");
    const result = await action({
      context: {},
      params: { id: "collection:col-1" },
      request: new Request("https://0509.io/app/reports/collection:col-1", {
        method: "POST",
        body: reviewedBody("share-report", reviewFingerprint),
      }),
    } as never);

    expect(result).toMatchObject({
      error: "evidence_not_ready",
      intent: "share-report",
    });
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it("rejects a review bound to an older evidence fingerprint with the report recovery path", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
    });
    const { action } = await import("~/routes/app.reports");
    const result = await action({
      context: {},
      params: { id: "collection:col-1" },
      request: new Request("https://0509.io/app/reports/collection:col-1", {
        method: "POST",
        body: reviewedBody("share-report", `${reviewFingerprint}-stale`),
      }),
    } as never);

    expect(result).toMatchObject({
      error: "review_stale",
      intent: "share-report",
      recoveryPath: "/app/reports/collection:col-1",
    });
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it("fails closed with a report recovery path when publish loses a revoke race", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
      createShareLink: vi
        .fn()
        .mockRejectedValue(new Error("share_link_inactive")),
    });
    const { action } = await import("~/routes/app.reports");
    const result = await action({
      context: {},
      params: { id: "collection:col-1" },
      request: new Request("https://0509.io/app/reports/collection:col-1", {
        method: "POST",
        body: reviewedBody("share-report", reviewFingerprint),
      }),
    } as never);

    expect(result).toMatchObject({
      error: "share_link_inactive",
      intent: "share-report",
      recoveryPath: "/app/reports/collection:col-1",
    });
  });

  it("derives the same owner-scoped publication id for same-page duplicate PDF submissions", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
    });
    const { action } = await import("~/routes/app.reports");
    const request = () =>
      new Request("https://0509.io/app/reports/collection:col-1", {
        method: "POST",
        body: reviewedBody("download-pdf", reviewFingerprint),
      });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await action({
          context: {},
          params: { id: "collection:col-1" },
          request: request(),
        } as never);
      } catch (thrown) {
        expect((thrown as Response).status).toBe(303);
      }
    }

    const firstId = (createShareLink.mock.calls[0]?.[2] as { id?: string }).id;
    const secondId = (createShareLink.mock.calls[1]?.[2] as { id?: string }).id;
    expect(firstId).toMatch(/^report_pdf_[0-9a-f]{64}$/);
    expect(secondId).toBe(firstId);
    expect(
      (createShareLink.mock.calls[0]?.[2] as { token?: string }).token,
    ).toBeUndefined();
  });

  it("derives a stable owner-scoped publication id for same-page duplicate shares", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
    });
    const { action } = await import("~/routes/app.reports");
    const request = () =>
      new Request("https://0509.io/app/reports/collection:col-1", {
        method: "POST",
        body: reviewedBody("share-report", reviewFingerprint),
      });

    await action({
      context: {},
      params: { id: "collection:col-1" },
      request: request(),
    } as never);
    await action({
      context: {},
      params: { id: "collection:col-1" },
      request: request(),
    } as never);

    const firstId = (createShareLink.mock.calls[0]?.[2] as { id?: string }).id;
    const secondId = (createShareLink.mock.calls[1]?.[2] as { id?: string }).id;
    expect(firstId).toMatch(/^report_share_[0-9a-f]{64}$/);
    expect(secondId).toBe(firstId);
    expect(
      (createShareLink.mock.calls[0]?.[2] as { token?: string }).token,
    ).toBeUndefined();
  });

  it("download-pdf mints a snapshot share and 303-redirects to its /pdf", async () => {
    const now = 1_783_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
    });

    const { action } = await import("~/routes/app.reports");
    const body = reviewedBody("download-pdf", reviewFingerprint);
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
      expect.objectContaining({
        user: expect.objectContaining({ id: "user-1" }),
      }),
      expect.objectContaining({
        resourceType: "report",
        isSnapshot: true,
        snapshotPayload: expect.objectContaining({
          sharePurpose: "pdf-render",
        }),
        expiresAt: expect.any(String),
      }),
    );

    const createInput = createShareLink.mock.calls[0]?.[2] as {
      expiresAt?: string;
    };
    expect(createInput.expiresAt).toBe(
      new Date(now + 10 * 60 * 1000).toISOString(),
    );
  });

  it("reuses a snapshot share minted moments ago instead of creating another", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
      existingShares: [
        {
          id: "share-recent",
          token: "recent-token",
          userId: "user-1",
          resourceType: "report",
          resourceId: "collection:col-1",
          isSnapshot: true,
          snapshotPayload: {
            ...collectionSnapshotPayload(),
            sharePurpose: "pdf-render",
          },
          createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
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
          body: reviewedBody("download-pdf", reviewFingerprint).toString(),
        }),
      } as never);
    } catch (thrown) {
      redirected = thrown as Response;
    }

    expect(redirected?.headers.get("location")).toBe("/share/recent-token/pdf");
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it("does not reuse a canonical default-lifetime public snapshot for PDF rendering", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
      existingShares: [
        {
          id: "share-public",
          token: "public-token",
          userId: "user-1",
          resourceType: "report",
          resourceId: "collection:col-1",
          isSnapshot: true,
          snapshotPayload: collectionSnapshotPayload(),
          createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
          // The share-link helper's normal 90-day default is represented by
          // this long expiry; PDF downloads must mint their own short token.
          expiresAt: new Date(
            Date.now() + 90 * 24 * 60 * 60 * 1000,
          ).toISOString(),
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
          body: reviewedBody("download-pdf", reviewFingerprint).toString(),
        }),
      } as never);
    } catch (thrown) {
      redirected = thrown as Response;
    }

    expect(redirected?.headers.get("location")).toBe("/share/fresh-token/pdf");
    expect(createShareLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        snapshotPayload: expect.objectContaining({
          sharePurpose: "pdf-render",
        }),
        expiresAt: expect.any(String),
      }),
    );
  });

  it("mints a fresh PDF token when a matching render share is too close to expiry", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
      existingShares: [
        {
          id: "share-expiring",
          token: "expiring-token",
          userId: "user-1",
          resourceType: "report",
          resourceId: "collection:col-1",
          isSnapshot: true,
          snapshotPayload: {
            ...collectionSnapshotPayload(),
            sharePurpose: "pdf-render",
          },
          createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
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
          body: reviewedBody("download-pdf", reviewFingerprint).toString(),
        }),
      } as never);
    } catch (thrown) {
      redirected = thrown as Response;
    }

    expect(redirected?.headers.get("location")).toBe("/share/fresh-token/pdf");
    expect(createShareLink).toHaveBeenCalledTimes(1);
  });

  it("mints a fresh snapshot when the current report changed within the reuse window", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
      collectionName: "Board updated",
      existingShares: [
        {
          id: "share-stale",
          token: "stale-token",
          userId: "user-1",
          resourceType: "report",
          resourceId: "collection:col-1",
          isSnapshot: true,
          snapshotPayload: collectionSnapshotPayload({ title: "Board" }),
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
          body: reviewedBody("download-pdf", reviewFingerprint).toString(),
        }),
      } as never);
    } catch (thrown) {
      redirected = thrown as Response;
    }

    expect(redirected?.headers.get("location")).toBe("/share/fresh-token/pdf");
    expect(createShareLink).toHaveBeenCalledTimes(1);
    expect(createShareLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        snapshotPayload: expect.objectContaining({ title: "Board updated" }),
      }),
    );
  });

  it("mints a fresh snapshot instead of reusing a recent invalid legacy payload", async () => {
    const { createShareLink, reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: true,
      existingShares: [
        {
          id: "share-invalid",
          token: "invalid-token",
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
          body: reviewedBody("download-pdf", reviewFingerprint).toString(),
        }),
      } as never);
    } catch (thrown) {
      redirected = thrown as Response;
    }

    expect(redirected?.headers.get("location")).toBe("/share/fresh-token/pdf");
    expect(createShareLink).toHaveBeenCalledTimes(1);
  });

  it("returns mapped plan recovery for non-agency download-pdf attempts", async () => {
    const { reviewFingerprint } = mockReportsCollaborators({
      pdfAllowed: false,
    });

    const { action } = await import("~/routes/app.reports");
    const result = await action({
      context: {},
      params: { id: "collection:col-1" },
      request: new Request("https://0509.io/app/reports/collection:col-1", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: reviewedBody("download-pdf", reviewFingerprint).toString(),
      }),
    } as never);

    expect(result).toMatchObject({
      ok: false,
      error: "plan_gated",
      feature: "pdf_reports",
      intent: "download-pdf",
      upgradePath: "/app/billing?source=reports#plans",
    });
  });
});

describe("share-pdf rate limit policies", () => {
  it("keeps the bearer token out of rate_limit_events and fails closed", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
    const env = { DB: harness.db } as never;

    const { enforceSharePdfRateLimit, enforceSharePdfDailyCap } =
      await import("~/lib/rate-limit.server");
    const request = new Request(
      "https://0509.io/share/super-secret-token/pdf",
      {
        headers: { "cf-connecting-ip": "203.0.113.7" },
      },
    );

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
    expect(rows.map((row) => row.scope).sort()).toEqual([
      "share-pdf",
      "share-pdf-daily",
    ]);

    // Fail closed without a DB binding — these are the only spend gates.
    const closed = await enforceSharePdfRateLimit(request, {} as never);
    expect(closed?.status).toBe(503);
    harness.close();
  });

  it("blocks the sixth per-IP request in a minute and the 41st sharer render in a day", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
    const env = { DB: harness.db } as never;

    const { enforceSharePdfRateLimit, enforceSharePdfDailyCap } =
      await import("~/lib/rate-limit.server");
    const request = new Request("https://0509.io/share/token-x/pdf", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });

    for (let index = 0; index < 5; index += 1) {
      expect(await enforceSharePdfRateLimit(request, env)).toBeNull();
    }
    const ipBlocked = await enforceSharePdfRateLimit(request, env);
    expect(ipBlocked?.status).toBe(429);

    for (let index = 0; index < 40; index += 1) {
      expect(
        await enforceSharePdfDailyCap(request, env, "sharer-1"),
      ).toBeNull();
    }
    const dailyBlocked = await enforceSharePdfDailyCap(
      request,
      env,
      "sharer-1",
    );
    expect(dailyBlocked?.status).toBe(429);
    // A different sharer's budget is untouched.
    expect(await enforceSharePdfDailyCap(request, env, "sharer-2")).toBeNull();
    harness.close();
  });

  it("atomically admits only five concurrent requests from one viewer IP", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
    const env = {
      DB: withSynchronizedStaleCountReads(harness.db, 12),
    } as never;
    const { enforceSharePdfRateLimit } =
      await import("~/lib/rate-limit.server");
    const request = new Request("https://0509.io/share/token-x/pdf", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () => enforceSharePdfRateLimit(request, env)),
    );

    expect(outcomes.filter((outcome) => outcome === null)).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome?.status === 429)).toHaveLength(
      7,
    );
    const row = harness.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM rate_limit_events WHERE scope = 'share-pdf'",
      )
      .get() as { count: number };
    expect(Number(row.count)).toBe(5);
    harness.close();
  });

  it("atomically admits only forty concurrent render reservations per sharer", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
    const env = {
      DB: withSynchronizedStaleCountReads(harness.db, 50),
    } as never;
    const { enforceSharePdfDailyCap } = await import("~/lib/rate-limit.server");
    const request = new Request("https://0509.io/share/token-x/pdf", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });

    const outcomes = await Promise.all(
      Array.from({ length: 50 }, () =>
        enforceSharePdfDailyCap(request, env, "sharer-1"),
      ),
    );

    expect(outcomes.filter((outcome) => outcome === null)).toHaveLength(40);
    expect(outcomes.filter((outcome) => outcome?.status === 429)).toHaveLength(
      10,
    );
    const row = harness.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM rate_limit_events WHERE scope = 'share-pdf-daily'",
      )
      .get() as { count: number };
    expect(Number(row.count)).toBe(40);
    harness.close();
  });

  it("retains daily-cap events past the short cleanup horizon", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/lib/rate-limit.server.ts", "utf8");
    // The 24h cap only works if cleanup keeps its scope for >= 24h.
    expect(source).toContain("LONG_WINDOW_CLEANUP_SECONDS = 25 * 60 * 60");
    expect(source).toMatch(/share-pdf-daily/);
    expect(source).toMatch(/account-search-daily/);
    // Cleanup derives its scope list from LONG_WINDOW_SCOPES (parameterized),
    // so the daily scopes above cannot drift out of the DELETE statement.
    expect(source).toContain(
      'LONG_WINDOW_SCOPES = new Set(["share-pdf-daily", "account-search-daily"])',
    );
    expect(source).toContain("const longWindowScopes = [...LONG_WINDOW_SCOPES]");
    expect(source).toMatch(/scope NOT IN \(\$\{scopePlaceholders\}\)/);
  });
});
