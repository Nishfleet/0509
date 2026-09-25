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

export function onboardingTimingLines(times: OnboardingTimes): string[] {
  const inputToCardSeconds =
    times.cardReadyAt !== null ? secondsBetween(times.startedAt, times.cardReadyAt) : null;
  const cardToCompetitorsSeconds =
    times.cardReadyAt !== null && times.competitorsReadyAt !== null
      ? secondsBetween(times.cardReadyAt, times.competitorsReadyAt)
      : null;
  const competitorsToFirstSignalSeconds =
    times.competitorsReadyAt !== null && times.firstSignalAt !== null
      ? secondsBetween(times.competitorsReadyAt, times.firstSignalAt)
      : null;

  const inputOverBudget = inputToCardSeconds !== null && inputToCardSeconds > CARD_BUDGET_S;
  const competitorsOverBudget =
    times.cardReadyAt !== null &&
    times.competitorsReadyAt !== null &&
    secondsBetween(times.startedAt, times.competitorsReadyAt) > COMPETITORS_BUDGET_S;

  const inputToCard = secondsLine("Input to card", inputToCardSeconds);
  const cardToCompetitors = secondsLine("Card to competitors", cardToCompetitorsSeconds);
  const competitorsToFirstSignal = secondsLine(
    "Competitors to first signal",
    competitorsToFirstSignalSeconds,
  );

  return [
    `${inputToCard}${inputOverBudget ? " (over the 30s budget)" : ""}`,
    `${cardToCompetitors}${competitorsOverBudget ? " (over the 60s budget)" : ""}`,
    competitorsToFirstSignal,
  ];
}
