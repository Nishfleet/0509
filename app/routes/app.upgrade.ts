import type { Route } from "./+types/app.upgrade";

import { redirect } from "react-router";
import { z } from "zod";

import { createCheckoutUrl } from "../lib/billing/checkout.server";
import { isBillingInterval, isPlanId } from "../lib/billing/plans";
import { onboardedContext } from "../lib/require-onboarded.server";

const UNAVAILABLE = { message: "Upgrading isn't available right now. Try again in a few minutes." };

const upgradeForm = z.object({
  plan: z.string(),
  interval: z.string().default("monthly"),
});

export function loader() {
  return redirect("/app/settings");
}

export async function action({ request, context }: Route.ActionArgs) {
  const { session, workspaceId } = context.get(onboardedContext);
  const parsed = upgradeForm.safeParse(Object.fromEntries(await request.formData()));
  const planId = parsed.success ? parsed.data.plan : null;
  const interval = parsed.success ? parsed.data.interval : "monthly";
  if (workspaceId === null || !isPlanId(planId) || !isBillingInterval(interval)) return UNAVAILABLE;
  const url = await createCheckoutUrl({ planId, interval, workspaceId, email: session.user.email });
  return url === null ? UNAVAILABLE : redirect(url);
}
