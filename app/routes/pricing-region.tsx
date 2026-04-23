import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { pricingRegionCookieHeader } from "~/lib/pricing";
import type { PricingRegion } from "~/lib/types";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  return redirect(safeLocalRedirect(url.searchParams.get("redirectTo")));
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { upsertPricingRegionPreference } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await getOptionalSession(env, request);
  const formData = await request.formData();
  const redirectTo = safeLocalRedirect(String(formData.get("redirectTo") ?? "/"));
  const region = normalizePricingRegion(formData.get("region"));

  if (session) {
    await upsertPricingRegionPreference(env, session.user.id, region);
  }

  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": pricingRegionCookieHeader(region),
    },
  });
}

function normalizePricingRegion(value: FormDataEntryValue | null): PricingRegion {
  return value === "india" || value === "rest_of_world" ? value : "rest_of_world";
}

function safeLocalRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
