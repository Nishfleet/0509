import { Link, useFetcher } from "react-router";

import { isPaymentFailed, isPaymentHeld, isPlanLapsed } from "../lib/billing/subscription-state";
import { planLine } from "../lib/billing/plan-line";
import { nextPlan, type PlanSummary } from "../lib/billing/plans";
import { BLOCK_HEADING } from "./page-heading";
import { PlanGate } from "./plan-gate";
import { Button } from "./ui/button";

function BillingButton({ label }: { label: string }) {
  const fetcher = useFetcher<{ message: string }>();
  const opening = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" action="/app/settings/billing" className="mt-3">
      <Button type="submit" variant="secondary" size="lg" disabled={opening}>
        {opening ? "Opening…" : label}
      </Button>
      {fetcher.data?.message ? (
        <p role="alert" className="mt-2 text-[0.95rem]">
          {fetcher.data.message}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

function billingLabel(plan: PlanSummary, retryable: boolean): string {
  if (isPaymentHeld(plan)) return "Update payment method";
  if (retryable) return "See billing history";
  return plan.status === "cancelled" ? "Manage billing" : "Manage or cancel plan";
}

export function PlanSection({ plan, returning = false }: { plan: PlanSummary | null; returning?: boolean }) {
  if (plan === null) return null;
  const retryable = isPlanLapsed(plan, new Date()) || isPaymentFailed(plan);
  const upgrade = nextPlan(plan.tier);
  return (
    <section aria-labelledby="settings-plan" className="mt-10 border-t border-line pt-4">
      <h2 id="settings-plan" className={BLOCK_HEADING}>
        Your plan
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">{planLine(plan)}</p>
      {plan.billed ? <BillingButton label={billingLabel(plan, retryable)} /> : null}
      {plan.billed && !retryable ? null : (
        <>
          {upgrade === null ? null : <PlanGate planId={upgrade.id} returning={returning} />}
          <Link
            to="/app/competitors"
            className="mt-3 inline-flex min-h-11 items-center gap-2 font-display font-bold underline decoration-1 underline-offset-4"
          >
            Watch more brands <span aria-hidden="true">→</span>
          </Link>
        </>
      )}
    </section>
  );
}
