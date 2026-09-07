import { describe, expect, it, vi } from "vitest";

const { originalCause, topUpReadFailure, EvidenceTopUpReadError } = vi.hoisted(() => {
  class HoistedEvidenceTopUpReadError extends Error {
    override readonly name = "EvidenceTopUpReadError";

    constructor(message: string, cause: unknown) {
      super(message, { cause });
    }
  }
  const cause = new Error("simulated D1 top-up outage");
  return {
    originalCause: cause,
    topUpReadFailure: new HoistedEvidenceTopUpReadError("D1 top-up balance read failed", cause),
    EvidenceTopUpReadError: HoistedEvidenceTopUpReadError,
  };
});

vi.mock("~/lib/evidence-usage.server", () => ({
  EvidenceTopUpReadError,
  getEvidenceUsageSummary: vi.fn().mockRejectedValue(topUpReadFailure),
  isEvidenceTopUpReadError: (error: unknown) => error instanceof EvidenceTopUpReadError,
  listTopUpGrantHistory: vi.fn(),
}));

describe("getProofUsageSummary top-up read failures", () => {
  it("rethrows a typed paid-balance read failure with its original cause", async () => {
    const { getProofUsageSummary } = await import("~/lib/plan.server");

    const error = await getProofUsageSummary({ DB: {} } as never, "user-1").catch(
      (caught) => caught,
    );

    expect(error).toBe(topUpReadFailure);
    expect(error).toBeInstanceOf(EvidenceTopUpReadError);
    expect(error).toMatchObject({ cause: originalCause });
  });
});
