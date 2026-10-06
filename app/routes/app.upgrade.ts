import type { Route } from "./+types/app.upgrade";

import { redirect } from "react-router";
import { z } from "zod";

import { createCheckoutUrl } from "../lib/billing/checkout.server";
import { isSubscriptionLive } from "../lib/billing/entitlements";
import { isBillingInterval, isPlanId } from "../lib/billing/plans";
import { readPlanSubscription } from "../lib/data/plan.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireFreshSession } from "../lib/require-session.server";

const UNAVAILABLE = { message: "Upgrading isn't available right now. Try again in a few minutes." };

const HAS_PLAN = { message: "This workspace already has a plan. Change it from Settings." };

const upgradeForm = z.object({
  plan: z.string(),
  interval: z.string().default("monthly"),
});

export function loader() {
  return redirect("/app/settings");
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireFreshSession(request);
  const parsed = upgradeForm.safeParse(Object.fromEntries(await request.formData()));
  const planId = parsed.success ? parsed.data.plan : null;
  const interval = parsed.success ? parsed.data.interval : "monthly";
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null || !isPlanId(planId) || !isBillingInterval(interval)) return UNAVAILABLE;
  const current = await readPlanSubscription(workspaceId);
  if (current !== null && isSubscriptionLive(current, new Date())) return HAS_PLAN;
  const url = await createCheckoutUrl({ planId, interval, workspaceId, email: session.user.email });
  return url === null ? UNAVAILABLE : redirect(url);
}
