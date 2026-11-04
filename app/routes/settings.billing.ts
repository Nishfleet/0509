import type { Route } from "./+types/settings.billing";

import { redirect } from "react-router";

import { createPortalUrl } from "../lib/billing/portal.server";
import { readPlanCustomerId } from "../lib/data/plan.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { sessionContext } from "../lib/require-session.server";

const UNAVAILABLE = { message: "We couldn't open your billing page. Try again in a few minutes." };

export async function action({ context }: Route.ActionArgs) {
  const session = context.get(sessionContext);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const customerId = workspaceId === null ? null : await readPlanCustomerId(workspaceId);
  const url = customerId === null ? null : await createPortalUrl(customerId);
  return url === null ? UNAVAILABLE : redirect(url);
}
