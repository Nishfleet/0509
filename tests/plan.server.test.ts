import { describe, expect, it } from "vitest";

function createMockDb(options: {
  collectionCount?: number;
  planRow?: { plan: string } | null;
  proofCreditCount?: number;
  proofUsageCount?: number;
  watchlistCount?: number;
}) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];

  return {
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });

            return {
              async all<T>() {
                if (sql.includes("FROM user_plan")) {
                  return {
                    results: (options.planRow ? [options.planRow] : []) as T[],
                  };
                }

                if (sql.includes("FROM proof_usage_credit")) {
                  return {
                    results: [{ count: options.proofCreditCount ?? 0 }] as T[],
                  };
                }

                if (sql.includes("FROM proof_capture")) {
                  return {
                    results: [{ count: options.proofUsageCount ?? 0 }] as T[],
                  };
                }

                if (sql.includes("FROM watchlist")) {
                  return {
                    results: [{ count: options.watchlistCount ?? 0 }] as T[],
                  };
                }

                if (sql.includes("FROM collection")) {
                  return {
                    results: [{ count: options.collectionCount ?? 0 }] as T[],
                  };
                }

                return {
                  results: [] as T[],
                };
              },
            };
          },
        };
      },
    },
  };
}

describe("getUserPlan", () => {
  it("defaults missing rows to free", async () => {
    const mock = createMockDb({
      planRow: null,
    });
    const { getUserPlan } = await import("~/lib/plan.server");

    const result = await getUserPlan({ DB: mock.db } as never, "user-1");

    expect(result).toBe("free");
    expect(mock.statements[0]?.bindings).toEqual(["user-1"]);
  });
});

describe("checkPlanLimit", () => {
  it("returns not allowed for unpaid users because there is no free workspace tier", async () => {
    const mock = createMockDb({
      planRow: null,
      watchlistCount: 0,
    });
    const { checkPlanLimit } = await import("~/lib/plan.server");

    const result = await checkPlanLimit({ DB: mock.db } as never, "user-1", "watchlists");

    expect(result).toEqual({
      allowed: false,
      current: 0,
      limit: 0,
    });
  });

  it("returns allowed for scout users below the paid entry watchlist limit", async () => {
    const mock = createMockDb({
      planRow: { plan: "scout" },
      watchlistCount: 2,
    });
    const { checkPlanLimit } = await import("~/lib/plan.server");

    const result = await checkPlanLimit({ DB: mock.db } as never, "user-1", "watchlists");

    expect(result).toEqual({
      allowed: true,
      current: 2,
      limit: 3,
    });
  });

  it("returns allowed for starter users below the watchlist limit", async () => {
    const mock = createMockDb({
      planRow: { plan: "starter" },
      watchlistCount: 9,
    });
    const { checkPlanLimit } = await import("~/lib/plan.server");

    const result = await checkPlanLimit({ DB: mock.db } as never, "user-1", "watchlists");

    expect(result).toEqual({
      allowed: true,
      current: 9,
      limit: 10,
    });
  });

  it("returns not allowed for agency users at the generous watchlist limit", async () => {
    const mock = createMockDb({
      planRow: { plan: "agency" },
      watchlistCount: 75,
    });
    const { checkPlanLimit } = await import("~/lib/plan.server");

    const result = await checkPlanLimit({ DB: mock.db } as never, "user-1", "watchlists");

    expect(result).toEqual({
      allowed: false,
      current: 75,
      limit: 75,
    });
  });
});

describe("getProofUsageSummary", () => {
  it("warns when a paid workspace crosses 80 percent of proof capacity", async () => {
    const mock = createMockDb({
      planRow: { plan: "scout" },
      proofUsageCount: 40,
    });
    const { getProofUsageSummary } = await import("~/lib/plan.server");

    const result = await getProofUsageSummary({ DB: mock.db } as never, "user-1");

    expect(result).toMatchObject({
      plan: "scout",
      used: 40,
      baseLimit: 50,
      extraCredits: 0,
      limit: 50,
      remaining: 10,
      warningLevel: "warning",
      upgradeTarget: "Starter",
    });
  });

  it("counts active overflow credits before warning", async () => {
    const mock = createMockDb({
      planRow: { plan: "starter" },
      proofUsageCount: 240,
      proofCreditCount: 500,
    });
    const { getProofUsageSummary } = await import("~/lib/plan.server");

    const result = await getProofUsageSummary({ DB: mock.db } as never, "user-1");

    expect(result).toMatchObject({
      plan: "starter",
      used: 240,
      baseLimit: 250,
      extraCredits: 500,
      limit: 750,
      remaining: 510,
      warningLevel: "ok",
      upgradeTarget: "Agency",
    });
  });
});
