import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";

/**
 * Auto-competitor-watch Phase 4 (#1372): deterministic tests for the
 * long-tail bulk-accept path.
 *
 * The bulk-accept module (`~/lib/auto-competitor-bulk-accept.server`) shapes
 * suggested candidates into the EXISTING competitor-import bulk path
 * (`buildCompetitorImportPreview` → `createWatchlistWithinLimit`) — it never
 * forks a new importer (fleet-ops#517 hand-build rule). These tests pin the
 * four deterministic-required assertions from the issue:
 *
 *   1. bulk-accept of N candidates calls the existing competitor-import bulk
 *      path (CompetitorImportPreview → import), not a new parallel importer.
 *   2. when N + currentCount > planLimit, exactly (planLimit - currentCount)
 *      candidates are admitted and the remainder are returned with status
 *      "over_cap" and a named reason (reuses CompetitorImportRowStatus
 *      "over_cap").
 *   3. a bulk-accept of zero selected candidates is a no-op, not an error.
 *   4. the action is idempotent: re-accepting an already-watched candidate
 *      does not create a duplicate watchlist (INSERT OR IGNORE semantics from
 *      createWatchlist).
 *
 * The Phase 1 seed function and Phase 2 panel loader are mocked so the suite
 * stays on the `node` project (fast, no workerd/D1) and the
 * deterministic-required termination command exits 0 without the workerd
 * cost. The REAL `buildCompetitorImportPreview` runs in every shaping test so
 * the CSV adapter + cap enforcement + `over_cap` status are exercised
 * end-to-end, not stubbed.
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

function makeSeedCandidate(overrides: Partial<{
  advertiser: string;
  advertiserPageId: string | null;
  registrableDomain: string | null;
  overlapScore: number;
  provenance: string;
  countries: string[];
  matchedKeywords: string[];
}> = {}) {
  return {
    advertiser: "Rothy's",
    advertiserPageId: null,
    registrableDomain: "rothys.com",
    overlapScore: 0.84,
    provenance: "Keyword probe: 'wool runners' \u00d7 United States",
    countries: ["United States"],
    matchedKeywords: ["wool runners"],
    ...overrides,
  };
}

function candidateIdFor(advertiser: string, domain: string | null, pageId: string | null = null) {
  return [
    advertiser.trim().toLowerCase(),
    (domain ?? "").trim().toLowerCase(),
    (pageId ?? "").trim(),
  ].join("|");
}

/**
 * Install the route-action mocks. The bulk-accept handler dynamically imports
 * its deps, so vi.doMock applied before the dynamic import of the route
 * reaches them. `createWatchlistWithinLimit` defaults to a "created" stub so
 * a caller can assert it was called; tests that need "existing" / "over_cap"
 * pass their own.
 */
function installMocks({
  brandWebsite = "https://allbirds.com",
  seedAutoCompetitors = vi.fn().mockResolvedValue([]),
  countWatchlists = vi.fn().mockResolvedValue(0),
  getUserPlan = vi.fn().mockResolvedValue("starter" as const),
  createWatchlistWithinLimit = vi.fn().mockResolvedValue({
    status: "created",
    watchlist: { id: "wl-new", targetLabel: "Rothy's" },
    current: 1,
    limit: 10,
  }),
  listWatchlists = vi.fn().mockResolvedValue([]),
  checkPlanLimit = vi.fn(async () => {
    const current = await (countWatchlists as unknown as () => Promise<number>)();
    const limit = current >= 10 ? current : 10;
    return { allowed: current < limit, limit, current };
  }),
}: {
  brandWebsite?: string | null;
  seedAutoCompetitors?: ReturnType<typeof vi.fn>;
  countWatchlists?: ReturnType<typeof vi.fn>;
  getUserPlan?: ReturnType<typeof vi.fn>;
  createWatchlistWithinLimit?: ReturnType<typeof vi.fn>;
  listWatchlists?: ReturnType<typeof vi.fn>;
  checkPlanLimit?: ReturnType<typeof vi.fn>;
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
    checkPlanLimit,
  }));
  vi.doMock("~/lib/data.server", () => ({
    createWatchlistWithinLimit,
    listWatchlists,
  }));
  return { env, seedAutoCompetitors, countWatchlists, getUserPlan, createWatchlistWithinLimit, listWatchlists };
}

