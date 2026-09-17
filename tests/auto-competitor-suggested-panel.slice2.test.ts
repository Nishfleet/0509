/**
 * Slice-2 (#3175) acceptance tests for the suggested-competitors panel:
 * why + source on every row, plan caps, durable dismissal, and the
 * zero-evidence #2411 fallback. Split out of
 * `tests/auto-competitor-suggested-panel.test.ts` (the #2376 file-size
 * ratchet: the combined file crossed 800 lines); the shared preamble below
 * is that file's, verbatim.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SuggestedCompetitorsPanel } from "~/components/watchlists/suggested-competitors-panel";
import { resolveSuggestedPanelFeedback } from "~/components/watchlists/suggested-competitors-section";
import type { SuggestedCompetitorRow } from "~/lib/auto-competitor-suggested-loader.server";
import type { AppEnv } from "~/lib/env.server";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-07-01T00:00:00.000Z",
  },
  session: { id: "session-1", userId: "user-1", expiresAt: "2027-01-01T00:00:00.000Z" },
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function installMocks({
  brandWebsite = "https://allbirds.com",
  seedAutoCompetitors = vi.fn().mockResolvedValue([]),
  countWatchlists = vi.fn().mockResolvedValue(0),
  getUserPlan = vi.fn().mockResolvedValue("starter" as const),
  createWatchlistWithinLimit = vi.fn(),
}: {
  brandWebsite?: string | null;
  seedAutoCompetitors?: ReturnType<typeof vi.fn>;
  countWatchlists?: ReturnType<typeof vi.fn>;
  getUserPlan?: ReturnType<typeof vi.fn>;
  createWatchlistWithinLimit?: ReturnType<typeof vi.fn>;
} = {}) {
  const env = { DB: {} } as AppEnv;
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn().mockResolvedValue({
      session,
      workspaceUserId: "user-1",
      isMember: false,
    }),
  }));
  vi.doMock("~/lib/data/workspace-branding.server", () => ({
    getWorkspaceBranding: vi.fn().mockResolvedValue({
      brandName: null,
      brandWebsite,
      brandLogo: null,
    }),
  }));
  // Partial mock: only `seedAutoCompetitors` is stubbed. `buildCandidateId`
  // is the REAL export from this module, because the dismissal store keys on
  // it and the panel loader imports it from here — mocking it away would make
  // the suite pass against a fabrication rather than the shipping key shape
  // (onboarding slice 2, #3175).
  vi.doMock("~/lib/auto-competitor-seed.server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("~/lib/auto-competitor-seed.server")>()),
    seedAutoCompetitors,
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan,
    countWatchlists,
    checkPlanLimit: vi.fn(async () => {
      const current = await (countWatchlists as unknown as () => Promise<number>)();
      const limit = current >= 10 ? current : 10;
      return { allowed: current < limit, limit, current };
    }),
  }));
  vi.doMock("~/lib/data.server", () => ({
    createWatchlistWithinLimit,
    normalizeSavedQuery: (input: unknown) => input,
    normalizeSearchFilters: (input: unknown) => input,
    fingerprintSavedQuery: (input: unknown) => JSON.stringify(input),
  }));
  return { env, seedAutoCompetitors, countWatchlists, getUserPlan, createWatchlistWithinLimit };
}

function makeCandidate(overrides: Partial<SuggestedCompetitorRow> = {}): SuggestedCompetitorRow {
  return {
    candidateId: "allbirds-com-123",
    advertiser: "Allbirds",
    pageId: null,
    landingPageUrl: "https://allbirds.com",
    targetCountry: "United States",
    overlapScore: 0.82,
    provenance: "Keyword probe: 'wool runners' \u00d7 United States",
    why: "Runs ads on \u201cwool runners\u201d in United States.",
    source: "ad_keyword_overlap" as const,
    type: "candidate" as const,
    ...overrides,
  };
}

/**
 * Render the panel inside a RouterProvider so the `<Form>` component has a
 * router context. `renderToStaticMarkup` otherwise crashes on
 * `useTransitions` (see fleet-ops#1170-style EISDIR class for the panel
 * version: the Form needs a router even when the form is never submitted).
 */
