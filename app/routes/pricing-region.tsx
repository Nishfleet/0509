import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";

import { pricingRegionCookieHeader } from "~/lib/pricing";
import type { PricingRegion } from "~/lib/types";

export async function action({ context, request }: ActionFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { upsertPricingRegionPreference } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await getOptionalSession(env, request);
  const formData = await request.formData();
  const redirectTo = String(formData.get("redirectTo") ?? "/");
  const region = String(formData.get("region") ?? "rest_of_world") as PricingRegion;

  if (session) {
    await upsertPricingRegionPreference(env, session.user.id, region);
  }

  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": pricingRegionCookieHeader(region),
    },
  });
}
