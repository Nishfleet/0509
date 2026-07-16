import { resolveBillingSkuFromProviderProductId } from "~/lib/billing-sku-catalog";
import {
  getUserPlanBillingInfo,
} from "~/lib/data/billing-plan.server";
import {
  isDodoSubscriptionPlanChangeReconciliationDue,
  reconcileDodoSubscriptionPlanChangeWithAudit,
} from "~/lib/data/billing-plan-change-reconciliation.server";
import { getDodo0509SubscriptionPlanState } from "~/lib/dodo-billing.server";
import type { AppEnv } from "~/lib/env.server";

export async function reconcileDodo0509SubscriptionPlanChange({
  env,
  subjectUserId,
  actorUserId,
}: {
  env: AppEnv;
  subjectUserId: string;
  actorUserId: string;
}) {
  const billing = await getUserPlanBillingInfo(env, subjectUserId);
  if (
    !billing.dodoSubscriptionId ||
    !billing.dodoProductId ||
    !billing.dodoPlanChangeProductId ||
    !billing.dodoStatus ||
    !billing.planUpdatedAt ||
    !isDodoSubscriptionPlanChangeReconciliationDue(
      billing.dodoStatus,
      billing.planUpdatedAt,
      billing.dodoPlanChangeProductId,
    )
  ) {
    return { ok: false as const, reason: "not_due" as const };
  }

  let state: Awaited<ReturnType<typeof getDodo0509SubscriptionPlanState>> | null = null;
  try {
    state = await getDodo0509SubscriptionPlanState({
      env,
      subscriptionId: billing.dodoSubscriptionId,
    });
  } catch {
    // Provider retrieval is read-only. A failed read remains provider-unknown;
    // it is audited below and never permits another change-plan mutation.
  }

  const targetSku = resolveBillingSkuFromProviderProductId(
    env,
    billing.dodoPlanChangeProductId,
  );
  const targetPlan = targetSku?.planFamily && targetSku.planFamily !== "free"
    ? targetSku.planFamily
    : null;
  const outcome = state?.status === "active" && state.productId === billing.dodoPlanChangeProductId && targetPlan
    ? "accepted"
    : state?.status === "active" &&
        state.scheduledChangeProductId === billing.dodoPlanChangeProductId &&
        targetPlan
      ? "scheduled"
      : state?.status === "active" &&
          state.productId === billing.dodoProductId &&
          !state.scheduledChangeProductId
        ? "unchanged"
        : "unknown";

  return reconcileDodoSubscriptionPlanChangeWithAudit(env, {
    subjectUserId,
    actorUserId,
    subscriptionId: billing.dodoSubscriptionId,
    currentProductId: billing.dodoProductId,
    pendingProductId: billing.dodoPlanChangeProductId,
    claimedStatus: billing.dodoStatus,
    claimedAt: billing.planUpdatedAt,
    outcome,
    targetPlan: outcome === "accepted" || outcome === "scheduled" ? targetPlan : null,
    providerStatus: state?.status ?? "unavailable",
    providerProductId: state?.productId ?? null,
    scheduledChangeProductId: state?.scheduledChangeProductId ?? null,
    nextBillingAt: state?.nextBillingAt ?? null,
    observedAt: state?.observedAt ?? new Date().toISOString(),
  });
}
