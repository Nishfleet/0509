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
    extractDodoPlanRevocation,
    extractDodoProofCreditGrant,
    extractDodoRefund,
    verifyDodoWebhookRequest,
  } = await import("~/lib/dodo-billing.server");
  const {
    claimDodoWebhookEvent,
    getUserIdByEmail,
    grantDodoPlanAccess,
    grantProofUsageCredit,
    markDodoPlanPaymentIssue,
    markDodoWebhookEventFinished,
    revokeDodoAccessForRefundedPayment,
    revokeDodoPlanAccess,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const rawBody = await request.text();

  await verifyDodoWebhookRequest(env, request, rawBody);

  const payload = JSON.parse(rawBody) as unknown;
  const envelope =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const eventType =
    (typeof envelope.type === "string" && envelope.type) ||
    (typeof envelope.event === "string" && envelope.event) ||
    "unknown";
  const eventId =
    request.headers.get("webhook-id") ?? request.headers.get("svix-id") ?? "";
  const payloadTimestamp =
    request.headers.get("webhook-timestamp") ?? request.headers.get("svix-timestamp");

  const claimed = await claimDodoWebhookEvent(env, {
    eventId,
    eventType,
    userId: null,
    payloadTimestamp,
  });
  if (!claimed) {
    // Already processed (or mid-processing) — redeliveries must not re-run
    // billing side effects.
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    const result = await processDodoEvent();
    await markDodoWebhookEventFinished(env, eventId, {
      outcome: result.outcome,
      metadata: result.metadata,
    });
    return Response.json(result.body);
  } catch (error) {
    await markDodoWebhookEventFinished(env, eventId, {
      outcome: "failed",
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }

  async function processDodoEvent(): Promise<{
    outcome: "processed" | "ignored";
    metadata: Record<string, unknown>;
    body: Record<string, unknown>;
  }> {
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
      return {
        outcome: "processed",
        metadata: { action: "plan_grant", userId: planGrant.userId, plan: planGrant.plan },
        body: { ok: true },
      };
    }

    const revocation = extractDodoPlanRevocation(env, payload);
    if (revocation) {
      const userId =
        revocation.userId ??
        (revocation.customerEmail ? await getUserIdByEmail(env, revocation.customerEmail) : null);
      if (!userId) {
        return {
          outcome: "ignored",
          metadata: { action: "lifecycle", reason: "no_user_match" },
          body: { ok: true, ignored: true, reason: "no_user_match" },
        };
      }

      if (revocation.action === "payment_issue") {
        // Renewal payment hiccup: keep the paid plan during Dodo's retry
        // window and only record the issue so the app can warn the customer.
        await markDodoPlanPaymentIssue(env, {
          userId,
          status: revocation.eventType,
          occurredAt: revocation.revokedAt,
        });
        return {
          outcome: "processed",
          metadata: { action: "payment_issue", userId, eventType: revocation.eventType },
          body: { ok: true, paymentIssue: true },
        };
      }

      await revokeDodoPlanAccess(env, {
        userId,
        providerSubscriptionId: revocation.subscriptionId,
        status: revocation.eventType,
        revokedAt: revocation.revokedAt,
      });
      return {
        outcome: "processed",
        metadata: { action: "revoke", userId, eventType: revocation.eventType },
        body: { ok: true, revoked: true },
      };
    }

    const refund = extractDodoRefund(env, payload);
    if (refund) {
      await revokeDodoAccessForRefundedPayment(env, {
        paymentId: refund.paymentId,
        refundedAt: refund.refundedAt,
      });
      return {
        outcome: "processed",
        metadata: { action: "refund", paymentId: refund.paymentId },
        body: { ok: true, refunded: true },
      };
    }

    const grant = extractDodoProofCreditGrant(env, payload);
    if (!grant) {
      return {
        outcome: "ignored",
        metadata: { action: "none" },
        body: { ok: true, ignored: true },
      };
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

    return {
      outcome: "processed",
      metadata: { action: "proof_credit_grant", userId: grant.userId, bundle: grant.bundle },
      body: { ok: true },
    };
  }
}
