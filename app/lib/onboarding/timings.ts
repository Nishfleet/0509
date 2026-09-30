export interface OnboardingTimes {
  startedAt: string;
  cardReadyAt: string | null;
  competitorsReadyAt: string | null;
  firstSignalAt: string | null;
}

const CARD_BUDGET_S = 30;
const COMPETITORS_BUDGET_S = 60;

function secondsBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 1000);
}

function secondsLine(label: string, seconds: number | null): string {
  return `${label}: ${seconds === null ? "not yet" : `${String(seconds)}s`}`;
}

function gapSeconds(start: string | null, end: string | null): number | null {
  return start !== null && end !== null ? secondsBetween(start, end) : null;
}

function overBudget(seconds: number | null, budget: number): boolean {
  return seconds !== null && seconds > budget;
}

function budgetNote(over: boolean, budget: number): string {
  return over ? ` (over the ${String(budget)}s budget)` : "";
}

export function onboardingTimingLines(times: OnboardingTimes): string[] {
  const inputToCardSeconds = gapSeconds(times.startedAt, times.cardReadyAt);
  const cardToCompetitorsSeconds = gapSeconds(times.cardReadyAt, times.competitorsReadyAt);
  const competitorsToFirstSignalSeconds = gapSeconds(times.competitorsReadyAt, times.firstSignalAt);
  const startToCompetitorsSeconds =
    times.cardReadyAt === null ? null : gapSeconds(times.startedAt, times.competitorsReadyAt);

  const inputToCard = secondsLine("Input to card", inputToCardSeconds);
  const cardToCompetitors = secondsLine("Card to competitors", cardToCompetitorsSeconds);
  const competitorsToFirstSignal = secondsLine("Competitors to first signal", competitorsToFirstSignalSeconds);

  return [
    `${inputToCard}${budgetNote(overBudget(inputToCardSeconds, CARD_BUDGET_S), CARD_BUDGET_S)}`,
    `${cardToCompetitors}${budgetNote(overBudget(startToCompetitorsSeconds, COMPETITORS_BUDGET_S), COMPETITORS_BUDGET_S)}`,
    competitorsToFirstSignal,
  ];
}
