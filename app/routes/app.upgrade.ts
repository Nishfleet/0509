import type { Route } from "./+types/app.upgrade";

import { redirect } from "react-router";
import { z } from "zod";

import { changeSubscriptionPlan } from "../lib/billing/change-plan.server";
import { createCheckoutUrl } from "../lib/billing/checkout.server";
import { isSubscriptionLive } from "../lib/billing/subscription-state";
import { returningLookup } from "../lib/billing/returning.server";
import { canSwitchPlan, isBillingInterval, isPlanId, type PlanId } from "../lib/billing/plans";
import { readPlanSubscription, readPlanSummary, type PlanSubscription } from "../lib/data/plan.server";
import { readBillingWorkspaceId } from "../lib/data/workspace.server";
import { onboardedContext } from "../lib/require-onboarded.server";

const UNAVAILABLE = { message: "Upgrading isn't available right now. Try again in a few minutes." };

const HAS_PLAN = { message: "You are already on this plan." };

const upgradeForm = z.object({
  plan: z.string(),
  interval: z.string().default("monthly"),
});

const SWITCH_FAILED = { message: "We couldn't change your plan. You weren't charged. Try again in a few minutes." };

const SWITCH_NOT_NOW = { message: "You can't switch plans right now. Use Manage or cancel plan on this page." };

export function loader() {
  return redirect("/app/settings");
}

async function billingWorkspace(opened: string | null): Promise<string | null> {
  return opened === null ? null : readBillingWorkspaceId(opened);
}

async function switchPlan(workspaceId: string, planId: PlanId, subscriptionId: string | null) {
  const summary = await readPlanSummary(workspaceId);
  if (subscriptionId === null || !canSwitchPlan(summary, planId)) return SWITCH_NOT_NOW;
  const changed = await changeSubscriptionPlan(subscriptionId, planId);
  return changed ? redirect(`/app/competitors?upgraded=${planId}`) : SWITCH_FAILED;
}

function livePlanAnswer(workspaceId: string, planId: PlanId, current: PlanSubscription | null) {
  if (current === null || !isSubscriptionLive(current, new Date())) return null;
  return planId === current.tier ? HAS_PLAN : switchPlan(workspaceId, planId, current.subscriptionId);
}

export async function action({ request, context }: Route.ActionArgs) {
  const { session, workspaceId: opened } = context.get(onboardedContext);
  const workspaceId = await billingWorkspace(opened);
  const parsed = upgradeForm.safeParse(Object.fromEntries(await request.formData()));
  const planId = parsed.success ? parsed.data.plan : null;
  const interval = parsed.success ? parsed.data.interval : "monthly";
  if (workspaceId === null || !isPlanId(planId) || !isBillingInterval(interval)) return UNAVAILABLE;
  const current = await readPlanSubscription(workspaceId);
  const live = await livePlanAnswer(workspaceId, planId, current);
  if (live !== null) return live;
  const returning = await returningLookup(current);
  if (returning === null) return UNAVAILABLE;
  const url = await createCheckoutUrl({ planId, interval, workspaceId, email: session.user.email, returning });
  return url === null ? UNAVAILABLE : redirect(url);
}
