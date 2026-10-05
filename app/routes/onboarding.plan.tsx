import type { Route } from "./+types/onboarding.plan";

import { data, redirect } from "react-router";
import { z } from "zod";

import { OnboardingFrame } from "../components/onboarding-frame";
import { PlanGate, UpgradeStatus } from "../components/plan-gate";
import { createCheckoutUrl } from "../lib/billing/checkout.server";
import { isWorkspacePaid } from "../lib/billing/entitlements";
import { isBillingInterval, isPlanId, PLANS, TRIAL_TERMS } from "../lib/billing/plans";
import { readPlanSubscription, readPlanTier } from "../lib/data/plan.server";
import { requireFreshSession, requireSession, signOutToLogin } from "../lib/require-session.server";
import { ONBOARDING_PLAN, workspaceLandingForRequest } from "../lib/workspace.server";

const UNAVAILABLE = { message: "Starting a trial isn't available right now. Try again in a few minutes." };

const planForm = z.object({
  plan: z.string(),
  interval: z.string().default("monthly"),
});

async function workspaceFor(request: Request, fresh = false): Promise<{ workspaceId: string; email: string }> {
  const session = await (fresh ? requireFreshSession(request) : requireSession(request));
  const { landing, workspaceId } = await workspaceLandingForRequest(request, session.user);
  if (workspaceId === null) return await signOutToLogin(request);
  if (landing === null) throw redirect("/app");
  if (landing !== ONBOARDING_PLAN) throw redirect(landing);
  return { workspaceId, email: session.user.email };
}

export function meta() {
  return [{ title: "Pick a plan · Five to Nine" }];
}

export function headers() {
  return { "cache-control": "private, no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const { workspaceId } = await workspaceFor(request);
  const wantedRaw = new URL(request.url).searchParams.get("upgraded");
  const wanted = isPlanId(wantedRaw) ? wantedRaw : null;
  const [tier, subscription] = await Promise.all([readPlanTier(workspaceId), readPlanSubscription(workspaceId)]);
  if (isWorkspacePaid(subscription, new Date())) throw redirect("/app");
  return data({ tier, wanted });
}

export async function action({ request }: Route.ActionArgs) {
  const { workspaceId, email } = await workspaceFor(request, true);
  const parsed = planForm.safeParse(Object.fromEntries(await request.formData()));
  const planId = parsed.success ? parsed.data.plan : null;
  const interval = parsed.success ? parsed.data.interval : "monthly";
  if (!isPlanId(planId) || !isBillingInterval(interval)) return UNAVAILABLE;
  const url = await createCheckoutUrl({
    planId,
    interval,
    workspaceId,
    email,
    returnPath: `${ONBOARDING_PLAN}?upgraded=${planId}`,
  });
  return url === null ? UNAVAILABLE : redirect(url);
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <OnboardingFrame step={4} heading="Start your trial">
      <p className="mt-3 max-w-prose leading-[1.55] text-ink-soft">{TRIAL_TERMS}</p>
      <div className="mt-8">
        {PLANS.map((plan) => (
          <PlanGate key={plan.id} planId={plan.id} action={ONBOARDING_PLAN} />
        ))}
      </div>
      <UpgradeStatus tier={loaderData.tier} wanted={loaderData.wanted} />
      {actionData?.message ? (
        <p role="alert" className="mt-4 text-[0.95rem]">
          {actionData.message}
        </p>
      ) : null}
    </OnboardingFrame>
  );
}
