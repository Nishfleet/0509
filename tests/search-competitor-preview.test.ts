import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchCompetitorPreviewSection } from "~/components/watchlists/suggested-competitors-section";
import type {
  SuggestedCompetitorRow,
  SuggestedCompetitorsPanelData,
} from "~/lib/auto-competitor-suggested-loader.server";
import type { AdRecord } from "~/lib/types";

/**
 * Issue #2113 — "who advertises against you" on logged-out /search domain
 * queries.
 *
 * Deterministic coverage for the issue's two required assertions:
 *
 *   1. A logged-out DOMAIN query runs the existing suggested-competitors
 *      discovery phase server-side and the payload carries the top-5 rows
 *      (the panel + signup CTA render from them).
 *   2. A logged-out NON-DOMAIN query does not — no discovery call, no
 *      panel.
 *
 * Plus the honesty guards the issue's must-not list pins: a signed-in
 * session never gets the logged-out preview, an empty discovery comes back
 * as zero rows (never a fabricated suggestion), and a discovery failure
 * degrades to "no preview" instead of taking the public search page down.
 *
 * The seed function (`~/lib/auto-competitor-seed.server`) is mocked in the
 * loader tests — this suite pins the /search wiring (when the phase runs,
 * how rows are capped and shaped), not the discovery itself, which has its
 * own integration coverage under tests/integration/.
 */

type SearchLoaderPayload = {
  competitorPreview?: SuggestedCompetitorsPanelData | null;
  session?: unknown;
  filters?: { query?: string; country?: string };
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

const baseAd: AdRecord = {
  metaAdId: "meta-nykaa-1",
  advertiser: "Nykaa",
  body: "Glow sale live.",
  previewHeadline: "Glow sale",
  previewSubhead: "Up to 40% off",
  hook: "Glow sale live.",
  offer: "Up to 40% off",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: null,
  adSnapshotUrl: "https://cdn.example.com/meta-nykaa-1.png",
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta",
  analysisFields: [],
};

const appSession = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
};