function renderPanel(props: Parameters<typeof SuggestedCompetitorsPanel>[0]) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: createElement(SuggestedCompetitorsPanel, props),
    },
  ]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * Onboarding epic slice 2 (#3175).
 *
 * Four acceptance bullets live here, and each maps to exactly one `it`:
 *   - every suggestion carries a one-line `why` and its evidence `source`;
 *   - the plan caps are enforced per plan (Free = frozen snapshot, Scout+ =
 *     per-plan cap);
 *   - removing a suggestion records a durable dismissal, and the dismissal
 *     filters the row out of every future derivation;
 *   - a brand with zero evidence falls back to the #2411 adjacent brands.
 *
 * The zero-evidence fallback's own `no_ads` rendering has its own suite
 * (`tests/first-brief*`); this pins only that the SUGGESTIONS surface reaches
 * for it rather than rendering nothing.
 */
describe("slice 2 — why + source on every suggestion (#3175)", () => {
  it("carries a non-empty why and a typed source through to every row", async () => {
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        {
          advertiser: "Rothy's",
          advertiserPageId: "111",
          registrableDomain: "rothys.com",
          overlapScore: 3,
          provenance: "meta_ad_library_keyword_probe: keyword:\"wool runners\".",
          why: "Runs ads on “wool runners” in United States.",
          source: "landing_page_seed" as const,
          countries: ["United States"],
          matchedKeywords: ["wool runners"],
        },
      ]),
    });
    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "starter");
    expect(result!.rows.length).toBe(1);
    const row = result!.rows[0]!;
    expect(row.why).toBe("Runs ads on “wool runners” in United States.");
    expect(row.source).toBe("landing_page_seed");
    // The provenance sentence is still there alongside the short line: the
    // `why` is the customer-facing summary, not a replacement for the receipt.
    expect(row.provenance.length).toBeGreaterThan(0);
  });
});

describe("slice 2 — plan caps per plan (#3175)", () => {
  it("enforces the visible cap per plan (Scout 3, Starter 8 via the ceiling)", async () => {
    const { getCompetitorSuggestionCaps } = await import("~/lib/plan-entitlements");
    expect(getCompetitorSuggestionCaps("scout").visible).toBe(3);
    expect(getCompetitorSuggestionCaps("starter").visible).toBe(8);
    expect(getCompetitorSuggestionCaps("agency").visible).toBe(8);
    expect(getCompetitorSuggestionCaps("scout").frozen).toBe(false);
  });

  it("gives free a frozen snapshot with nothing tracked continuously", async () => {
    const { getCompetitorSuggestionCaps } = await import("~/lib/plan-entitlements");
    const caps = getCompetitorSuggestionCaps("free");
    expect(caps.frozen).toBe(true);
    expect(caps.tracked).toBe(0);
    expect(caps.visible).toBeGreaterThan(0);
  });

  it("clips Scout's rows to its 3-slot cap and never exceeds the plan watchlist limit", async () => {
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue(
        Array.from({ length: 12 }).map((_, index) => ({
          advertiser: `Brand ${String(index).padStart(2, "0")}`,
          advertiserPageId: null,
          registrableDomain: `brand${index}.com`,
          overlapScore: 100 - index,
          provenance: `Keyword probe: 'term ${index}'.`,
          why: "Runs ads on the same terms as you.",
          source: "ad_keyword_overlap" as const,
          countries: ["United States"],
          matchedKeywords: [`term ${index}`],
        })),
      ),
    });
    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const scout = await fresh({} as AppEnv, "user-1", "scout");
    expect(scout!.rows.length).toBe(3);
    // The cap can never promise more continuous tracking than the plan's own
    // watchlist limit will honour.
    expect(scout!.caps.visible).toBeLessThanOrEqual(scout!.caps.tracked);
  });

  it("renders free's rows read-only (no add button, snapshot notice) and paid's rows addable", () => {
    const row = makeCandidate({ candidateId: "row-1", advertiser: "Rothy's" });
    const frozenHtml = renderPanel({
      domain: "allbirds.com",
      rows: [row],
      caps: { visible: 5, tracked: 0, frozen: true },
      feedback: null,
      pending: false,
      pendingCandidateId: null,
    });
    expect(frozenHtml).toContain('data-test="suggested-frozen"');
    expect(frozenHtml).not.toContain("Add as competitor");

    const paidHtml = renderPanel({
      domain: "allbirds.com",
      rows: [row],
      caps: { visible: 8, tracked: 10, frozen: false },
      feedback: null,
      pending: false,
      pendingCandidateId: null,
    });
    expect(paidHtml).toContain("Add as competitor");
    expect(paidHtml).toContain("Remove");
    expect(paidHtml).not.toContain('data-test="suggested-frozen"');
  });

  it("renders the one-line why and a named source badge per row", () => {
    const html = renderPanel({
      domain: "allbirds.com",
      rows: [
        makeCandidate({
          candidateId: "row-1",
          advertiser: "Rothy's",
          why: "Runs ads on “wool runners” in United States.",
          source: "ad_keyword_overlap",
        }),
      ],
      caps: { visible: 8, tracked: 10, frozen: false },
      feedback: null,
      pending: false,
      pendingCandidateId: null,
    });
    expect(html).toContain('data-test="suggested-why"');
    expect(html).toContain("Runs ads on ");
    expect(html).toContain('data-test="suggested-source"');
    expect(html).toContain('data-source="ad_keyword_overlap"');
    expect(html).toContain("From your ads");
  });
});

