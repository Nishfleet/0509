import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SuggestedCompetitorsPanel } from "~/components/watchlists/suggested-competitors-panel";
import { resolveSuggestedPanelFeedback } from "~/components/watchlists/suggested-competitors-section";
import {
  loadSuggestedCompetitorsPanel,
  type SuggestedCompetitorRow,
} from "~/lib/auto-competitor-suggested-loader.server";
import { buildCompetitorImportPreview } from "~/lib/competitor-import";
import type { AppEnv } from "~/lib/env.server";

/**
 * Auto-competitor-watch Phase 2 (#1370): deterministic tests for the
 * suggested-competitors panel surface + honesty labels + cap-respect.
 *
 * The Phase 1 seed function (`~/lib/auto-competitor-seed.server`) is
 * mocked here — Phase 2's contract is the SHAPING and the RENDER of the
 * panel, not the discovery itself. Phase 1's contract has its own
 * integration test under `tests/integration/` (workerd/D1). Mocking the
 * seed function keeps this suite on the `node` project (fast, no D1) so
 * the deterministic-required termination command exits 0 without paying
 * the workerd cost.
 *
 * The four deterministic-required assertions from the issue:
 *   1. The loader returns only candidates (type "candidate"), never rows
 *      typed as confirmed competitors.
 *   2. Every rendered candidate carries a provenance string and an
 *      overlapScore.
 *   3. The one-click add calls createWatchlistWithinLimit (the existing
 *      path) and respects checkPlanLimit — over-cap returns a named reason,
 *      never silently admits.
 *   4. An empty candidate set renders an honest empty state, never a
 *      fabricated suggestion (honesty eval 3.4: 100%).
 *
 * The free-plan paid-tier gate is also pinned here so the loader returns
 * null and the panel omits itself entirely.
 */

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

