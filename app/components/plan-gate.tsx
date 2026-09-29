import { useFetcher } from "react-router";

import { monthlyPrice, PLANS, TRIAL_TERMS, type PlanId } from "../lib/billing/plans";
import { Button } from "./ui/button";

export function PlanGate({ planId }: { planId: PlanId }) {
  const fetcher = useFetcher<{ message: string }>();
  const plan = PLANS.find((entry) => entry.id === planId);
  if (plan === undefined) return null;
  const submitting = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" action="/app/upgrade" className="mt-4">
      <input type="hidden" name="plan" value={plan.id} />
      <p className="text-body-sm text-ink-soft">
        {plan.name} watches up to {String(plan.limits.competitors)} competitors.
      </p>
      <Button type="submit" size="lg" className="mt-3" disabled={submitting}>
        {submitting ? "Opening checkout…" : `Upgrade to ${plan.name}`}
        <span className="font-mono text-[0.78rem] font-medium tracking-[0.04em] opacity-80">
          {monthlyPrice(plan.monthlyPriceEur)}
        </span>
      </Button>
      <p className="mt-2 text-body-sm text-ink-soft">{TRIAL_TERMS}</p>
      {fetcher.data?.message ? (
        <p role="status" className="mt-2 text-[0.95rem]">
          {fetcher.data.message}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