function makeSeedCandidate(
  advertiser: string,
  domain: string,
  overlapScore: number,
) {
  return {
    advertiser,
    advertiserPageId: null,
    registrableDomain: domain,
    overlapScore,
    provenance: `meta_ad_library_keyword_probe: keyword:"glow sale" country:"United States". Candidates are only advertisers with active ads on the searched terms.`,
    countries: ["United States"],
    matchedKeywords: ["glow sale"],
  };
}

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function installLoaderMocks({
  session = null,
  seedAutoCompetitors = vi.fn().mockResolvedValue([]),
}: {
  session?: typeof appSession | null;
  seedAutoCompetitors?: ReturnType<typeof vi.fn>;
} = {}) {
  const env = { DB: {} };
  const sourceResult = {
    ads: [baseAd],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    discoveryStatus: "healthy",
    discoverySummary: null,
    discoveryFailureClass: null,
  };

  vi.doMock("~/lib/auth.server", () => ({
    getOptionalSession: vi.fn().mockResolvedValue(session),
  }));
  vi.doMock("~/lib/workspace.server", () => ({
    resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
      workspaceUserId: id,
      isMember: false,
      ownerName: null,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    listCollections: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock("~/lib/customer-meta.server", () => ({
    getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue("starter"),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
    enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
    enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
  }));
  vi.doMock("~/lib/search-selection.server", () => ({
    prepareSearchResultSelection: vi.fn().mockResolvedValue({
      result: sourceResult,
      selectedAd: baseAd,
    }),
  }));
  // Partial mock: `buildCandidateId` must stay REAL. The search preview route
  // imports it from this module (the dismissal store keys on the same string),
  // and mocking it away makes the route's own import throw — which its catch
  // would swallow into a silent "no preview" (onboarding slice 2, #3175).
  vi.doMock("~/lib/auto-competitor-seed.server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("~/lib/auto-competitor-seed.server")>()),
    seedAutoCompetitors,
  }));

  return { env, seedAutoCompetitors };
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
    requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
    emailUnverifiedActionResult: () => ({
      ok: false,
      error: "email_unverified",
      message: "Verify your email",
    }),
    requestEmailVerification: vi.fn().mockResolvedValue({ ok: true }),
    EMAIL_UNVERIFIED_ERROR: "email_unverified",
    EMAIL_UNVERIFIED_MESSAGE: "Verify your email",
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("search loader competitor preview (issue #2113)", () => {
  it("runs the suggested-competitors discovery phase for a logged-out domain query and caps the preview at 5 rows", async () => {
    const seedAutoCompetitors = vi.fn().mockResolvedValue([
      makeSeedCandidate("Rothy's", "rothys.com", 6),
      makeSeedCandidate("Vivaia", "vivaia.com", 5),
      makeSeedCandidate("Allbirds", "allbirds.com", 4),
      makeSeedCandidate("Atmosphere", "atmosphere.com", 3),
      makeSeedCandidate("Cariuma", "cariuma.com", 2),
      makeSeedCandidate("Oncept", "oncept.com", 1),
    ]);
    const { env } = installLoaderMocks({ seedAutoCompetitors });

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?website=https://www.nykaa.com"),
    } as never);

    // The existing discovery phase ran server-side against the searched
    // registrable domain, inside the visitor's country scope.
    expect(seedAutoCompetitors).toHaveBeenCalledTimes(1);
    expect(seedAutoCompetitors).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        domain: "nykaa.com",
        country: "all",
      }),
    );

    // The payload carries the top 5 (never more), each a candidate-typed
    // row with provenance — never a confirmed competitor.
    expect(result.competitorPreview).not.toBeNull();
    expect(result.competitorPreview!.domain).toBe("nykaa.com");
    expect(result.competitorPreview!.rows.length).toBe(5);
    expect(result.competitorPreview!.rows.map((row) => row.advertiser)).toEqual([
      "Rothy's",
      "Vivaia",
      "Allbirds",
      "Atmosphere",
      "Cariuma",
    ]);
    for (const row of result.competitorPreview!.rows) {
      expect(row.type).toBe("candidate");
      expect(typeof row.provenance).toBe("string");
      expect(row.provenance.length).toBeGreaterThan(0);
    }
  });

  it("treats a bare domain typed into the query box (q=nykaa.com) as a domain query", async () => {
    const seedAutoCompetitors = vi
      .fn()
      .mockResolvedValue([makeSeedCandidate("Rothy's", "rothys.com", 6)]);
    installLoaderMocks({ seedAutoCompetitors });

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(),
      request: new Request("http://localhost/search?q=nykaa.com"),
    } as never);

    expect(seedAutoCompetitors).toHaveBeenCalledTimes(1);
    expect(result.competitorPreview).not.toBeNull();
    expect(result.competitorPreview!.domain).toBe("nykaa.com");
    expect(result.competitorPreview!.rows.length).toBe(1);
  });

  it("does not run the discovery phase for a logged-out non-domain query", async () => {
    const seedAutoCompetitors = vi.fn().mockResolvedValue([]);
    installLoaderMocks({ seedAutoCompetitors });

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(),
      request: new Request("http://localhost/search?q=nykaa"),
    } as never);

    expect(seedAutoCompetitors).not.toHaveBeenCalled();
    expect(result.competitorPreview).toBeNull();
  });

  it("never runs the logged-out preview for a signed-in session", async () => {
    const seedAutoCompetitors = vi.fn().mockResolvedValue([]);
    installLoaderMocks({ session: appSession, seedAutoCompetitors });

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(),
      request: new Request("http://localhost/search?website=https://www.nykaa.com"),
    } as never);

    expect(seedAutoCompetitors).not.toHaveBeenCalled();
    expect(result.competitorPreview).toBeNull();
  });

  it("returns zero rows (never a fabricated suggestion) when discovery finds nothing", async () => {
    const seedAutoCompetitors = vi.fn().mockResolvedValue([]);
    installLoaderMocks({ seedAutoCompetitors });

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(),
      request: new Request("http://localhost/search?website=https://www.nykaa.com"),
    } as never);

    expect(result.competitorPreview).not.toBeNull();
    expect(result.competitorPreview!.rows).toEqual([]);
  });

  it("degrades to no preview (never a failed search page) when the discovery phase throws", async () => {
    const seedAutoCompetitors = vi
      .fn()
      .mockRejectedValue(new Error("D1 unavailable"));
    installLoaderMocks({ seedAutoCompetitors });

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(),
      request: new Request("http://localhost/search?website=https://www.nykaa.com"),
    } as never);

    expect(result.competitorPreview).toBeNull();
  });
});

function makeRow(overrides: Partial<SuggestedCompetitorRow> = {}): SuggestedCompetitorRow {
  return {
    candidateId: "rothys|rothys.com|",
    advertiser: "Rothy's",
    pageId: null,
    landingPageUrl: "https://rothys.com",
    targetCountry: "United States",
    overlapScore: 0.84,
    provenance:
      "meta_ad_library_keyword_probe: keyword:\"glow sale\" country:\"United States\". Candidates are only advertisers with active ads on the searched terms.",
    type: "candidate" as const,
    ...overrides,
  };
}

/**
 * Render the section inside a RouterProvider so the `<Link>` components have
 * a router context (same constraint as the signed-in panel's `<Form>`).
 */
