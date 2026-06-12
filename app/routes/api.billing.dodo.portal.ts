import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

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
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlanBillingInfo } = await import("~/lib/data.server");
  const { createDodoCustomerPortalSession } = await import("~/lib/dodo-billing.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);

  const billing = await getUserPlanBillingInfo(env, session.user.id);
  if (!billing.dodoCustomerId) {
    // No linked Dodo customer yet (e.g. plan granted before linkage existed).
    throw redirect("/app/billing?portal=unavailable", { status: 303 });
  }

  const portalUrl = await createDodoCustomerPortalSession(env, billing.dodoCustomerId);
  if (!portalUrl) {
    throw redirect("/app/billing?portal=unavailable", { status: 303 });
  }

  throw redirect(portalUrl, { status: 303 });
}
