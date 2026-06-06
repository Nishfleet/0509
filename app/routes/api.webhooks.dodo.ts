import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    extractDodoPlanGrant,
    extractDodoProofCreditGrant,
    verifyDodoWebhookRequest,
  } = await import("~/lib/dodo-billing.server");
  const { grantDodoPlanAccess, grantProofUsageCredit } = await import("~/lib/data.server");
  const env = getEnv(context);
  const rawBody = await request.text();

  await verifyDodoWebhookRequest(env, request, rawBody);

  const payload = JSON.parse(rawBody) as unknown;
  const planGrant = extractDodoPlanGrant(env, payload);
  if (planGrant) {
    await grantDodoPlanAccess(env, {
      userId: planGrant.userId,
      plan: planGrant.plan,
      providerPaymentId: planGrant.paymentId,
      providerProductId: planGrant.productId,
      status: planGrant.status,
      grantedAt: planGrant.grantedAt,
      metadata: planGrant.metadata,
    });
    return Response.json({ ok: true });
  }

  const grant = extractDodoProofCreditGrant(env, payload);
  if (!grant) {
    return Response.json({ ok: true, ignored: true });
  }

  await grantProofUsageCredit(env, {
    userId: grant.userId,
    providerPaymentId: grant.paymentId,
    providerProductId: grant.productId,
    bundleSlug: grant.bundle,
    credits: grant.credits,
    quantity: grant.quantity,
    grantedAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
    metadata: grant.metadata,
  });

  return Response.json({ ok: true });
}