describe("slice 2 — removal never re-suggests (#3175)", () => {
  it("records a durable dismissal for a live candidate", async () => {
    const dismissCompetitorSuggestion = vi.fn().mockResolvedValue(true);
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        {
          advertiser: "Rothy's",
          advertiserPageId: null,
          registrableDomain: "rothys.com",
          overlapScore: 3,
          provenance: "Keyword probe: 'wool runners'.",
          why: "Runs ads on the same terms as you.",
          source: "ad_keyword_overlap" as const,
          countries: ["United States"],
          matchedKeywords: ["wool runners"],
        },
      ]),
    });
    vi.doMock("~/lib/competitor-suggestion-dismissal.server", async (importOriginal) => ({
      ...(await importOriginal<
        typeof import("~/lib/competitor-suggestion-dismissal.server")
      >()),
      dismissCompetitorSuggestion,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const body = new FormData();
    body.set("intent", "dismiss-suggested-competitor");
    // Derived from the real builder, not hand-written: the dismissal key shape
    // is the thing under test, so a hard-coded literal could pass while the
    // shipping key drifted.
    const { buildCandidateId } = await import("~/lib/auto-competitor-seed.server");
    const key = buildCandidateId({
      advertiser: "Rothy's",
      registrableDomain: "rothys.com",
      advertiserPageId: null,
    });
    body.set("candidateId", key);
    const result = (await action({
      context: {},
      request: new Request("https://fivetonine.app/app/watchlists", {
        method: "POST",
        body,
      }),
      params: {},
    } as never)) as { ok?: boolean; dismissedCandidateId?: string };

    expect(result.ok).toBe(true);
    expect(result.dismissedCandidateId).toBe(key);
    expect(dismissCompetitorSuggestion).toHaveBeenCalledTimes(1);
    expect(dismissCompetitorSuggestion.mock.calls[0]?.[1]).toMatchObject({
      userId: "user-1",
      candidateKey: key,
      candidateLabel: "Rothy's",
    });
  });

  it("refuses to dismiss a candidate that is not in the latest sweep", async () => {
    const dismissCompetitorSuggestion = vi.fn();
    installMocks({ seedAutoCompetitors: vi.fn().mockResolvedValue([]) });
    vi.doMock("~/lib/competitor-suggestion-dismissal.server", async (importOriginal) => ({
      ...(await importOriginal<
        typeof import("~/lib/competitor-suggestion-dismissal.server")
      >()),
      dismissCompetitorSuggestion,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const body = new FormData();
    body.set("intent", "dismiss-suggested-competitor");
    body.set("candidateId", "ghost|ghost.com|");
    const result = (await action({
      context: {},
      request: new Request("https://fivetonine.app/app/watchlists", {
        method: "POST",
        body,
      }),
      params: {},
    } as never)) as { ok?: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toBe("candidate_unknown");
    expect(dismissCompetitorSuggestion).not.toHaveBeenCalled();
  });

  it("surfaces the removal in the panel feedback (never a silent success)", () => {
    const feedback = resolveSuggestedPanelFeedback({
      ok: true,
      message: "Removed Rothy's. We won't suggest it again.",
      dismissedCandidateId: "rothys|rothys.com|",
    });
    expect(feedback).not.toBeNull();
    expect(feedback!.ok).toBe(true);
    expect(feedback!.message).toContain("won't suggest it again");
  });
});

describe("slice 2 — zero-evidence adjacent-brand fallback (#3175, #2411)", () => {
  it("offers the same-category adjacent brands when the seed finds nothing", async () => {
    installMocks({ seedAutoCompetitors: vi.fn().mockResolvedValue([]) });
    vi.doMock("~/lib/ads-internal-links.server", () => ({
      loadIndexableAdsInternalLinks: vi.fn().mockResolvedValue([
        { name: "Rothy's", domain: "rothys.com", path: "/ads/rothys.com" },
        { name: "Vivaia", domain: "vivaia.com", path: "/ads/vivaia.com" },
        { name: "Allbirds", domain: "allbirds.com", path: "/ads/allbirds.com" },
      ]),
    }));

    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "starter");

    // Honest fallback, not an empty panel: rows exist, each says plainly that
    // it is a neighbouring brand rather than evidence from the customer's ads.
    expect(result!.rows.length).toBeGreaterThan(0);
    for (const row of result!.rows) {
      expect(row.source).toBe("adjacent_brand_fallback");
      expect(row.why).toContain("neighbour");
    }
    // The customer's own brand is never offered back to them.
    expect(result!.rows.map((row) => row.landingPageUrl)).not.toContain(
      "https://allbirds.com",
    );
  });

  it("still renders the honest empty state when the fallback has nothing either", async () => {
    installMocks({ seedAutoCompetitors: vi.fn().mockResolvedValue([]) });
    vi.doMock("~/lib/ads-internal-links.server", () => ({
      loadIndexableAdsInternalLinks: vi.fn().mockResolvedValue([]),
    }));

    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "starter");
    expect(result!.rows).toEqual([]);
  });
});
