import type { Route } from "./+types/app.upgrade";

import { redirect } from "react-router";

import { createCheckoutUrl } from "../lib/billing/checkout.server";
import { isBillingInterval, isPlanId } from "../lib/billing/plans";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireFreshSession } from "../lib/require-session.server";

const UNAVAILABLE = { message: "Upgrading isn't available right now. Try again in a few minutes." };

export function loader() {
  return redirect("/app/settings");
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireFreshSession(request);
  const form = await request.formData();
  const planId = form.get("plan");
  const interval = form.get("interval") ?? "monthly";
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null || !isPlanId(planId) || !isBillingInterval(interval)) return UNAVAILABLE;
  const url = await createCheckoutUrl({ planId, interval, workspaceId, email: session.user.email });
  return url === null ? UNAVAILABLE : redirect(url);
}
