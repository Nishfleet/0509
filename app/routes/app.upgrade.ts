import type { Route } from "./+types/app.upgrade";

import { redirect } from "react-router";

import { createCheckoutUrl } from "../lib/billing/checkout.server";
import { isPlanId } from "../lib/billing/plans";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

const UNAVAILABLE = { message: "Upgrading isn't available right now. Try again in a few minutes." };

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const planId = (await request.formData()).get("plan");
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null || !isPlanId(planId)) return UNAVAILABLE;
  const url = await createCheckoutUrl({ planId, workspaceId, email: session.user.email });
  return url === null ? UNAVAILABLE : redirect(url);
}
