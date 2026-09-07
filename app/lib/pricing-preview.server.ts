import type { AppEnv } from "~/lib/env.server";
import type { LocalPricingPreview } from "~/components/pricing-section";

export const noPricingPreview = { available: false } as const;

const PRICING_SSR_TIMEOUT_MS = 2500;

export async function pricingPreviewWithinBound({
  env,
  request,
}: {
  env: AppEnv;
  request: Request;
}): Promise<LocalPricingPreview | typeof noPricingPreview> {
  const { previewDodo0509PlanPrices } = await import("~/lib/dodo-pricing.server");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const preview = await Promise.race([
      previewDodo0509PlanPrices({ env, request }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("pricing preview exceeded SSR bound")),
          PRICING_SSR_TIMEOUT_MS,
        );
      }),
    ]);
    return preview.available ? preview : noPricingPreview;
  } catch {
    return noPricingPreview;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
