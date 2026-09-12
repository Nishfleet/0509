// POST /api/billing/dodo/cancel-subscription
//
// In-app cancellation path (issue #3168). Schedules the Dodo subscription
// to cancel at the next billing date via the dedicated /cancel endpoint,
// then redirects back to /app/billing with a notice. The portal link
// remains for card / invoice work — this is the *only* in-app way to
// cancel the subscription itself.
//
// The actual cancellation flag flips on Dodo's side; the webhook
// (api.webhooks.dodo.ts) reconciles `cancellation_scheduled` in
// user_plan.dodo_status. The UI re-renders the new lifecycle state via
// the BillingLifecycleSummary once the webhook lands (the form
// submission already redirects with `cancellation=scheduled` so the user
// sees an immediate confirmation).

import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { getEnv } from "~/lib/context.server";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { requireWorkspaceSession } from "~/lib/auth.server";
import { getUserPlanBillingInfo } from "~/lib/data.server";
import { enforceBillingProviderRateLimit } from "~/lib/rate-limit.server";
import { scheduleDodoSubscriptionCancellationImpl } from "~/lib/dodo-billing.server";

export async function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function action({ context, request }: ActionFunctionArgs) {
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  if (isMember && workspaceUserId !== session.user.id) {
    throw new Response("Only the workspace owner can manage billing.", { status: 403 });
  }

  const billing = await getUserPlanBillingInfo(env, workspaceUserId);
  if (!billing.dodoSubscriptionId) {
    throw redirect("/app/billing?cancellation=no-subscription#plans", { status: 303 });
  }
  if (billing.plan === "free") {
    throw redirect("/app/billing?cancellation=no-subscription#plans", { status: 303 });
  }
  if (billing.dodoStatus === "cancellation_scheduled") {
    throw redirect("/app/billing?cancellation=already-scheduled#plans", { status: 303 });
  }
  if (
    billing.dodoStatus === "refunded" ||
    billing.dodoStatus === "subscription.cancelled" ||
    billing.dodoStatus === "subscription.expired"
  ) {
    throw redirect("/app/billing?cancellation=terminal#plans", { status: 303 });
  }

  const limitResponse = await enforceBillingProviderRateLimit(
    request,
    env,
    workspaceUserId,
    "mutation",
    cloudflare?.ctx,
  );
  if (limitResponse) throw limitResponse;

  const outcome = await scheduleDodoSubscriptionCancellationImpl(env, {
    subscriptionId: billing.dodoSubscriptionId,
  });
  if (!outcome.cancellationScheduled) {
    const notice =
      outcome.source === "error" ? "failed" : "no-subscription";
    throw redirect(`/app/billing?cancellation=${notice}#plans`, { status: 303 });
  }

  throw redirect("/app/billing?cancellation=scheduled#plans", { status: 303 });
}