import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";

export function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

// Self-serve billing: creates a Dodo customer-portal session (card update,
// cancel, invoices) and 303s into it. Card update matters most — it is the
// dunning escape hatch; without it a failed renewal could only be fixed by
// emailing support.
export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlanBillingInfo } = await import("~/lib/data.server");
  const { createDodoCustomerPortalSession } = await import("~/lib/dodo-billing.server");
  const { enforceBillingProviderRateLimit } = await import("~/lib/rate-limit.server");
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  if (isMember && workspaceUserId !== session.user.id) {
    throw new Response("Only the workspace owner can manage billing.", { status: 403 });
  }

  const billing = await getUserPlanBillingInfo(env, workspaceUserId);
  if (!billing.dodoCustomerId) {
    // No linked Dodo customer yet (e.g. plan granted before linkage existed).
    throw redirect("/app/billing?portal=unavailable", { status: 303 });
  }

  const mutationLimitResponse = await enforceBillingProviderRateLimit(
    request,
    env,
    workspaceUserId,
    "mutation",
    cloudflare?.ctx,
  );
  if (mutationLimitResponse) throw mutationLimitResponse;

  const portalUrl = await createDodoCustomerPortalSession(env, billing.dodoCustomerId, {
    request,
  });
  if (!portalUrl) {
    throw redirect("/app/billing?portal=unavailable", { status: 303 });
  }

  throw redirect(portalUrl, { status: 303 });
}
