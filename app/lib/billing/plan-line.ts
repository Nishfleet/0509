import { PLANS, type PlanSummary } from "./plans";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function formatDay(value: string | null): string | null {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(parsed) ? null : DAY.format(parsed);
}

function isTrialRunning(plan: PlanSummary, now: Date): boolean {
  const ends = plan.currentPeriodEnd === null ? Number.NaN : Date.parse(plan.currentPeriodEnd);
  return plan.trialing && plan.status === "active" && ends > now.getTime();
}

const ENDED = new Set(["cancelled", "expired"]);

function unbilledLine(plan: PlanSummary, name: string, date: string | null): string {
  if (!ENDED.has(plan.status)) return `You're on ${name}. No payment is set up.`;
  return date === null
    ? `Your paid plan has ended. You're on ${name}.`
    : `Your paid plan ended on ${date}. You're on ${name}.`;
}

export function planLine(plan: PlanSummary, now: Date = new Date()): string {
  const name = PLANS.find((entry) => entry.id === plan.tier)?.name ?? "Scout";
  const date = formatDay(plan.currentPeriodEnd);
  if (!plan.billed) return unbilledLine(plan, name, date);
  if (plan.status === "cancelled") {
    return date === null
      ? `You're on ${name}. It has been cancelled.`
      : `You're on ${name} until ${date}, then it stops.`;
  }
  if (date !== null && isTrialRunning(plan, now)) return `You're on ${name}. Your trial ends on ${date}.`;
  return date === null ? `You're on ${name}.` : `You're on ${name}. It renews on ${date}.`;
}