async function runBulkAcceptAction(fields: Record<string, string | string[]>) {
  const { action } = await import("~/routes/app.watchlists");
  const body = new FormData();
  body.set("intent", "bulk-accept-suggested-competitors");
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        body.append(key, entry);
      }
    } else {
      body.set(key, value);
    }
  }
  return (await action({
    context: {},
    params: {},
    request: new Request("https://0509.io/app/watchlists", { method: "POST", body }),
  } as never)) as {
    ok: boolean;
    error?: "plan_limit_exceeded" | "candidate_unknown";
    message: string;
    admittedCount?: number;
    existingCount?: number;
    overCapCount?: number;
    overCapRows?: Array<{ candidateId: string; advertiser: string; reason: string }>;
    createdWatchlistIds?: string[];
  };
}

async function importBulkAcceptModule({
  createWatchlistWithinLimit = vi.fn().mockResolvedValue({
    status: "created",
    watchlist: { id: "wl-new", targetLabel: "Rothy's" },
    current: 1,
    limit: 10,
  }),
}: {
  createWatchlistWithinLimit?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.resetModules();
  vi.doMock("~/lib/data.server", () => ({
    createWatchlistWithinLimit,
  }));
  const { bulkAcceptSuggestedCompetitors } = await import(
    "~/lib/auto-competitor-bulk-accept.server"
  );
  return { bulkAcceptSuggestedCompetitors, createWatchlistWithinLimit };
}

describe("bulkAcceptSuggestedCompetitors — reuse of the existing competitor-import bulk path (#1)", () => {
  it("calls buildCompetitorImportPreview (the existing importer) and createWatchlistWithinLimit — not a new parallel importer", async () => {
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "created",
      watchlist: { id: "wl-1", targetLabel: "Rothy's" },
      current: 1,
      limit: 10,
    });
    const { bulkAcceptSuggestedCompetitors } = await importBulkAcceptModule({
      createWatchlistWithinLimit,
    });

    const result = await bulkAcceptSuggestedCompetitors({
      env: {} as AppEnv,
      workspaceUserId: "user-1",
      candidates: [
        {
          candidateId: candidateIdFor("Rothy's", "rothys.com"),
          advertiser: "Rothy's",
          landingPageUrl: "https://rothys.com",
          targetCountry: "United States",
        },
      ],
      planLimit: 10,
      currentCount: 0,
      existingFingerprints: [],
      country: "United States",
    });

    // The existing createWatchlistWithinLimit path was used — exactly once
    // for one valid candidate — and the target it received is the
    // CompetitorImportWatchlistInput shape the existing importer produces.
    expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(1);
    const call = createWatchlistWithinLimit.mock.calls[0]!;
    expect(call[1]).toBe("user-1");
    const target = call[2] as {
      targetType: string;
      trackingRole: string;
      targetFingerprint: string;
      targetLabel: string;
    };
    expect(target.targetType).toBe("advertiser");
    expect(target.trackingRole).toBe("competitor");
    expect(typeof target.targetFingerprint).toBe("string");
    expect(target.targetFingerprint.length).toBeGreaterThan(0);
    // The existing importer derives targetLabel from the website's
    // displayName (registrable domain) when a URL is provided, falling back
    // to the cleaned advertiser name. Both are non-empty strings — the exact
    // value is the importer's contract, not this adapter's.
    expect(typeof target.targetLabel).toBe("string");
    expect(target.targetLabel.length).toBeGreaterThan(0);
    expect(call[3]).toBe(10);
    expect(result.admittedCount).toBe(1);
    expect(result.createdWatchlistIds).toEqual(["wl-1"]);
  });

  it("shapes a name-only candidate (no landing page) through the existing importer", async () => {
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "created",
      watchlist: { id: "wl-name", targetLabel: "Vivaia" },
      current: 1,
      limit: 10,
    });
    const { bulkAcceptSuggestedCompetitors } = await importBulkAcceptModule({
      createWatchlistWithinLimit,
    });

    const result = await bulkAcceptSuggestedCompetitors({
      env: {} as AppEnv,
      workspaceUserId: "user-1",
      candidates: [
        {
          candidateId: candidateIdFor("Vivaia", null),
          advertiser: "Vivaia",
          landingPageUrl: null,
          targetCountry: "United States",
        },
      ],
      planLimit: 10,
      currentCount: 0,
      existingFingerprints: [],
      country: "United States",
    });

    expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(1);
    const target = createWatchlistWithinLimit.mock.calls[0]![2] as { targetLabel: string };
    expect(target.targetLabel).toBe("Vivaia");
    expect(result.admittedCount).toBe(1);
  });
});