function renderSection(props: {
  preview: SuggestedCompetitorsPanelData | null;
  country: string;
  handoffToken?: string | null;
}) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: createElement(SearchCompetitorPreviewSection, {
        ...props,
        handoffToken: props.handoffToken ?? null,
      }),
    },
  ]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("SearchCompetitorPreviewSection rendering (issue #2113)", () => {
  it("shows the panel with every suggested competitor and the signup CTA on a logged-out domain search", () => {
    const rows = [
      makeRow({ candidateId: "rothys|rothys.com|", advertiser: "Rothy's", landingPageUrl: "https://rothys.com" }),
      makeRow({ candidateId: "vivaia|vivaia.com|", advertiser: "Vivaia", landingPageUrl: "https://vivaia.com" }),
      makeRow({ candidateId: "allbirds|allbirds.com|", advertiser: "Allbirds", landingPageUrl: "https://allbirds.com" }),
      makeRow({ candidateId: "atmosphere|atmosphere.com|", advertiser: "Atmosphere", landingPageUrl: "https://atmosphere.com" }),
      makeRow({ candidateId: "cariuma|cariuma.com|", advertiser: "Cariuma", landingPageUrl: "https://cariuma.com" }),
    ];
    const html = renderSection({
      preview: { domain: "nykaa.com", rows },
      country: "all",
    });

    expect(html).toContain('data-test="competitor-preview-panel"');
    expect(html).toContain("Who advertises against you");
    // All five suggested competitors render, each with the honesty marker.
    expect((html.match(/data-test="competitor-preview-row"/g) ?? []).length).toBe(5);
    expect((html.match(/Suggested · unverified/g) ?? []).length).toBe(5);
    for (const advertiser of ["Rothy", "Vivaia", "Allbirds", "Atmosphere", "Cariuma"]) {
      expect(html).toContain(advertiser);
    }
    // Candidate rows are never rendered as confirmed competitors.
    expect(html).toContain('data-candidate-type="candidate"');
    expect(html).not.toContain('data-candidate-type="confirmed"');
    // The signup moment: one panel-level CTA into /auth/signup carrying the
    // searched domain into the post-signup setup checklist.
    expect(html).toContain('data-test="competitor-preview-cta"');
    expect(html).toContain("Create a free account to watch these 5 competitors");
    expect(html).toContain("/auth/signup?redirectTo=");
    expect(html).toContain("website%3Dnykaa.com");
    // Each row's Watch link carries THAT competitor's domain (the nested
    // /app?website= URL is percent-encoded inside redirectTo).
    expect(html).toContain("website%3Dhttps%253A%252F%252Frothys.com");
  });

  it("renders nothing (no fabricated suggestion) when discovery returned zero candidates", () => {
    const html = renderSection({
      preview: { domain: "nykaa.com", rows: [] },
      country: "all",
    });

    expect(html).not.toContain("competitor-preview");
    expect(html).not.toContain("/auth/signup");
  });

  it("renders nothing when the loader produced no preview (non-domain query or signed-in session)", () => {
    const html = renderSection({ preview: null, country: "all" });

    expect(html).not.toContain("competitor-preview");
    expect(html).not.toContain("/auth/signup");
  });

  it("renders the selectable handoff panel with a pick-aware signup CTA when a handoff token is present (issue #2174)", () => {
    const rows = [
      makeRow({ candidateId: "rothys|rothys.com|", advertiser: "Rothy's", landingPageUrl: "https://rothys.com" }),
      makeRow({ candidateId: "vivaia|vivaia.com|", advertiser: "Vivaia", landingPageUrl: "https://vivaia.com" }),
      makeRow({ candidateId: "allbirds|allbirds.com|", advertiser: "Allbirds", landingPageUrl: "https://allbirds.com" }),
    ];
    const html = renderSection({
      preview: { domain: "nykaa.com", rows },
      country: "all",
      handoffToken: "signed-token-abc",
    });

    expect(html).toContain('data-test="competitor-preview-panel"');
    // Every row renders a selectable checkbox (all checked by default).
    expect((html.match(/data-test="competitor-preview-select"/g) ?? []).length).toBe(3);
    // The CTA carries the handoff token + the default pick (all indexes).
    // The pick is a comma-separated list inside the redirectTo query, which
    // is itself URL-encoded as the signup `redirectTo` param — so the commas
    // appear double-encoded (`%252C`).
    expect(html).toContain("handoff%3Dsigned-token-abc");
    expect(html).toContain("pick%3D0%252C1%252C2");
    expect(html).toContain("Create a free account to watch 3 competitors");
    // The honesty marker is preserved on every selectable row.
    expect((html.match(/Suggested · unverified/g) ?? []).length).toBe(3);
  });
});
