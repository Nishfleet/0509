import { isPaymentFailed, isPaymentHeld, isPlanLapsed } from "./subscription-state";
import { PLANS, type PlanSummary } from "./plans";
import { APP_LOCALE } from "../locale";

const DAY = new Intl.DateTimeFormat(APP_LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function formatDay(value: string | null): string | null {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(parsed) ? null : DAY.format(parsed);
}

function isTrialRunning(plan: PlanSummary, now: Date): boolean {
  const ends = plan.currentPeriodEnd === null ? Number.NaN : Date.parse(plan.currentPeriodEnd);
  return plan.trialing && plan.status === "active" && ends > now.getTime();
}

function endedLine(name: string, date: string | null): string {
  return date === null
    ? `Your paid plan has ended. You're on ${name}.`
    : `Your paid plan ended on ${date}. You're on ${name}.`;
}

function troubledLine(plan: PlanSummary, name: string): string | null {
  const dropsToScout = plan.tier !== "scout";
  if (isPaymentHeld(plan)) {
    return `Your last payment for ${name} didn't go through, so it's paused${dropsToScout ? " and you're on Scout" : ""}. Update your card to switch it back on.`;
  }
  return isPaymentFailed(plan)
    ? `Your payment for ${name} didn't go through${dropsToScout ? ", so you're on Scout" : ""}.`
    : null;
}

function runningLine(plan: PlanSummary, name: string, now: Date): string {
  const date = formatDay(plan.currentPeriodEnd);
  if (!plan.billed) return `You're on ${name}. No payment is set up.`;
  const troubled = troubledLine(plan, name);
  if (troubled !== null) return troubled;
  if (plan.status === "cancelled") {
    return date === null
      ? `You're on ${name}. It has been cancelled.`
      : `You're on ${name} until ${date}, then it stops.`;
  }
  if (date !== null && isTrialRunning(plan, now)) return `You're on ${name}. Your trial ends on ${date}.`;
  return date === null ? `You're on ${name}.` : `You're on ${name}. It renews on ${date}.`;
}

export function planLine(plan: PlanSummary, now: Date): string {
  const name = PLANS.find((entry) => entry.id === plan.tier)?.name ?? "Scout";
  if (!isPlanLapsed(plan, now)) return runningLine(plan, name, now);
  return endedLine(name, formatDay(plan.currentPeriodEnd));
}
