import type { PricingPlan, PricingRegion } from "~/lib/types";

export const PRICING_COPY: Record<PricingRegion, { label: string; currency: string }> = {
  india: {
    label: "India pricing",
    currency: "INR",
  },
  rest_of_world: {
    label: "Global pricing",
    currency: "USD",
  },
};

export const PRICING_REGION_COOKIE = "pricing_region";

export function detectPricingRegion(countryCode: string | null | undefined): PricingRegion {
  if (countryCode?.toUpperCase() === "IN") {
    return "india";
  }

  return "rest_of_world";
}

export function pricingPlansForRegion(region: PricingRegion): PricingPlan[] {
  if (region === "india") {
    return [
      {
        name: "Starter",
        monthlyLabel: "Rs 2,500 / month",
        yearlyLabel: "Rs 24,000 / year",
        detail: "Solo or small team. Saved searches, a few watchlists, and weekly digest delivery.",
      },
      {
        name: "Agency",
        monthlyLabel: "Rs 7,500 / month",
        yearlyLabel: "Rs 72,000 / year",
        detail: "Multi-client collections, more watchlists, and exports built for Indian Meta agencies.",
      },
    ];
  }

  return [
    {
      name: "Starter",
      monthlyLabel: "$39 / month",
      yearlyLabel: "$390 / year",
      detail: "Small team plan with saved queries, watchlists, and digest delivery.",
    },
    {
      name: "Agency",
      monthlyLabel: "$129 / month",
      yearlyLabel: "$1,290 / year",
      detail: "Multi-client collections, more exports, and monitoring built for distributed teams.",
    },
  ];
}

export function readPricingRegionCookie(request: Request): PricingRegion | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return null;
  }

  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PRICING_REGION_COOKIE}=`))
    ?.split("=")[1];

  if (value === "india" || value === "rest_of_world") {
    return value;
  }

  return null;
}

export function pricingRegionCookieHeader(region: PricingRegion) {
  return `${PRICING_REGION_COOKIE}=${region}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