describe("loadSuggestedCompetitorsPanel", () => {
  it("shows free plans a FROZEN snapshot instead of nothing (slice 2, #3175)", async () => {
    // Free used to get `null` (no panel at all). Slice 2 reverses that: the
    // evidence is real and worth showing, so free sees the discovered set with
    // `frozen: true` and `tracked: 0`, and the panel renders it read-only.
    installMocks({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        {
          advertiser: "Rothy's",
          advertiserPageId: null,
          registrableDomain: "rothys.com",
          overlapScore: 3,
          provenance: "Keyword probe: 'wool runners' \u00d7 United States",
          why: "Runs ads on \u201cwool runners\u201d in United States.",
          source: "ad_keyword_overlap" as const,
          countries: ["United States"],
          matchedKeywords: ["wool runners"],
        },
      ]),
    });
    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "free");
    expect(result).not.toBeNull();
    expect(result!.caps.frozen).toBe(true);
    expect(result!.caps.tracked).toBe(0);
    expect(result!.rows.length).toBe(1);
  });

  it("returns only candidates (type 'candidate') — never 'confirmed' rows", async () => {
    const seedAutoCompetitors = vi.fn().mockResolvedValue([
      {
        advertiser: "Rothy's",
        advertiserPageId: null,
        registrableDomain: "rothys.com",
        overlapScore: 0.84,
        provenance: "Keyword probe: 'wool runners' \u00d7 United States",
        why: "Runs ads on the same terms as you.",
        source: "ad_keyword_overlap" as const,
        countries: ["United States"],
        matchedKeywords: ["wool runners"],
      },
      {
        advertiser: "Vivaia",
        advertiserPageId: null,
        registrableDomain: "vivaia.com",
        overlapScore: 0.71,
        provenance: "Keyword probe: 'wool shoes' \u00d7 United States",
        why: "Runs ads on the same terms as you.",
        source: "ad_keyword_overlap" as const,
        countries: ["United States"],
        matchedKeywords: ["wool shoes"],
      },
    ]);
    installMocks({ seedAutoCompetitors });

    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "starter");
    expect(result).not.toBeNull();
    expect(result!.rows.length).toBe(2);
    for (const row of result!.rows) {
      expect(row.type).toBe("candidate");
    }
  });

  it("every shaped candidate carries a provenance string and a numeric overlapScore", async () => {
    const seedAutoCompetitors = vi.fn().mockResolvedValue([
      {
        advertiser: "Rothy's",
        advertiserPageId: null,
        registrableDomain: "rothys.com",
        overlapScore: 0.84,
        provenance: "Keyword probe: 'wool runners' \u00d7 United States",
        why: "Runs ads on the same terms as you.",
        source: "ad_keyword_overlap" as const,
        countries: ["United States"],
        matchedKeywords: ["wool runners"],
      },
    ]);
    installMocks({ seedAutoCompetitors });

    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "starter");
    expect(result).not.toBeNull();
    expect(result!.rows.length).toBe(1);
    const row = result!.rows[0]!;
    expect(typeof row.provenance).toBe("string");
    expect(row.provenance.length).toBeGreaterThan(0);
    expect(typeof row.overlapScore).toBe("number");
    expect(Number.isFinite(row.overlapScore)).toBe(true);
    expect(row.overlapScore).toBeGreaterThan(0);
  });

  it("returns an empty row set (NOT a fabricated suggestion) when the seed function returns []", async () => {
    installMocks({ seedAutoCompetitors: vi.fn().mockResolvedValue([]) });
    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "starter");
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([]);
    expect(result!.domain).toBe("allbirds.com");
  });

  it("returns an empty row set (NOT a fabricated suggestion) when the workspace has no brandWebsite saved", async () => {
    installMocks({ brandWebsite: null });
    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "starter");
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([]);
    expect(result!.domain).toBe("");
  });

  it("degrades to an empty row set when the seed function throws (never crashes the watchlists page)", async () => {
    installMocks({
      seedAutoCompetitors: vi.fn().mockRejectedValue(new Error("D1 unavailable")),
    });
    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "starter");
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([]);
  });

  it("sorts by overlapScore desc and caps at the panel limit", async () => {
    const seedAutoCompetitors = vi.fn().mockResolvedValue(
      Array.from({ length: 12 }).map((_, index) => ({
        advertiser: `Brand ${String(index).padStart(2, "0")}`,
        advertiserPageId: null,
        registrableDomain: `brand${index}.com`,
        // Lower index = HIGHER score so desc order = ascending index, easy to read.
        overlapScore: 1 - index * 0.05,
        provenance: `Keyword probe: 'term ${index}' \u00d7 United States`,
        why: "Runs ads on the same terms as you.",
        source: "ad_keyword_overlap" as const,
        countries: ["United States"],
        matchedKeywords: [`term ${index}`],
      })),
    );
    installMocks({ seedAutoCompetitors });
    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "starter");
    expect(result).not.toBeNull();
    expect(result!.rows.length).toBe(8);
    for (let index = 1; index < result!.rows.length; index += 1) {
      expect(result!.rows[index - 1]!.overlapScore).toBeGreaterThanOrEqual(
        result!.rows[index]!.overlapScore,
      );
    }
    expect(result!.rows[0]!.advertiser).toBe("Brand 00");
  });
});