describe("bulkAcceptSuggestedCompetitors — cap enforcement (eval 3.5, #2)", () => {
  it("admits exactly (planLimit - currentCount) and returns the remainder as over_cap with a named reason", async () => {
    const createWatchlistWithinLimit = vi.fn().mockImplementation(
      async (_env: unknown, _userId: string, _target: unknown, _limit: number) => ({
        status: "created",
        watchlist: { id: `wl-${Math.random()}`, targetLabel: "" },
        current: 0,
        limit: 3,
      }),
    );
    const { bulkAcceptSuggestedCompetitors } = await importBulkAcceptModule({
      createWatchlistWithinLimit,
    });

    // 5 candidates, planLimit 3, currentCount 1 → availableSlots = 2.
    // Exactly 2 admitted, 3 over_cap.
    const candidates = Array.from({ length: 5 }).map((_, index) => ({
      candidateId: candidateIdFor(`Brand ${index}`, `brand${index}.com`),
      advertiser: `Brand ${index}`,
      landingPageUrl: `https://brand${index}.com`,
      targetCountry: "United States",
    }));

    const result = await bulkAcceptSuggestedCompetitors({
      env: {} as AppEnv,
      workspaceUserId: "user-1",
      candidates,
      planLimit: 3,
      currentCount: 1,
      existingFingerprints: [],
      country: "United States",
    });

    expect(result.admittedCount).toBe(2);
    expect(result.overCapCount).toBe(3);
    expect(result.overCapRows).toHaveLength(3);
    expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(2);
    // Every over_cap row carries a named reason — never silent.
    for (const row of result.overCapRows) {
      expect(row.reason.length).toBeGreaterThan(0);
      expect(row.reason).toMatch(/plan limit/i);
    }
    expect(result.error).toBe("plan_limit_exceeded");
    expect(result.ok).toBe(false);
  });

  it("admits all candidates when N + currentCount <= planLimit (no over_cap)", async () => {
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "created",
      watchlist: { id: "wl-x", targetLabel: "" },
      current: 0,
      limit: 10,
    });
    const { bulkAcceptSuggestedCompetitors } = await importBulkAcceptModule({
      createWatchlistWithinLimit,
    });

    const candidates = Array.from({ length: 3 }).map((_, index) => ({
      candidateId: candidateIdFor(`Brand ${index}`, `brand${index}.com`),
      advertiser: `Brand ${index}`,
      landingPageUrl: `https://brand${index}.com`,
      targetCountry: "United States",
    }));

    const result = await bulkAcceptSuggestedCompetitors({
      env: {} as AppEnv,
      workspaceUserId: "user-1",
      candidates,
      planLimit: 10,
      currentCount: 5,
      existingFingerprints: [],
      country: "United States",
    });

    expect(result.admittedCount).toBe(3);
    expect(result.overCapCount).toBe(0);
    expect(result.overCapRows).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe("bulkAcceptSuggestedCompetitors — zero selected is a no-op (#3)", () => {
  it("returns ok with zero counts and never calls createWatchlistWithinLimit", async () => {
    const createWatchlistWithinLimit = vi.fn();
    const { bulkAcceptSuggestedCompetitors } = await importBulkAcceptModule({
      createWatchlistWithinLimit,
    });

    const result = await bulkAcceptSuggestedCompetitors({
      env: {} as AppEnv,
      workspaceUserId: "user-1",
      candidates: [],
      planLimit: 10,
      currentCount: 0,
      existingFingerprints: [],
      country: "United States",
    });

    expect(result.ok).toBe(true);
    expect(result.admittedCount).toBe(0);
    expect(result.existingCount).toBe(0);
    expect(result.overCapCount).toBe(0);
    expect(result.overCapRows).toEqual([]);
    expect(result.createdWatchlistIds).toEqual([]);
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
  });
});

describe("bulkAcceptSuggestedCompetitors — idempotency (#4)", () => {
  it("marks an already-watched candidate (fingerprint in existingFingerprints) as existing and never calls createWatchlistWithinLimit for it", async () => {
    // First, run a bulk accept with a real create stub to capture the
    // fingerprint the existing importer assigns to this candidate.
    const capture = vi.fn().mockResolvedValue({
      status: "created",
      watchlist: { id: "wl-first", targetLabel: "Rothy's" },
      current: 1,
      limit: 10,
    });
    const { bulkAcceptSuggestedCompetitors: firstRun } = await importBulkAcceptModule({
      createWatchlistWithinLimit: capture,
    });
    await firstRun({
      env: {} as AppEnv,
      workspaceUserId: "user-1",
      candidates: [
        {
          candidateId: candidateIdFor("Rothy's", "rothys.com"),
          advertiser: "Rothy's",
          landingPageUrl: "https://rothys.com",
          targetCountry: "United States",
        },
      ],
      planLimit: 10,
      currentCount: 0,
      existingFingerprints: [],
      country: "United States",
    });
    const capturedTarget = capture.mock.calls[0]![2] as { targetFingerprint: string };
    const fingerprint = capturedTarget.targetFingerprint;

    // Re-accept with the fingerprint now in the existing set. A fresh module
    // import with a no-op create stub proves the preview layer skips the
    // already-watched candidate before create is ever reached.
    const createWatchlistWithinLimit = vi.fn();
    const { bulkAcceptSuggestedCompetitors: secondRun } = await importBulkAcceptModule({
      createWatchlistWithinLimit,
    });
    const result = await secondRun({
      env: {} as AppEnv,
      workspaceUserId: "user-1",
      candidates: [
        {
          candidateId: candidateIdFor("Rothy's", "rothys.com"),
          advertiser: "Rothy's",
          landingPageUrl: "https://rothys.com",
          targetCountry: "United States",
        },
      ],
      planLimit: 10,
      currentCount: 1,
      existingFingerprints: [fingerprint],
      country: "United States",
    });

    expect(result.admittedCount).toBe(0);
    expect(result.existingCount).toBe(1);
    expect(result.createdWatchlistIds).toEqual([]);
    // No duplicate watchlist was created — createWatchlistWithinLimit was
    // never reached for the already-watched candidate.
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
  });

  it("treats createWatchlistWithinLimit returning 'existing' (INSERT OR IGNORE backstop) as idempotent — no duplicate created", async () => {
    // Simulate the race: the fingerprint was NOT in existingFingerprints
    // (panel rendered before the one-click accept landed), so the preview
    // marks the candidate valid and calls createWatchlistWithinLimit — which
    // catches the duplicate via its existing-fingerprint SELECT + INSERT OR
    // IGNORE and returns status "existing". No duplicate is created.
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "existing",
      watchlist: { id: "wl-already", targetLabel: "Rothy's" },
      current: 1,
      limit: 10,
    });
    const { bulkAcceptSuggestedCompetitors } = await importBulkAcceptModule({
      createWatchlistWithinLimit,
    });

    const result = await bulkAcceptSuggestedCompetitors({
      env: {} as AppEnv,
      workspaceUserId: "user-1",
      candidates: [
        {
          candidateId: candidateIdFor("Rothy's", "rothys.com"),
          advertiser: "Rothy's",
          landingPageUrl: "https://rothys.com",
          targetCountry: "United States",
        },
      ],
      planLimit: 10,
      currentCount: 1,
      existingFingerprints: [],
      country: "United States",
    });

    expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(1);
    expect(result.admittedCount).toBe(0);
    expect(result.existingCount).toBe(1);
    expect(result.createdWatchlistIds).toEqual([]);
  });
});

