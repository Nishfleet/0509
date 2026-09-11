// Issue #2987 — the anonymous /search document must not carry the internal
// analysis structure (per-field confidence, extractorVersion, classifier
// metadata scriptSignals/decisionReason, capture metadata). Gate: the loader
// projects for anonymous requests and keeps the internal structure intact
// for signed-in ones.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";

import type { AdRecord, SearchResponse } from "~/lib/types";

type SearchLoaderPayload = {
  result?: unknown;
  selectedAd?: unknown;
};

function isDataWithResponseInit(
  value: unknown,
): value is { type: string; data: SearchLoaderPayload } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "DataWithResponseInit" &&
    "data" in value
  );
}

async function unwrapLoaderResult(
  loaderFn: (args: LoaderFunctionArgs) => Promise<unknown>,
  args: LoaderFunctionArgs,
): Promise<SearchLoaderPayload> {
  const out = await loaderFn(args);
  if (out instanceof Response) {
    return (await out.json()) as SearchLoaderPayload;
  }
  if (isDataWithResponseInit(out)) return out.data;
  return out as SearchLoaderPayload;
}

function internalAd(metaAdId: string): Record<string, unknown> {
  return {
    metaAdId,
    advertiser: "boAt",
    body: "Bass bhi, battery bhi.",
    previewHeadline: "Bass bhi. Battery bhi.",
    previewSubhead: "Launch pricing",
    hook: "Bass bhi. Battery bhi.",
    offer: "Launch pricing",
    cta: "Buy now",
    format: "image",
    languageLabel: "Hinglish",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta",
    analysisFields: [
      {
        scopeType: "ad",
        fieldKey: "ocr_text",
        fieldValue: "Bass bhi",
        provenanceSource: "landing_page",
        extractorVersion: "extract-v7/BETA-INTERNAL-TUNING",
        confidence: 0.91,
        metadata: {
          scriptSignals: { latin: 5, devanagari: 4 },
          decisionReason: "devanagari_dominant",
        },
      },
      {
        scopeType: "ad",
        fieldKey: "cta_read",
        fieldValue: "internal CTA reasoning chain",
        provenanceSource: "landing_page",
        extractorVersion: "extract-v7/BETA-INTERNAL-TUNING",
        confidence: 0.72,
        metadata: { decisionReason: "internal-only" },
      },
    ],
    creativeTextMetadata: { captureProbe: "internal-probe-details" },
    landingPage: {
      rawUrl: "https://boat-lifestyle.com",
      canonicalUrl: "https://boat-lifestyle.com",
      rawHeadline: "Bass. Battery.",
      normalizedHeadline: "bass battery",
      normalizedHeadlineHash: "hash",
      captureMethod: "browser",
      capturedAt: "2026-09-11T00:00:00.000Z",
      metadata: { probeHints: "internal" },
    },
    domainMatch: {
      level: "likely",
      reason: "matched via page-name heuristic",
      matchedDomain: "boat-lifestyle.com",
    },
  };
}

const internalResult: SearchResponse = {
  ads: [internalAd("meta-boat-1"), { ...internalAd("meta-boat-2") }],
} as unknown as SearchResponse;

function loaderArgs(
  session: unknown,
  url = "http://localhost/search?q=boat",
): LoaderFunctionArgs {
  return {
    context: {
      cloudflare: { env: { DB: {} } },
    },
    request: new Request(url),
  } as never;
}

type ProjectedPayload = {
  result?: { ads?: Array<Record<string, unknown>> };
  selectedAd?: Record<string, unknown> | null;
};

async function runLoader(
  mockSession: unknown,
): Promise<ProjectedPayload> {
  vi.resetModules();
  vi.doMock("~/lib/auth.server", () => ({
    getOptionalSession: vi.fn().mockResolvedValue(mockSession),
  }));
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
    requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
    emailUnverifiedActionResult: () => ({ ok: false, error: "email_unverified" }),
    requestEmailVerification: vi.fn().mockResolvedValue({ ok: true }),
    EMAIL_UNVERIFIED_ERROR: "email_unverified",
    EMAIL_UNVERIFIED_MESSAGE: "Verify your email",
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({ DB: {} })),
  }));
  vi.doMock("~/lib/data.server", () => ({
    listCollections: vi.fn(async () => []),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    searchAdsViaSourceResolver: vi.fn(async () => internalResult),
  }));
  vi.doMock("~/lib/customer-meta.server", () => ({
    getCustomerMetaAdLibraryToken: vi.fn(async () => null),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn(async () => null),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicSearchRateLimit: vi.fn(async () => null),
    enforceAuthenticatedSearchRateLimit: vi.fn(async () => null),
    enforceSearchSelectionRateLimit: vi.fn(async () => null),
    rateLimitHeadersForTests: vi.fn(() => ({})),
  }));
  vi.doMock("~/lib/search-execution.server", () => ({
    attachKeywordSearchDomainMatch: vi.fn(async () => internalResult),
    executeSearchWithRelevance: vi.fn(async () => ({
      result: internalResult,
      query: {},
      searchScope: "exact",
      displayDomain: null,
      relevanceApplied: false,
    })),
    shouldApplySearchV2: vi.fn(() => false),
    shouldRunSearchV2Shadow: vi.fn(() => false),
    hasWarmSearchCacheEntry: vi.fn(async () => false),
  }));
  vi.doMock("~/lib/search-selection.server", () => ({
    prepareSearchResultSelection: vi.fn(async () => ({
      result: internalResult,
      selectedAd: internalAd("meta-boat-1"),
      selectionEnrichmentPending: false,
      landingPageCaptureFailure: null,
    })),
  }));

  const { loader } = await import("~/routes/search");
  const raw = await loader(loaderArgs(mockSession));
  if (raw instanceof Response) {
    return (await raw.json()) as ProjectedPayload;
  }
  const maybe = raw as { type?: string; data?: ProjectedPayload };
  if (maybe?.type === "DataWithResponseInit" && maybe.data) {
    return maybe.data;
  }
  return raw as ProjectedPayload;
}

