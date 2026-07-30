import { describe, expect, it, vi } from "vitest";

const topUpReadFailure = new Error("D1 top-up balance read failed");

vi.mock("~/lib/evidence-usage.server", () => ({
  getEvidenceUsageSummary: vi.fn().mockRejectedValue(topUpReadFailure),
  isEvidenceTopUpReadError: (error: unknown) => error === topUpReadFailure,
  listTopUpGrantHistory: vi.fn(),
}));

describe("getProofUsageSummary top-up read failures", () => {
  it("does not replace an unreadable paid balance with a legacy zero", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all<T>() {
                if (sql.includes("FROM user_plan")) {
                  return { results: [{ plan: "starter" }] as T[] };
                }
                if (sql.includes("FROM proof_usage_credit")) {
                  return { results: [{ count: 0 }] as T[] };
                }
                if (sql.includes("FROM proof_capture")) {
                  return { results: [{ count: 250 }] as T[] };
                }
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    };
    const { getProofUsageSummary } = await import("~/lib/plan.server");

    await expect(
      getProofUsageSummary({ DB: db } as never, "user-1"),
    ).rejects.toBe(topUpReadFailure);
  });
});
