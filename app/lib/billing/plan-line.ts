import { PLANS, type PlanSummary } from "./plans";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function planLine(plan: PlanSummary): string {
  const name = PLANS.find((entry) => entry.id === plan.tier)?.name ?? "Scout";
  const parsed = plan.currentPeriodEnd === null ? Number.NaN : Date.parse(plan.currentPeriodEnd);
  const date = Number.isNaN(parsed) ? null : DAY.format(parsed);
  if (!plan.billed) return `You're on ${name}. No payment is set up.`;
  if (plan.status === "cancelled") {
    return date === null
      ? `You're on ${name}. It has been cancelled.`
      : `You're on ${name} until ${date}, then it stops.`;
  }
  return date === null ? `You're on ${name}.` : `You're on ${name}. It renews on ${date}.`;
}
