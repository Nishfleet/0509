import { vi } from "vitest";

/** Route and integration tests that exercise gated surfaces should resolve Agency by default. */
export function mockAgencyWorkspacePlan() {
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue("agency"),
    getEffectiveWorkspacePlan: vi.fn().mockResolvedValue("agency"),
    getUserPlanForActor: vi.fn().mockResolvedValue("agency"),
    checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 75, current: 1 }),
    PLAN_LIMITS: {
      agency: { digests: true },
    },
  }));
}

export function unmockAgencyWorkspacePlan() {
  vi.doUnmock("~/lib/plan.server");
}
