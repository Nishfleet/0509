import { parsePlanFamily, type PlanFamily } from "~/lib/plan-entitlements";

export interface EffectivePlanRow {
  plan: string | null;
  dodo_status: string | null;
  dodo_next_billing_at: string | null;
}

// A scheduled cancellation keeps the paid plan until its effective date and
// lapses to free afterwards. Enforcement (plan.server getUserPlan) and display
// (data/billing-plan getUserPlanBillingInfo) must both run through this single
// rule so the dashboard never shows a plan the limits deny.
export function effectivePlanFromRow(row: EffectivePlanRow | null): PlanFamily {
  const parsed = parsePlanFamily(row?.plan);
  if (parsed === "free") {
    return "free";
  }

  const effectiveAtMs = row?.dodo_next_billing_at
    ? Date.parse(row.dodo_next_billing_at)
    : Number.NaN;
  if (
    row?.dodo_status === "cancellation_scheduled" &&
    Number.isFinite(effectiveAtMs) &&
    effectiveAtMs <= Date.now()
  ) {
    return "free";
  }

  return parsed;
}
