export const PLANS = [
  { id: "scout", name: "Scout", monthlyPriceEur: 10, competitors: 5 },
  { id: "starter", name: "Starter", monthlyPriceEur: 46, competitors: 15 },
  { id: "agency", name: "Agency", monthlyPriceEur: 136, competitors: 50 },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];

export const TRIAL_TERMS =
  "Every plan starts with a 7-day trial. Your card is taken up front and charged on day 8 unless you cancel.";

export function monthlyPrice(eur: number): string {
  return `€${String(eur)}/mo`;
}
