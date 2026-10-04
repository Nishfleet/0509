import type { Route } from "./+types/app.tester";

import { redirect } from "react-router";

import { createTesterCheckoutUrl } from "../lib/billing/checkout.server";
import { isTester } from "../lib/billing/tester.server";
import { isSubscriptionLive } from "../lib/billing/entitlements";
import { readPlanSubscription } from "../lib/data/plan.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireFreshSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireFreshSession(request);
  if (!session.user.emailVerified || !(await isTester(session.user.email)))
    throw new Response("Not found", { status: 404 });
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw new Response("Not found", { status: 404 });
  const current = await readPlanSubscription(workspaceId);
  if (current !== null && isSubscriptionLive(current, new Date())) {
    throw new Response("This workspace already has a plan.", { status: 409 });
  }
  const url = await createTesterCheckoutUrl({ workspaceId, email: session.user.email });
  if (url === null) throw new Response("Tester access isn't available right now.", { status: 503 });
  return redirect(url);
}
