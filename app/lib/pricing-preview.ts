// Local pricing preview types shared by the homepage marketing route and
// the standalone /pricing route. The marketing route is the only one that
// source-renders the preview (Dodo's checkout-localization data must never
// be hardcoded), but both routes need the same shape to render the same
// plan cards, bundles, and yearly/monthly math.

import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";

export type LocalDisplayPrice = {
  amount?: number | null;
  currency?: string | null;
  display?: string | null;
  validationAmount?: number | null;
};

export type LocalAnnualValidation = {
  annualAmount?: number | null;
  billingCountry?: string | null;
  currency?: string | null;
  expectedAnnualAmount?: number | null;
  monthlyAmount?: number | null;
  planId?: PricingPlanSlug | null;
  reason?: string | null;
  valid?: boolean | null;
};

export interface LocalPricingPreview {
  available?: boolean;
  prices?: Partial<
    Record<
      PricingPlanSlug,
      Partial<Record<PricingBillingCycle, LocalDisplayPrice>>
    >
  >;
  annualValidation?: Partial<Record<PricingPlanSlug, LocalAnnualValidation>>;
  usageBundles?: Partial<Record<UsageBundleSlug, LocalDisplayPrice>>;
}

export const NO_PRICING_PREVIEW = { available: false } as const;
