import { Link, useFetcher } from "react-router";

import { isPlanLapsed } from "../lib/billing/entitlements";
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

export function PlanSection({ plan }: { plan: PlanSummary | null }) {
  if (plan === null) return null;
  const lapsed = isPlanLapsed(plan, new Date());
  const upgrade = nextPlan(plan.tier);
  return (
    <section aria-labelledby="settings-plan" className="mt-10 border-t border-line pt-4">
      <h2 id="settings-plan" className={BLOCK_HEADING}>
        Your plan
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">{planLine(plan)}</p>
      {plan.billed ? <BillingButton label={lapsed ? "See billing history" : "Manage or cancel plan"} /> : null}
      {plan.billed && !lapsed ? null : (
        <>
          {upgrade === null ? null : <PlanGate planId={upgrade.id} />}
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
