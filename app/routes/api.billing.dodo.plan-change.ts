import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type {
  DodoCheckoutTarget,
  DodoPlanChangeEffectiveAt,
  DodoPlanChangeProrationMode,
} from "~/lib/dodo-billing.server";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";

export function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { enforceBillingProviderRateLimit } = await import("~/lib/rate-limit.server");
  const {
    DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
    claimDodoSubscriptionPlanChange,
    clearDodoSubscriptionPlanChangeClaim,
    getUserPlanBillingInfo,
    isBlockingDodoSubscriptionPlanChangeStatus,
    markDodoSubscriptionPlanChangeScheduled,
  } = await import("~/lib/data.server");
  const {
    changeDodo0509SubscriptionPlan,
    checkoutTargetFromSkuSlug,
    getDodo0509SubscriptionCurrency,
    isDefiniteDodoSubscriptionPlanChangeRejection,
    previewDodo0509SubscriptionPlanChange,
    summarizeDodoSubscriptionPlanChangePreview,
    verifyDodoSubscriptionPlanChangePreviewToken,
  } = await import("~/lib/dodo-billing.server");
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  if (isMember && workspaceUserId !== session.user.id) {
    throw new Response("Only the workspace owner can manage billing.", { status: 403 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "preview").trim();

  const billing = await getUserPlanBillingInfo(env, workspaceUserId);
  if (billing.plan === "free") {
    throw redirect("/app/billing?plan-change=requires-subscription#plans", { status: 303 });
  }
  if (!billing.dodoSubscriptionId || !billing.billingInterval) {
    throw redirect("/app/billing?plan-change=unavailable#plans", { status: 303 });
  }
  if (billing.dodoStatus === "checkout_pending") {
    throw redirect("/app/billing?plan-change=pending-checkout#plans", { status: 303 });
  }
  if (billing.dodoStatus === "cancellation_scheduled") {
    throw redirect("/app/billing?plan-change=cancellation-scheduled#plans", { status: 303 });
  }
  if (
    isBlockingDodoSubscriptionPlanChangeStatus(
      billing.dodoStatus,
      billing.planUpdatedAt,
      billing.dodoPlanChangeProductId,
    )
  ) {
    const { isDodoSubscriptionPlanChangeReconciliationDue } = await import("~/lib/data.server");
    if (
      isDodoSubscriptionPlanChangeReconciliationDue(
        billing.dodoStatus,
        billing.planUpdatedAt,
        billing.dodoPlanChangeProductId,
      )
    ) {
      const { reconcileDodo0509SubscriptionPlanChange } = await import(
        "~/lib/dodo-plan-change-reconciliation.server"
      );
      const reconciliation = await reconcileDodo0509SubscriptionPlanChange({
        env,
        subjectUserId: workspaceUserId,
        actorUserId: session.user.id,
      });
      if (reconciliation.ok) {
        const notice = reconciliation.outcome === "accepted"
          ? "reconciled"
          : reconciliation.outcome === "scheduled"
            ? "scheduled"
            : reconciliation.outcome === "unchanged"
              ? "recovered"
              : "pending-change";
        throw redirect(`/app/billing?plan-change=${notice}#plans`, { status: 303 });
      }
      if (reconciliation.reason === "stale") {
        throw redirect("/app/billing?plan-change=status-refreshed#plans", { status: 303 });
      }
    }
    throw redirect("/app/billing?plan-change=pending-change#plans", { status: 303 });
  }
  if (intent === "reconcile") {
    throw redirect("/app/billing?plan-change=status-refreshed#plans", { status: 303 });
  }
  if (
    billing.dodoStatus === "payment.failed" ||
    billing.dodoStatus === "subscription.failed" ||
    billing.dodoStatus === "subscription.on_hold"
  ) {
    throw redirect("/app/billing?plan-change=payment-issue#plans", { status: 303 });
  }

  const target = parsePlanChangeTarget(formData, checkoutTargetFromSkuSlug);
  if (!target) throw new Response("Invalid plan change target.", { status: 400 });
  if (isCurrentBillingChoice(billing.plan, billing.billingInterval, target)) {
    throw redirect("/app/billing?plan-change=current#plans", { status: 303 });
  }

  if (!isSelfServePlanSlug(target.planFamily)) {
    throw redirect("/app/billing?plan-change=unavailable#plans", { status: 303 });
  }
  const { isPlanCheckoutAllowed } = await import("~/lib/commercial-launch-gate.server");
  if (!isPlanCheckoutAllowed(env, target.planFamily)) {
    throw redirect("/app/billing?plan-change=unavailable#plans", { status: 303 });
  }
  const { readProviderProductId, resolveBillingSku } = await import("~/lib/billing-sku-catalog");
  const targetSku = resolveBillingSku(target.sku);
  const targetProviderProductId = targetSku ? readProviderProductId(env, targetSku) : "";
  if (!targetProviderProductId) {
    throw redirect("/app/billing?plan-change=unavailable#plans", { status: 303 });
  }

  const { validateDodo0509PlanCheckout } = await import("~/lib/dodo-pricing.server");
  const validationLimitResponse = await enforceBillingProviderRateLimit(
    request,
    env,
    workspaceUserId,
    "pricing",
    cloudflare?.ctx,
  );
  if (validationLimitResponse) throw validationLimitResponse;
  const checkoutValidation = await validateDodo0509PlanCheckout({
    env,
    request,
    plan: target.planFamily,
    cycle: target.cycle,
  });
  if (!checkoutValidation.valid) {
    const param = target.cycle === "yearly" ? "annual-unavailable" : "unavailable";
    throw redirect(`/app/billing?plan-change=${param}&plan=${target.planFamily}#plans`, {
      status: 303,
    });
  }

  const timing = planChangeTiming(billing.plan, billing.billingInterval, target);
  let preview: Record<string, unknown>;
  let subscriptionCurrency: string;
  const currencyLimitResponse = await enforceBillingProviderRateLimit(
    request,
    env,
    workspaceUserId,
    "pricing",
    cloudflare?.ctx,
  );
  if (currencyLimitResponse) throw currencyLimitResponse;
  const previewLimitResponse = await enforceBillingProviderRateLimit(
    request,
    env,
    workspaceUserId,
    "pricing",
    cloudflare?.ctx,
  );
  if (previewLimitResponse) throw previewLimitResponse;
  try {
    [subscriptionCurrency, preview] = await Promise.all([
      getDodo0509SubscriptionCurrency({
        env,
        subscriptionId: billing.dodoSubscriptionId,
      }),
      previewDodo0509SubscriptionPlanChange({
        env,
        subscriptionId: billing.dodoSubscriptionId,
        target,
        userId: workspaceUserId,
        effectiveAt: timing.effectiveAt,
        prorationBillingMode: timing.prorationBillingMode,
      }),
    ]);
  } catch {
    throw redirect("/app/billing?plan-change=unavailable#plans", { status: 303 });
  }

  const previewSummary = summarizeDodoSubscriptionPlanChangePreview(preview, subscriptionCurrency);
  if (!previewSummary) {
    throw redirect("/app/billing?plan-change=unavailable#plans", { status: 303 });
  }

  const previewRedirectUrl = planChangePreviewUrl(target, timing.effectiveAt);
  if (intent !== "confirm") {
    throw redirect(previewRedirectUrl, { status: 303 });
  }

  const previewToken = String(formData.get("preview_token") ?? "").trim();
  const tokenMatchesPreview = await verifyDodoSubscriptionPlanChangePreviewToken(env, previewToken, {
    subscriptionId: billing.dodoSubscriptionId,
    target,
    userId: workspaceUserId,
    effectiveAt: timing.effectiveAt,
    prorationBillingMode: timing.prorationBillingMode,
    amount: previewSummary.amount,
    currency: previewSummary.currency,
  });
  if (!tokenMatchesPreview) {
    throw redirect(previewRedirectUrl, { status: 303 });
  }

  const claimedStatus = DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS;
  const mutationLimitResponse = await enforceBillingProviderRateLimit(
    request,
    env,
    workspaceUserId,
    "mutation",
    cloudflare?.ctx,
  );
  if (mutationLimitResponse) throw mutationLimitResponse;
    const claimed = await claimDodoSubscriptionPlanChange(env, {
      userId: workspaceUserId,
      status: claimedStatus,
      providerProductId: targetProviderProductId,
      currentSubscriptionId: billing.dodoSubscriptionId,
      currentProductId: billing.dodoProductId,
      currentStatus: billing.dodoStatus,
      currentPlanUpdatedAt: billing.planUpdatedAt,
    });
  if (!claimed) {
    throw redirect("/app/billing?plan-change=pending-change#plans", { status: 303 });
  }

  try {
    await changeDodo0509SubscriptionPlan({
      env,
      subscriptionId: billing.dodoSubscriptionId,
      target,
      userId: workspaceUserId,
      effectiveAt: timing.effectiveAt,
      prorationBillingMode: timing.prorationBillingMode,
    });
  } catch (error) {
    if (isDefiniteDodoSubscriptionPlanChangeRejection(error)) {
        await clearDodoSubscriptionPlanChangeClaim(env, {
          userId: workspaceUserId,
          claimedStatus,
          previousStatus: billing.dodoStatus,
          previousPlanUpdatedAt: billing.planUpdatedAt,
          providerProductId: targetProviderProductId,
          subscriptionId: billing.dodoSubscriptionId,
          claimedAt: claimed.claimedAt,
        });
      throw redirect("/app/billing?plan-change=unavailable#plans", { status: 303 });
    }
    throw redirect("/app/billing?plan-change=pending-change#plans", { status: 303 });
  }

  if (timing.effectiveAt === "next_billing_date") {
    await markDodoSubscriptionPlanChangeScheduled(env, { userId: workspaceUserId });
  }

  const result = timing.effectiveAt === "next_billing_date" ? "scheduled" : "accepted";
  throw redirect(`/app/billing?plan-change=${result}&plan=${target.planFamily}&cycle=${target.cycle}#plans`, {
    status: 303,
  });
}

function planChangePreviewUrl(
  target: Extract<DodoCheckoutTarget, { kind: "plan" }>,
  effectiveAt: DodoPlanChangeEffectiveAt,
) {
  const params = new URLSearchParams({
    "plan-change": "preview",
    plan: target.planFamily,
    cycle: target.cycle,
    sku: target.sku,
    effective: effectiveAt,
  });
  return `/app/billing?${params.toString()}#plans`;
}

function parsePlanChangeTarget(
  formData: FormData,
  resolveSku: (slug: string) => DodoCheckoutTarget | null,
): Extract<DodoCheckoutTarget, { kind: "plan" }> | null {
  const sku = String(formData.get("sku") ?? "").trim();
  const target = sku ? resolveSku(sku) : null;
  return target?.kind === "plan" ? target : null;
}

function isCurrentBillingChoice(
  currentPlan: string,
  currentInterval: "monthly" | "annual",
  target: Extract<DodoCheckoutTarget, { kind: "plan" }>,
) {
  const targetInterval = target.cycle === "yearly" ? "annual" : "monthly";
  return currentPlan === target.planFamily && currentInterval === targetInterval;
}

function planChangeTiming(
  currentPlan: "scout" | "starter" | "agency",
  currentInterval: "monthly" | "annual",
  target: Extract<DodoCheckoutTarget, { kind: "plan" }>,
): {
  effectiveAt: DodoPlanChangeEffectiveAt;
  prorationBillingMode: DodoPlanChangeProrationMode;
} {
  const targetInterval = target.cycle === "yearly" ? "annual" : "monthly";
  const rankDelta = planRank(target.planFamily) - planRank(currentPlan);
  const upgradesValue = rankDelta > 0 || (rankDelta === 0 && currentInterval === "monthly" && targetInterval === "annual");
  if (upgradesValue) {
    return { effectiveAt: "immediately", prorationBillingMode: "prorated_immediately" };
  }
  return { effectiveAt: "next_billing_date", prorationBillingMode: "full_immediately" };
}

function planRank(plan: string) {
  switch (plan) {
    case "scout":
      return 1;
    case "starter":
      return 2;
    case "agency":
      return 3;
    default:
      return 0;
  }
}

function isSelfServePlanSlug(value: string): value is "scout" | "starter" {
  return value === "scout" || value === "starter";
}
