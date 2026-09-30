import { Link, useFetcher } from "react-router";

import { planLine } from "../lib/billing/plan-line";
import type { PlanSummary } from "../lib/billing/plans";
import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";

export function PlanSection({ plan }: { plan: PlanSummary | null }) {
  const fetcher = useFetcher<{ message: string }>();
  if (plan === null) return null;
  const opening = fetcher.state !== "idle";
  return (
    <section aria-labelledby="settings-plan" className="mt-10 border-t border-line pt-4">
      <h2 id="settings-plan" className={BLOCK_HEADING}>
        Your plan
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">{planLine(plan)}</p>
      {plan.billed ? (
        <fetcher.Form method="post" action="/app/settings/billing" className="mt-3">
          <Button type="submit" variant="secondary" size="lg" disabled={opening}>
            {opening ? "Opening…" : "Manage or cancel plan"}
          </Button>
          {fetcher.data?.message ? (
            <p role="status" className="mt-2 text-[0.95rem]">
              {fetcher.data.message}
            </p>
          ) : null}
        </fetcher.Form>
      ) : (
        <Link
          to="/app/competitors"
          className="mt-3 inline-flex min-h-11 items-center gap-2 font-display font-bold underline decoration-1 underline-offset-4"
        >
          Watch more brands <span aria-hidden="true">→</span>
        </Link>
      )}
    </section>
  );
}
