import { PLANS, type PlanId } from "./billing/plans";

export type Plan = (typeof PLANS)[number];

export function planName(id: PlanId): string {
  return PLANS.find((plan) => plan.id === id)?.name ?? id;
}

export function inPickedOrder(picked: PlanId | null): readonly Plan[] {
  return picked === null ? PLANS : [...PLANS].sort((a, b) => Number(b.id === picked) - Number(a.id === picked));
}