describe("accept-suggested-competitor action", () => {
  async function runAcceptAction(fields: Record<string, string>) {
    const { action } = await import("~/routes/app.watchlists");
    const body = new FormData();
    body.set("intent", "accept-suggested-competitor");
    for (const [key, value] of Object.entries(fields)) {
      body.set(key, value);
    }
    return (await action({
      context: {},
      params: {},
      request: new Request("https://0509.io/app/watchlists", { method: "POST", body }),
    } as never)) as {
      ok: boolean;
      error?: "plan_limit_exceeded" | "candidate_unknown";
      message: string;
      acceptedCandidateId?: string;
      acceptedAdvertiser?: string;
      watchlistId?: string;
    };
  }

  /**
   * Compute the deterministic candidate id the loader assigns to the first
   * seed candidate. The loader builds it from (advertiser, registrable
   * domain, advertiser page id); the test mirrors that build so the action
   * gets the matching token.
   */
  function candidateIdFor(advertiser: string, domain: string | null, pageId: string | null = null) {
    return [
      advertiser.trim().toLowerCase(),
      (domain ?? "").trim().toLowerCase(),
      (pageId ?? "").trim(),
    ].join("|");
  }

  it("calls createWatchlistWithinLimit when the candidate is in the live panel and the plan allows", async () => {
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "created",
      watchlist: {
        id: "wl-new",
        userId: "user-1",
        name: "Rothy's",
        targetType: "advertiser",
        targetId: "https://rothys.com",
        targetFingerprint: "fp-rothys",
        targetLabel: "Rothy's",
        targetCountry: "United States",
        isActive: true,
        lastScannedAt: null,
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z",
      },
      current: 1,
      limit: 10,
    });
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        {
          advertiser: "Rothy's",
          advertiserPageId: null,
          registrableDomain: "rothys.com",
          overlapScore: 0.84,
          provenance: "Keyword probe: 'wool runners' \u00d7 United States",
          why: "Runs ads on the same terms as you.",
          source: "ad_keyword_overlap" as const,
          countries: ["United States"],
          matchedKeywords: ["wool runners"],
        },
      ]),
      countWatchlists: vi.fn().mockResolvedValue(0),
      createWatchlistWithinLimit,
    });

    const result = await runAcceptAction({ candidateId: candidateIdFor("Rothy's", "rothys.com") });
    expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(1);
    expect(createWatchlistWithinLimit).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        name: "Rothy's",
        targetType: "advertiser",
        targetLabel: "Rothy's",
        trackingRole: "competitor",
      }),
      10,
    );
    expect(result.ok).toBe(true);
    expect(result.acceptedAdvertiser).toBe("Rothy's");
    expect(result.watchlistId).toBe("wl-new");
  });

  /**
   * Issue #2436 (Kimi K3 Max F2): the one-click accept must fingerprint the
   * candidate exactly like every other website-backed createWatchlist path
   * (bulk-accept via the importer, search.tsx, setup-checklist,
   * customer-agent), so the same suggested competitor cannot be duplicated
   * across accept paths. The oracle is the importer's own preview: bulk
   * accept shapes the panel row as a `name,website` CSV line, so the
   * fingerprint the action passes to createWatchlistWithinLimit must equal
   * the fingerprint buildCompetitorImportPreview computes for that same
   * candidate row. A `fingerprintSavedQuery`-shaped hash (no website
   * component) misses the idx_watchlist_user_role_fingerprint_active dedup
   * and the preview's `existing` mark entirely.
   */
  it("fingerprints a website-backed candidate identically to the bulk-accept path so dedup fires across accept paths", async () => {
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "created",
      watchlist: {
        id: "wl-rothys",
        userId: "user-1",
        name: "Rothy's",
        targetType: "advertiser",
        targetId: "https://rothys.com",
        targetFingerprint: "fp-rothys",
        targetLabel: "Rothy's",
        targetCountry: "United States",
        isActive: true,
        lastScannedAt: null,
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z",
      },
      current: 1,
      limit: 10,
    });
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        {
          advertiser: "Rothy's",
          advertiserPageId: null,
          registrableDomain: "rothys.com",
          overlapScore: 0.84,
          provenance: "Keyword probe: 'wool runners' × United States",
          why: "Runs ads on the same terms as you.",
          source: "ad_keyword_overlap" as const,
          countries: ["United States"],
          matchedKeywords: ["wool runners"],
        },
      ]),
      countWatchlists: vi.fn().mockResolvedValue(0),
      createWatchlistWithinLimit,
    });

    const result = await runAcceptAction({
      candidateId: candidateIdFor("Rothy's", "rothys.com"),
    });
    expect(result.ok).toBe(true);
    expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(1);
    const acceptedTarget = createWatchlistWithinLimit.mock.calls[0]![2] as {
      targetFingerprint: string;
    };

    // The bulk path's fingerprint for the SAME candidate: bulk-accept emits
    // the panel row as a `name,website` CSV line (`shapeCandidatesAsImportCsv`)
    // and groups by `targetCountry ?? "all"`, so this preview is byte-identical
    // to what a later bulk-accept of this candidate would compute.
    const bulkPreview = buildCompetitorImportPreview({
      rawText: "name,website\nRothy's,https://rothys.com",
      country: "United States",
      planLimit: 10,
      currentCount: 0,
      existingFingerprints: [],
      selectedRowIds: ["row-2"],
    });
    const bulkFingerprint = bulkPreview.rows[0]?.target?.targetFingerprint;
    expect(bulkFingerprint).toBeTruthy();
    expect(acceptedTarget.targetFingerprint).toBe(bulkFingerprint);
  });

  it("returns plan_limit_exceeded with a named reason when the workspace is at the cap (eval 3.5)", async () => {
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        {
          advertiser: "Rothy's",
          advertiserPageId: null,
          registrableDomain: "rothys.com",
          overlapScore: 0.84,
          provenance: "Keyword probe: 'wool runners' \u00d7 United States",
          why: "Runs ads on the same terms as you.",
          source: "ad_keyword_overlap" as const,
          countries: ["United States"],
          matchedKeywords: ["wool runners"],
        },
      ]),
      countWatchlists: vi.fn().mockResolvedValue(10),
      createWatchlistWithinLimit: vi.fn(),
    });

    const result = await runAcceptAction({ candidateId: candidateIdFor("Rothy's", "rothys.com") });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("plan_limit_exceeded");
    expect(result.message).toMatch(/competitor tracking limit/);
    // Over-cap must NEVER silently admit a candidate.
    const { createWatchlistWithinLimit } = installMocks();
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
  });

  it("returns candidate_unknown when the id is not in the latest seed sweep (no silent creation)", async () => {
    const createWatchlistWithinLimit = vi.fn();
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        {
          advertiser: "Rothy's",
          advertiserPageId: null,
          registrableDomain: "rothys.com",
          overlapScore: 0.84,
          provenance: "Keyword probe: 'wool runners' \u00d7 United States",
          why: "Runs ads on the same terms as you.",
          source: "ad_keyword_overlap" as const,
          countries: ["United States"],
          matchedKeywords: ["wool runners"],
        },
      ]),
      createWatchlistWithinLimit,
    });

    const result = await runAcceptAction({ candidateId: candidateIdFor("Vivaia", "vivaia.com") });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("candidate_unknown");
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
  });

  it("returns plan_limit_exceeded when a member-of-free-plan hits the action (gate at accept time, not just loader time)", async () => {
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        {
          advertiser: "Rothy's",
          advertiserPageId: null,
          registrableDomain: "rothys.com",
          overlapScore: 0.84,
          provenance: "Keyword probe: 'wool runners' \u00d7 United States",
          why: "Runs ads on the same terms as you.",
          source: "ad_keyword_overlap" as const,
          countries: ["United States"],
          matchedKeywords: ["wool runners"],
        },
      ]),
      getUserPlan: vi.fn().mockResolvedValue("free"),
      createWatchlistWithinLimit: vi.fn(),
    });

    const result = await runAcceptAction({ candidateId: candidateIdFor("Rothy's", "rothys.com") });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("plan_limit_exceeded");
    expect(result.message).toMatch(/paid feature/i);
  });
});