// Signed-in stubs reused for both branches (plan lookups tolerate failure).
function stubSignedInSession() {
  return {
    user: { id: "user-1", email: "owner@example.com", name: "Owner" },
    session: { id: "s1", userId: "user-1", expiresAt: "2099-01-01T00:00:00Z" },
  };
}

afterEach(() => {
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/email-verification.server");
  vi.doUnmock("~/lib/search-execution.server");
  vi.doUnmock("~/lib/search-selection.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

function leakFindings(obj: unknown): string[] {
  const serialized = JSON.stringify(obj) ?? "";
  const needles = [
    "extract-v7/BETA-INTERNAL-TUNING",
    "scriptSignals",
    "decisionReason",
    '"confidence"',
    "captureProbe",
  ];
  return needles.filter((needle) => serialized.includes(needle));
}

describe("issue 2987 — anonymous /search payload projection", () => {
  it("anonymous document: internal analysis structure is stripped", async () => {
    const payload = await runLoader(null);
    const ads = payload.result?.ads ?? [];
    expect(ads.length).toBeGreaterThan(0);
    // UI-relevant public fields survive.
    const projected = ads[0] as Record<string, unknown>;
    expect((projected.analysisFields as unknown[]).length).toBe(1);
    const field = (projected.analysisFields as Array<Record<string, unknown>>)[0];
    expect(field.fieldKey).toBe("ocr_text");
    expect(field.fieldValue).toBe("Bass bhi");
    expect(field.confidence).toBeUndefined();
    expect(field.metadata).toBeUndefined();
    expect(String((field as { extractorVersion?: string }).extractorVersion)).not.toContain("extract-v7");
    expect(projected.creativeTextMetadata).toBeNull();
    expect(
      ((projected.landingPage as Record<string, unknown>) ?? {}).metadata,
    ).toBeUndefined();
    expect(leakFindings(payload)).toEqual([]);
  });

  it("signed-in document: internal analysis structure is kept", async () => {
    const payload = await runLoader(stubSignedInSession());
    const ads = payload.result?.ads ?? [];
    const kept = ads[0] as Record<string, unknown>;
    expect((kept.analysisFields as unknown[]).length).toBe(2);
    expect(kept.creativeTextMetadata).not.toBeNull();
    expect(
      ((kept.landingPage as Record<string, unknown>) ?? {}).metadata,
    ).toBeDefined();
    // The signed-in surface keeps the internal markers the anonymous surface
    // strips — the leak needles must be PRESENT here.
    expect(leakFindings(payload)).toEqual([
      "extract-v7/BETA-INTERNAL-TUNING",
      "scriptSignals",
      "decisionReason",
      '"confidence"',
      "captureProbe",
    ]);
  });

  // Issue #2987 acceptance: measure payload size before/after the projection.
  // A realistic 10-ad synthetic payload with a full internal analysis
  // structure must shrink substantially on the anonymous surface.
  it("anonymous payload shrinks materially vs the un-projected payload", async () => {
    const internalProjection = await import(
      "~/lib/search-public-projection.server"
    );
    // Real extracted ads carry far more internal analysis than the two-leaf
    // stub above: dozens of analysed fields, each with confidence, provenance
    // and classifier metadata. Mirror that here so the size measurement is
    // honest — only ocr_text/translated_text survive the projection.
    const withHeavyAnalysis = (metaAdId: string): AdRecord => {
      const ad = JSON.parse(JSON.stringify(internalAd(metaAdId))) as Record<
        string,
        unknown
      > & { analysisFields: Array<Record<string, unknown>> };
      for (let i = 0; i < 24; i += 1) {
        ad.analysisFields.push({
          scopeType: "ad",
          fieldKey: `internal_analysis_dim_${i}`,
          fieldValue: `internal reasoning chain #${i}: weighted keyword evidence, extractor arbitration trace,模型 disagreement notes`,
          provenanceSource: "landing_page",
          extractorVersion: "extract-v7/BETA-INTERNAL-TUNING",
          confidence: 0.61,
          metadata: {
            scriptSignals: { latin: 5, devanagari: 4, mixed: 2 },
            decisionReason: "devanagari_dominant_fallback_arbitration",
          },
        });
      }
      return ad as unknown as AdRecord;
    };
    const heavyResult = {
      ads: Array.from({ length: 10 }, (_, i) =>
        withHeavyAnalysis(`meta-boat-${i}`),
      ),
    } as unknown as SearchResponse;
    const before = JSON.stringify({
      result: heavyResult,
      selectedAd: withHeavyAnalysis("meta-boat-1"),
    });
    const projectedPayload = internalProjection.projectAnonymousSearchPayload({
      result: heavyResult,
      selectedAd: withHeavyAnalysis("meta-boat-1"),
    });
    const after = JSON.stringify(projectedPayload);
    expect(Buffer.byteLength(after)).toBeLessThan(Buffer.byteLength(before) * 0.6);
  });
});
