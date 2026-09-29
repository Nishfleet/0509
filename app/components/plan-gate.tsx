import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

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

const POLL_MS = 3000;
const MAX_POLLS = 20;

export function UpgradeStatus({ tier, wanted }: { tier: PlanId; wanted: PlanId | null }) {
  const { revalidate } = useRevalidator();
  const [gaveUp, setGaveUp] = useState(false);
  const pending = wanted !== null && tier !== wanted;
  useEffect(() => {
    if (!pending) return;
    let polls = 0;
    const id = setInterval(() => {
      polls += 1;
      if (polls >= MAX_POLLS) {
        clearInterval(id);
        setGaveUp(true);
      }
      void revalidate();
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [pending, revalidate]);
  const plan = PLANS.find((entry) => entry.id === wanted);
  if (plan === undefined) return null;
  if (!pending) {
    return (
      <p role="status" className="text-body-sm mt-4">
        You're on {plan.name}. It watches up to {String(plan.limits.competitors)} competitors.
      </p>
    );
  }
  return (
    <p role="status" className="text-body-sm text-ink-soft mt-4">
      {gaveUp
        ? "We haven't heard back from our payment provider yet. Your plan turns on the moment we do."
        : `Confirming your ${plan.name} plan with our payment provider. This page updates by itself.`}
    </p>
  );
}