describe("SuggestedCompetitorsPanel rendering (honesty eval 3.4)", () => {
  it("renders every candidate row with the 'suggested / unverified' marker and a provenance line", () => {
    const html = renderPanel({
        domain: "allbirds.com",
        rows: [
          makeCandidate({
            candidateId: "row-1",
            advertiser: "Rothy's",
            provenance: "Keyword probe: 'wool runners' \u00d7 United States",
            overlapScore: 0.84,
          }),
          makeCandidate({
            candidateId: "row-2",
            advertiser: "Vivaia",
            provenance: "Keyword probe: 'wool shoes' \u00d7 United States",
            overlapScore: 0.71,
          }),
        ],
        caps: { visible: 8, tracked: 10, frozen: false },
        feedback: null,
        pending: false,
        pendingCandidateId: null,
      });

    // Every row gets the marker (honesty eval 3.4: 100%).
    const markers = html.match(/Suggested \u00b7 unverified/g) ?? [];
    expect(markers.length).toBe(2);
    // Every row carries the provenance string verbatim (HTML escapes
    // the apostrophe — `&#x27;` — so the contains check matches the
    // escaped form).
    expect(html).toContain("Keyword probe: &#x27;wool runners&#x27; \u00d7 United States");
    expect(html).toContain("Keyword probe: &#x27;wool shoes&#x27; \u00d7 United States");
    // Every row's data-candidate-type is exactly "candidate" — never "confirmed".
    expect((html.match(/data-candidate-type="candidate"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('data-candidate-type="confirmed"');
    // One-click accept form is wired to the accept intent.
    expect(html).toContain('value="accept-suggested-competitor"');
    expect(html).toContain('value="row-1"');
    expect(html).toContain('value="row-2"');
  });

  it("renders an honest empty state (no fabricated suggestion) when the row set is empty", () => {
    const html = renderPanel({
      domain: "allbirds.com",
      rows: [],
      caps: { visible: 8, tracked: 10, frozen: false },
      feedback: null,
      pending: false,
      pendingCandidateId: null,
    });

    expect(html).toContain('data-test="suggested-empty"');
    expect(html).toContain("never invent suggestions");
    expect(html).not.toContain("data-test=\"suggested-list\"");
  });

  it("renders the plan_limit_exceeded feedback as a named reason, not a silent admit", () => {
    const html = renderPanel({
      domain: "allbirds.com",
      rows: [makeCandidate()],
      caps: { visible: 8, tracked: 10, frozen: false },
      feedback: {
        ok: undefined,
        error: "plan_limit_exceeded",
        message: "You've reached your competitor tracking limit — pause another watchlist before adding this one.",
      },
      pending: false,
      pendingCandidateId: null,
    });

    expect(html).toContain("competitor tracking limit");
    expect(html).toContain("is-error");
  });

  it("renders the ok feedback with the accepted advertiser name", () => {
    const html = renderPanel({
      domain: "allbirds.com",
      rows: [makeCandidate()],
      caps: { visible: 8, tracked: 10, frozen: false },
      feedback: {
        ok: true,
        message: "Now watching Rothy's.",
        acceptedCandidateId: "row-1",
        acceptedAdvertiser: "Rothy's",
      },
      pending: false,
      pendingCandidateId: null,
    });

    expect(html).toContain("Now watching Rothy&#x27;s.");
    expect(html).toContain("is-success");
  });
});

describe("resolveSuggestedPanelFeedback", () => {
  it("returns null for unrelated action data (e.g. pause/resume)", () => {
    expect(
      resolveSuggestedPanelFeedback({ ok: true, message: "Watchlist paused." }),
    ).toBeNull();
  });

  it("returns null for null action data", () => {
    expect(resolveSuggestedPanelFeedback(null)).toBeNull();
  });

  it("returns a typed feedback when the action succeeded for the suggested intent", () => {
    const feedback = resolveSuggestedPanelFeedback({
      ok: true,
      message: "Now watching Rothy's.",
      acceptedCandidateId: "rothys-com-",
      acceptedAdvertiser: "Rothy's",
      watchlistId: "wl-1",
    });
    expect(feedback).not.toBeNull();
    expect(feedback!.ok).toBe(true);
    expect(feedback!.acceptedAdvertiser).toBe("Rothy's");
    expect(feedback!.watchlistId).toBe("wl-1");
  });

  it("returns a typed feedback when the action returned plan_limit_exceeded", () => {
    const feedback = resolveSuggestedPanelFeedback({
      ok: false,
      error: "plan_limit_exceeded",
      message: "Tracking limit reached.",
    });
    expect(feedback).not.toBeNull();
    expect(feedback!.error).toBe("plan_limit_exceeded");
    expect(feedback!.message).toBe("Tracking limit reached.");
  });
});
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
