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
  vi.doMock("~/lib/auto-competitor-seed.server", () => ({
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
  it("returns null on free plans so the panel omits itself (paid-tier gate)", async () => {
    installMocks({ getUserPlan: vi.fn().mockResolvedValue("free") });
    const { loadSuggestedCompetitorsPanel: fresh } = await import(
      "~/lib/auto-competitor-suggested-loader.server"
    );
    const result = await fresh({} as AppEnv, "user-1", "free");
    expect(result).toBeNull();
  });

  it("returns only candidates (type 'candidate') — never 'confirmed' rows", async () => {
    const seedAutoCompetitors = vi.fn().mockResolvedValue([
      {
        advertiser: "Rothy's",
        advertiserPageId: null,
        registrableDomain: "rothys.com",
        overlapScore: 0.84,
        provenance: "Keyword probe: 'wool runners' \u00d7 United States",
        countries: ["United States"],
        matchedKeywords: ["wool runners"],
      },
      {
        advertiser: "Vivaia",
        advertiserPageId: null,
        registrableDomain: "vivaia.com",
        overlapScore: 0.71,
        provenance: "Keyword probe: 'wool shoes' \u00d7 United States",
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

  it("returns plan_limit_exceeded with a named reason when the workspace is at the cap (eval 3.5)", async () => {
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        {
          advertiser: "Rothy's",
          advertiserPageId: null,
          registrableDomain: "rothys.com",
          overlapScore: 0.84,
          provenance: "Keyword probe: 'wool runners' \u00d7 United States",
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