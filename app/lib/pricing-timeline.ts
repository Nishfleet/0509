import type { SiteChangeView } from "./site-change";

export interface PricingStep {
  id: string;
  day: string;
  from: string;
  to: string;
}

const PRICING_PAGE = "pricing page";

export function pricingTimeline(changes: readonly SiteChangeView[]): PricingStep[] {
  return changes
    .filter((change) => change.page === PRICING_PAGE && !change.isSelf)
    .flatMap((change) => {
      const from = change.mark?.removed?.trim() ?? "";
      const to = change.mark?.added?.trim() ?? "";
      if (from === "" || to === "") return [];
      return [{ id: change.id, day: change.observedAt.slice(0, 10), from, to }];
    })
    .sort((a, b) => a.day.localeCompare(b.day));
}
