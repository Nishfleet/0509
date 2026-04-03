import { describe, expect, it } from "vitest";

function createMockDb(options: {
  collectionCount?: number;
  planRow?: { plan: string } | null;
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
  it("returns not allowed for free users already at the watchlist limit", async () => {
    const mock = createMockDb({
      planRow: null,
      watchlistCount: 3,
    });
    const { checkPlanLimit } = await import("~/lib/plan.server");

    const result = await checkPlanLimit({ DB: mock.db } as never, "user-1", "watchlists");

    expect(result).toEqual({
      allowed: false,
      current: 3,
      limit: 3,
    });
  });

  it("returns allowed for starter users below the watchlist limit", async () => {
    const mock = createMockDb({
      planRow: { plan: "starter" },
      watchlistCount: 15,
    });
    const { checkPlanLimit } = await import("~/lib/plan.server");

    const result = await checkPlanLimit({ DB: mock.db } as never, "user-1", "watchlists");

    expect(result).toEqual({
      allowed: true,
      current: 15,
      limit: 20,
    });
  });
});
