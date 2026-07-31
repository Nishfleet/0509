import { describe, expect, it } from "vitest";

function createMockDb(options: {
  collectionCount?: number;
  planRow?: {
    plan: string;
    dodo_status?: string | null;
    dodo_next_billing_at?: string | null;
  } | null;
  proofCreditCount?: number;
  proofCreditReadError?: Error;
  proofUsageCount?: number;
  topUpGrantReadError?: Error;
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
                  if (
                    options.proofCreditReadError &&
                    !sql.includes("LEFT JOIN proof_usage_credit_migration")
                  ) {
                    throw options.proofCreditReadError;
                  }
                  return {
                    results: [{ count: options.proofCreditCount ?? 0 }] as T[],
                  };
                }

                if (sql.includes("FROM evidence_top_up_grant")) {
                  if (options.topUpGrantReadError) {
                    throw options.topUpGrantReadError;
                  }
                  return { results: [{ count: 0 }] as T[] };
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

  it("treats scheduled cancellations past the effective date as free", async () => {
    const mock = createMockDb({
      planRow: {
        plan: "starter",
        dodo_status: "cancellation_scheduled",
        dodo_next_billing_at: "2020-01-01T00:00:00.000Z",
      },
    });
    const { getUserPlan } = await import("~/lib/plan.server");

    const result = await getUserPlan({ DB: mock.db } as never, "user-1");

    expect(result).toBe("free");
  });

  it("keeps paid access before the scheduled cancellation effective timestamp", async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const mock = createMockDb({
      planRow: {
        plan: "starter",
        dodo_status: "cancellation_scheduled",
        dodo_next_billing_at: future,
      },
    });
    const { getUserPlan } = await import("~/lib/plan.server");

    await expect(getUserPlan({ DB: mock.db } as never, "user-1")).resolves.toBe("starter");
  });

  it("treats malformed billing timestamps as still paid until a valid expiry is stored", async () => {
    const mock = createMockDb({
      planRow: {
        plan: "starter",
        dodo_status: "cancellation_scheduled",
        dodo_next_billing_at: "not-a-date",
      },
    });
    const { getUserPlan } = await import("~/lib/plan.server");

    await expect(getUserPlan({ DB: mock.db } as never, "user-1")).resolves.toBe("starter");
  });

  it("treats missing dodo_next_billing_at as still paid while cancellation is scheduled", async () => {
    const mock = createMockDb({
      planRow: {
        plan: "agency",
        dodo_status: "cancellation_scheduled",
        dodo_next_billing_at: null,
      },
    });
    const { getUserPlan } = await import("~/lib/plan.server");

    await expect(getUserPlan({ DB: mock.db } as never, "user-1")).resolves.toBe("agency");
  });
});

describe("checkPlanLimit", () => {
  it("allows unpaid users one free activation watchlist", async () => {
    const mock = createMockDb({
      planRow: null,
      watchlistCount: 0,
    });
    const { checkPlanLimit } = await import("~/lib/plan.server");

    const result = await checkPlanLimit({ DB: mock.db } as never, "user-1", "watchlists");

    expect(result).toEqual({
      allowed: true,
      current: 0,
      limit: 1,
    });
  });

  it("blocks unpaid users once the free watchlist slot is used", async () => {
    const mock = createMockDb({
      planRow: null,
      watchlistCount: 1,
    });
    const { checkPlanLimit } = await import("~/lib/plan.server");

    const result = await checkPlanLimit({ DB: mock.db } as never, "user-1", "watchlists");

    expect(result).toEqual({
      allowed: false,
      current: 1,
      limit: 1,
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

describe("PLAN_LIMITS", () => {
  it("gives Scout an automated weekly digest loop", async () => {
    const { PLAN_LIMITS } = await import("~/lib/plan.server");

    expect(PLAN_LIMITS.scout).toMatchObject({
      digests: true,
      digestCadence: "weekly",
      proofCapturesPerMonth: 50,
      watchlists: 3,
      collections: 10,
    });
    expect(PLAN_LIMITS.starter.digestCadence).toBe("daily_and_weekly");
    expect(PLAN_LIMITS.agency.digestCadence).toBe("daily_and_weekly");
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

  it("does not turn failures in both legacy credit stores into zero entitlement", async () => {
    const topUpGrantReadError = new Error("D1 legacy top-up store failed");
    const mock = createMockDb({
      planRow: { plan: "starter" },
      proofCreditReadError: new Error("D1 legacy credit store failed"),
      proofUsageCount: 250,
      topUpGrantReadError,
    });
    const { getProofUsageSummary } = await import("~/lib/plan.server");

    await expect(
      getProofUsageSummary({ DB: mock.db } as never, "user-1"),
    ).rejects.toBe(topUpGrantReadError);
  });
});
