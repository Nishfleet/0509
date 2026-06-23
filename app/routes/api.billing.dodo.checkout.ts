import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

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
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const target = parseCheckoutTarget(formData, checkoutTargetFromSkuSlug);
  let planCheckoutClaimed = false;

  const workspace = await resolveWorkspace(env, session.user.id);
  const billingUserId = workspace.workspaceUserId;

  if (target.kind === "plan") {
    const { getUserPlan } = await import("~/lib/plan.server");
    const currentPlan = await getUserPlan(env, billingUserId);
    if (currentPlan !== "free") {
      throw redirect("/app/billing?checkout=already-subscribed", { status: 303 });
    }

    const { claimDodoPlanCheckout } = await import("~/lib/data.server");
    planCheckoutClaimed = await claimDodoPlanCheckout(env, { userId: billingUserId });
    if (!planCheckoutClaimed) {
      throw redirect("/app/billing?checkout=already-started", { status: 303 });
    }
  } else if (billingUserId !== session.user.id && workspace.isMember) {
    throw new Response("Only the workspace owner can purchase top-up packs.", { status: 403 });
  }

  let checkout;
  try {
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
    });
  } catch (error) {
    if (planCheckoutClaimed) {
      const { clearDodoPlanCheckout } = await import("~/lib/data.server");
      await clearDodoPlanCheckout(env, billingUserId);
    }
    throw error;
  }

  throw redirect(checkout.checkoutUrl, { status: 303 });
}

function parseCheckoutTarget(
  formData: FormData,
  resolveSku: (slug: string) => ReturnType<typeof import("~/lib/dodo-billing.server").checkoutTargetFromSkuSlug>,
) {
  const sku = String(formData.get("sku") ?? "").trim();
  if (sku) {
    const target = resolveSku(sku);
    if (!target) {
      throw new Response("Unknown or inactive billing SKU.", { status: 400 });
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

  throw new Response("Invalid Dodo checkout target.", { status: 400 });
}
