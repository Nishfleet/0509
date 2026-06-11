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
  const { createDodo0509CheckoutSession } = await import("~/lib/dodo-billing.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const target = parseCheckoutTarget(formData);

  if (target.kind === "plan") {
    // A subscriber clicking another plan button must never end up with two
    // overlapping live subscriptions. Plan switches go through support until
    // self-serve plan changes exist; usage bundles stay purchasable.
    const { getUserPlan } = await import("~/lib/plan.server");
    const currentPlan = await getUserPlan(env, session.user.id);
    if (currentPlan !== "free") {
      throw redirect("/app/billing?checkout=already-subscribed", { status: 303 });
    }
  }

  const checkout = await createDodo0509CheckoutSession({
    env,
    request,
    session,
    target,
  });

  throw redirect(checkout.checkoutUrl, { status: 303 });
}

function parseCheckoutTarget(formData: FormData) {
  const bundle = String(formData.get("bundle") ?? "");
  if (bundle === "proof_500" || bundle === "proof_2000" || bundle === "proof_7500") {
    return { kind: "usage_bundle", bundle } as const;
  }

  const plan = String(formData.get("plan") ?? "");
  const cycle = String(formData.get("cycle") ?? "monthly");
  if ((plan === "scout" || plan === "starter" || plan === "agency") && (cycle === "monthly" || cycle === "yearly")) {
    return { kind: "plan", plan, cycle } as const;
  }

  throw new Response("Invalid Dodo checkout target.", { status: 400 });
}