describe("bulk-accept-suggested-competitors route action", () => {
  it("calls the existing bulk path end-to-end and admits candidates from the live panel", async () => {
    const createWatchlistWithinLimit = vi.fn().mockImplementation(
      async (_env: unknown, _userId: string, _target: unknown, _limit: number) => ({
        status: "created",
        watchlist: { id: `wl-${Math.random()}`, targetLabel: "" },
        current: 0,
        limit: 10,
      }),
    );
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        makeSeedCandidate({ advertiser: "Rothy's", registrableDomain: "rothys.com" }),
        makeSeedCandidate({ advertiser: "Vivaia", registrableDomain: "vivaia.com" }),
      ]),
      createWatchlistWithinLimit,
    });

    const result = await runBulkAcceptAction({
      candidateIds: [
        candidateIdFor("Rothy's", "rothys.com"),
        candidateIdFor("Vivaia", "vivaia.com"),
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.admittedCount).toBe(2);
    expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(2);
  });

  it("returns plan_limit_exceeded on free plans (paid-tier gate)", async () => {
    const createWatchlistWithinLimit = vi.fn();
    installMocks({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      createWatchlistWithinLimit,
    });

    const result = await runBulkAcceptAction({
      candidateIds: [candidateIdFor("Rothy's", "rothys.com")],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("plan_limit_exceeded");
    expect(result.message).toMatch(/paid feature/i);
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
  });

  it("zero candidateIds is a no-op, not an error", async () => {
    const createWatchlistWithinLimit = vi.fn();
    installMocks({ createWatchlistWithinLimit });

    const result = await runBulkAcceptAction({ candidateIds: [] });

    expect(result.ok).toBe(true);
    expect(result.admittedCount).toBe(0);
    expect(result.message).toMatch(/nothing to add/i);
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
  });

  it("returns candidate_unknown when none of the requested ids are in the latest panel sweep", async () => {
    const createWatchlistWithinLimit = vi.fn();
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue([
        makeSeedCandidate({ advertiser: "Rothy's", registrableDomain: "rothys.com" }),
      ]),
      createWatchlistWithinLimit,
    });

    const result = await runBulkAcceptAction({
      candidateIds: [candidateIdFor("GhostBrand", "ghost.com")],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("candidate_unknown");
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
  });

  it("surfaces over_cap rows with a named reason when the plan limit is tight (eval 3.5)", async () => {
    const createWatchlistWithinLimit = vi.fn().mockImplementation(
      async () => ({
        status: "created",
        watchlist: { id: `wl-${Math.random()}`, targetLabel: "" },
        current: 0,
        limit: 2,
      }),
    );
    installMocks({
      seedAutoCompetitors: vi.fn().mockResolvedValue(
        Array.from({ length: 4 }).map((_, index) =>
          makeSeedCandidate({
            advertiser: `Brand ${index}`,
            registrableDomain: `brand${index}.com`,
          }),
        ),
      ),
      countWatchlists: vi.fn().mockResolvedValue(1),
      createWatchlistWithinLimit,
      // Tight limit (planLimit 2, current 1 → 1 slot).
      checkPlanLimit: vi.fn().mockResolvedValue({ allowed: false, limit: 2, current: 1 }),
    });

    const result = await runBulkAcceptAction({
      candidateIds: Array.from({ length: 4 }).map((_, index) =>
        candidateIdFor(`Brand ${index}`, `brand${index}.com`),
      ),
    });

    expect(result.admittedCount).toBe(1);
    expect(result.overCapCount).toBe(3);
    expect(result.overCapRows).toHaveLength(3);
    expect(result.error).toBe("plan_limit_exceeded");
    for (const row of result.overCapRows!) {
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });
});
