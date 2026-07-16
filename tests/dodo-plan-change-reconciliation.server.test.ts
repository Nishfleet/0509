import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserPlanBillingInfo: vi.fn(),
  isDue: vi.fn(),
  readProviderState: vi.fn(),
  reconcileWithAudit: vi.fn(),
}));

vi.mock("~/lib/data/billing-plan.server", () => ({
  getUserPlanBillingInfo: mocks.getUserPlanBillingInfo,
}));
vi.mock("~/lib/data/billing-plan-change-reconciliation.server", () => ({
  isDodoSubscriptionPlanChangeReconciliationDue: mocks.isDue,
  reconcileDodoSubscriptionPlanChangeWithAudit: mocks.reconcileWithAudit,
}));
vi.mock("~/lib/dodo-billing.server", () => ({
  getDodo0509SubscriptionPlanState: mocks.readProviderState,
}));

import { reconcileDodo0509SubscriptionPlanChange } from "~/lib/dodo-plan-change-reconciliation.server";

const env = {
  DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
  DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
} as never;

const billing = {
  plan: "scout",
  billingInterval: "monthly",
  dodoStatus: "plan_change_pending",
  dodoPaymentId: "pay_123",
  dodoProductId: "prod_scout_monthly",
  dodoPlanChangeProductId: "prod_starter_monthly",
  dodoSubscriptionId: "sub_123",
  dodoCustomerId: "cus_123",
  dodoNextBillingAt: "2026-08-04T12:00:00.000Z",
  planUpdatedAt: "2026-07-16T12:00:00.000Z",
} as const;

describe("Dodo plan-change recovery orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserPlanBillingInfo.mockResolvedValue(billing);
    mocks.isDue.mockReturnValue(true);
    mocks.reconcileWithAudit.mockImplementation(async (_env, input) => ({
      ok: true,
      replayed: false,
      outcome: input.outcome,
    }));
  });

  it.each([
    {
      label: "accepted",
      state: {
        subscriptionId: "sub_123",
        productId: "prod_starter_monthly",
        status: "active",
        scheduledChangeProductId: null,
        nextBillingAt: "2026-08-16T12:00:00.000Z",
        observedAt: "2026-07-16T13:02:00.000Z",
      },
      outcome: "accepted",
      targetPlan: "starter",
    },
    {
      label: "scheduled",
      state: {
        subscriptionId: "sub_123",
        productId: "prod_scout_monthly",
        status: "active",
        scheduledChangeProductId: "prod_starter_monthly",
        nextBillingAt: "2026-08-16T12:00:00.000Z",
        observedAt: "2026-07-16T13:02:00.000Z",
      },
      outcome: "scheduled",
      targetPlan: "starter",
    },
    {
      label: "unchanged",
      state: {
        subscriptionId: "sub_123",
        productId: "prod_scout_monthly",
        status: "active",
        scheduledChangeProductId: null,
        nextBillingAt: "2026-08-16T12:00:00.000Z",
        observedAt: "2026-07-16T13:02:00.000Z",
      },
      outcome: "unchanged",
      targetPlan: null,
    },
  ])("maps provider-confirmed $label truth to one audited local CAS", async ({ state, outcome, targetPlan }) => {
    mocks.readProviderState.mockResolvedValue(state);

    await expect(
      reconcileDodo0509SubscriptionPlanChange({
        env,
        subjectUserId: "owner-1",
        actorUserId: "operator-1",
      }),
    ).resolves.toMatchObject({ ok: true, outcome });

    expect(mocks.readProviderState).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileWithAudit).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ outcome, targetPlan }),
    );
  });

  it("keeps a failed or conflicting provider read unknown and audited", async () => {
    mocks.readProviderState.mockRejectedValue(new Response("unavailable", { status: 502 }));

    await reconcileDodo0509SubscriptionPlanChange({
      env,
      subjectUserId: "owner-1",
      actorUserId: "operator-1",
    });

    expect(mocks.reconcileWithAudit).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        outcome: "unknown",
        targetPlan: null,
        providerStatus: "unavailable",
      }),
    );
  });

  it("does not query Dodo or mutate local state before the stale window", async () => {
    mocks.isDue.mockReturnValue(false);

    await expect(
      reconcileDodo0509SubscriptionPlanChange({
        env,
        subjectUserId: "owner-1",
        actorUserId: "operator-1",
      }),
    ).resolves.toEqual({ ok: false, reason: "not_due" });
    expect(mocks.readProviderState).not.toHaveBeenCalled();
    expect(mocks.reconcileWithAudit).not.toHaveBeenCalled();
  });
});
