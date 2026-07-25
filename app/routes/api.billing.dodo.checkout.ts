import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import type { DodoCheckoutPricingContext } from "~/lib/dodo-pricing.server";

export function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkoutTargetFromSkuSlug, createDodo0509CheckoutSession } = await import(
    "~/lib/dodo-billing.server"
  );
  const { resolveWorkspace } = await import("~/lib/workspace.server");
  const { enforceBillingProviderRateLimit } = await import("~/lib/rate-limit.server");
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const target = parseCheckoutTarget(request, formData, checkoutTargetFromSkuSlug);
  const source = cleanSourceParam(formData.get("source"));
  let planCheckoutClaimed = false;
  let pricingContext: DodoCheckoutPricingContext | null = null;
  const checkoutId = target.kind === "plan" ? crypto.randomUUID() : null;

  const workspace = await resolveWorkspace(env, session.user.id);
  const billingUserId = workspace.workspaceUserId;
  if (workspace.isMember && billingUserId !== session.user.id) {
    throw new Response("Only the workspace owner can manage billing.", { status: 403 });
  }
  const { getUserPlan } = await import("~/lib/plan.server");
  const currentPlan = await getUserPlan(env, billingUserId);

  if (target.kind === "plan") {
    if (!isCheckoutPlanSlug(target.planFamily)) {
      throw invalidCheckoutTargetResponse(request);
    }

    if (currentPlan !== "free") {
      throw redirect("/app/billing?checkout=already-subscribed", { status: 303 });
    }

    const { isPlanCheckoutAllowed } = await import("~/lib/commercial-launch-gate.server");
    if (!isPlanCheckoutAllowed(env, target.planFamily)) {
      const heldParam = target.planFamily === "agency" ? "agency-held" : "plan-unavailable";
      throw redirect(`/app/billing?checkout=${heldParam}`, { status: 303 });
    }

    const { validateDodo0509PlanCheckout } = await import("~/lib/dodo-pricing.server");
    const pricingLimitResponse = await enforceBillingProviderRateLimit(
      request,
      env,
      billingUserId,
      "pricing",
      cloudflare?.ctx,
    );
    if (pricingLimitResponse) throw pricingLimitResponse;
    const checkoutValidation = await validateDodo0509PlanCheckout({
      env,
      request,
      plan: target.planFamily,
      cycle: target.cycle,
    });
    if (!checkoutValidation.valid) {
      const checkoutParam = target.cycle === "yearly" ? "annual-unavailable" : "plan-unavailable";
      throw redirect(`/app/billing?checkout=${checkoutParam}&plan=${target.planFamily}`, {
        status: 303,
      });
    }
    pricingContext = checkoutValidation.pricingContext;

    const { claimDodoPlanCheckout } = await import("~/lib/data.server");
    planCheckoutClaimed = await claimDodoPlanCheckout(env, { userId: billingUserId, checkoutId });
    if (!planCheckoutClaimed) {
      throw redirect("/app/billing?checkout=already-started", { status: 303 });
    }
  } else if (currentPlan === "free") {
    throw redirect("/app/billing?checkout=top-up-requires-plan#plans", { status: 303 });
  } else {
    const { validateDodo0509TopUpCheckout } = await import("~/lib/dodo-pricing.server");
    const pricingLimitResponse = await enforceBillingProviderRateLimit(
      request,
      env,
      billingUserId,
      "pricing",
      cloudflare?.ctx,
    );
    if (pricingLimitResponse) throw pricingLimitResponse;
    const checkoutValidation = await validateDodo0509TopUpCheckout({
      env,
      request,
      sku: target.sku,
    });
    if (!checkoutValidation.valid) {
      throw redirect("/app/billing?checkout=top-up-unavailable#top-ups", { status: 303 });
    }
    pricingContext = checkoutValidation.pricingContext;
  }

  let checkout;
  try {
    const mutationLimitResponse = await enforceBillingProviderRateLimit(
      request,
      env,
      billingUserId,
      "mutation",
      cloudflare?.ctx,
    );
    if (mutationLimitResponse) throw mutationLimitResponse;
    checkout = await createDodo0509CheckoutSession({
      env,
      request,
      session: {
        ...session,
        user: {
          ...session.user,
          id: billingUserId,
        },
      },
      target,
      pricingContext,
      checkoutId,
      source,
    });
  } catch (error) {
    if (planCheckoutClaimed) {
      try {
        const { clearDodoPlanCheckout } = await import("~/lib/data.server");
        await clearDodoPlanCheckout(env, billingUserId, { checkoutId });
      } catch (cleanupError) {
        console.error("Failed to clear pending Dodo checkout lock after checkout failure.", cleanupError);
      }
    }
    throw error;
  }

  throw redirect(checkout.checkoutUrl, { status: 303 });
}

function cleanSourceParam(value: FormDataEntryValue | null) {
  const cleaned = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(cleaned) ? cleaned : null;
}

function parseCheckoutTarget(
  request: Request,
  formData: FormData,
  resolveSku: (slug: string) => ReturnType<typeof import("~/lib/dodo-billing.server").checkoutTargetFromSkuSlug>,
) {
  const sku = String(formData.get("sku") ?? "").trim();
  if (sku) {
    const target = resolveSku(sku);
    if (!target) {
      throw invalidCheckoutTargetResponse(request);
    }
    return target;
  }

  const bundle = String(formData.get("bundle") ?? "");
  const legacySku =
    bundle === "proof_500"
      ? "burst_500_v1"
      : bundle === "proof_2000"
        ? "campaign_2000_v1"
        : bundle === "proof_7500"
          ? "scale_7500_v1"
          : "";
  if (legacySku) {
    const target = resolveSku(legacySku);
    if (!target) {
      throw new Response("Top-up SKU is not configured for checkout.", { status: 503 });
    }
    return target;
  }

  const plan = String(formData.get("plan") ?? "");
  const cycle = String(formData.get("cycle") ?? "monthly");
  const mappedCycle = cycle === "yearly" ? "annual" : cycle;
  const planSku = `${plan}_${mappedCycle}_v1`;
  if (plan === "scout" || plan === "starter" || plan === "agency") {
    const target = resolveSku(planSku);
    if (!target) {
      throw new Response("Plan SKU is not configured for checkout.", { status: 503 });
    }
    return target;
  }

  throw invalidCheckoutTargetResponse(request);
}

function invalidCheckoutTargetResponse(request: Request): Response {
  const fetchMode = request.headers.get("Sec-Fetch-Mode")?.trim().toLowerCase();
  const acceptedTypes = request.headers.get("Accept")?.toLowerCase() ?? "";

  if (fetchMode === "navigate" && acceptedTypes.includes("text/html")) {
    return redirect("/app/billing?checkout=invalid-target", { status: 303 });
  }

  return new Response("Invalid Dodo checkout target.", { status: 400 });
}

function isCheckoutPlanSlug(value: string): value is "scout" | "starter" | "agency" {
  return value === "scout" || value === "starter" || value === "agency";
}
