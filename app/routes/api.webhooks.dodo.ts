import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const DODO_WEBHOOK_MAX_BODY_BYTES = 256_000;

export function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { readRequestTextWithinLimit } = await import("~/lib/bounded-response.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    extractDodoPlanGrant,
    extractDodoPlanCheckoutFailure,
    extractDodoPlanRevocation,
    extractDodoProofCreditGrant,
    extractDodoRefund,
    extractDodoSubscriptionGrant,
    verifyDodoWebhookRequest,
  } = await import("~/lib/dodo-billing.server");
  const {
    applyDodoPlanGrantWithWatchlistReconcile,
    applyDodoPlanPaymentIssueWithLedger,
    applyDodoPlanRevokeWithWatchlistReconcile,
    applyDodoProofCreditGrantWithLedger,
    applyDodoRefundWithWatchlistReconcile,
    beginDodoWebhookEventProcessing,
    clearDodoPlanCheckout,
    failDodoWebhookEventProcessing,
    finalizeDodoWebhookLedgerOnly,
    getUserIdForDodoPayment,
    getUserIdForDodoLifecycle,
  } = await import("~/lib/data.server");
  const { getPlanLimit } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const rawBody = await readRequestTextWithinLimit(request, DODO_WEBHOOK_MAX_BODY_BYTES);
  if (rawBody === null) {
    throw new Response("Dodo webhook payload is too large.", { status: 413 });
  }

  await verifyDodoWebhookRequest(env, request, rawBody);

  const payload = JSON.parse(rawBody) as unknown;
  const envelope =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const eventType =
    (typeof envelope.type === "string" && envelope.type) ||
    (typeof envelope.event === "string" && envelope.event) ||
    "unknown";
  const eventId = (request.headers.get("webhook-id") ?? request.headers.get("svix-id") ?? "").trim();
  if (!eventId) {
    throw new Response("Missing Dodo webhook id.", { status: 400 });
  }
  const payloadTimestamp =
    request.headers.get("webhook-timestamp") ?? request.headers.get("svix-timestamp");

  const claim = await beginDodoWebhookEventProcessing(env, {
    eventId,
    eventType,
    userId: null,
    payloadTimestamp,
  });
  if (claim.status === "duplicate") {
    return Response.json({ ok: true, duplicate: true, outcome: claim.outcome });
  }
  if (claim.status === "in_progress") {
    return Response.json({ ok: true, duplicate: true, inProgress: true });
  }

  try {
    const result = await processDodoEvent();
    return Response.json(result.body);
  } catch (error) {
    const { logBillingEvent } = await import("~/lib/log.server");
    logBillingEvent(env, "error", "dodo.webhook.process", "Dodo webhook processing failed", {
      eventId,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    await failDodoWebhookEventProcessing(env, eventId, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  async function processDodoEvent(): Promise<{
    outcome: "processed" | "ignored";
    metadata: Record<string, unknown>;
    body: Record<string, unknown>;
  }> {
    const ledgerBase = { eventId };
    let subscriptionFailureWithCheckoutIdDidNotClear = false;
    const planGrant = extractDodoPlanGrant(env, payload);
    if (planGrant) {
      await applyDodoPlanGrantWithWatchlistReconcile(
        env,
        {
          userId: planGrant.userId,
          plan: planGrant.plan,
          providerPaymentId: planGrant.paymentId,
          providerProductId: planGrant.productId,
          providerSubscriptionId: planGrant.subscriptionId,
          providerCustomerId: planGrant.customerId,
          status: planGrant.status,
          grantedAt: planGrant.grantedAt,
          metadata: planGrant.metadata,
        },
        getPlanLimit(planGrant.plan, "watchlists"),
        {
          ...ledgerBase,
          outcome: "processed",
          metadata: { action: "plan_grant", userId: planGrant.userId, plan: planGrant.plan },
        },
      );
      return {
        outcome: "processed",
        metadata: { action: "plan_grant", userId: planGrant.userId, plan: planGrant.plan },
        body: { ok: true },
      };
    }

    const checkoutFailure = extractDodoPlanCheckoutFailure(env, payload);
    if (checkoutFailure) {
      let clearedCheckout = false;
      if (checkoutFailure.checkoutId || checkoutFailure.eventType !== "subscription.failed") {
        clearedCheckout = checkoutFailure.checkoutId
          ? await clearDodoPlanCheckout(env, checkoutFailure.userId, {
              allowMissingStoredCheckoutId: true,
              checkoutId: checkoutFailure.checkoutId,
              occurredAt: checkoutFailure.failedAt,
              requireMissingStoredCheckoutId: false,
            })
          : await clearDodoPlanCheckout(env, checkoutFailure.userId, {
              allowTimestampMatchedStoredCheckoutId: true,
              checkoutId: null,
              occurredAt: checkoutFailure.failedAt,
            });
      }
      const shouldDeferSubscriptionFailureToLifecycle =
        checkoutFailure.eventType === "subscription.failed" && !clearedCheckout;
      subscriptionFailureWithCheckoutIdDidNotClear =
        shouldDeferSubscriptionFailureToLifecycle && Boolean(checkoutFailure.checkoutId);
      // Dodo also emits subscription.failed for active subscription payment
      // issues. Only classify it as checkout failure when it cleared the
      // matching pending checkout lock.
      if (!shouldDeferSubscriptionFailureToLifecycle) {
        await finalizeDodoWebhookLedgerOnly(env, {
          ...ledgerBase,
          outcome: "processed",
          metadata: {
            action: "checkout_failure",
            checkoutId: checkoutFailure.checkoutId,
            userId: checkoutFailure.userId,
            eventType: checkoutFailure.eventType,
            status: checkoutFailure.status,
          },
        });
        return {
          outcome: "processed",
          metadata: {
            action: "checkout_failure",
            checkoutId: checkoutFailure.checkoutId,
            userId: checkoutFailure.userId,
            eventType: checkoutFailure.eventType,
            status: checkoutFailure.status,
          },
          body: { ok: true, checkoutFailure: true },
        };
      }
    }

    const subscriptionGrant = extractDodoSubscriptionGrant(env, payload);
    if (subscriptionGrant) {
      await applyDodoPlanGrantWithWatchlistReconcile(
        env,
        {
          userId: subscriptionGrant.userId,
          plan: subscriptionGrant.plan,
          providerPaymentId: null,
          providerProductId: subscriptionGrant.productId,
          providerSubscriptionId: subscriptionGrant.subscriptionId,
          providerCustomerId: subscriptionGrant.customerId,
          nextBillingAt: subscriptionGrant.nextBillingAt,
          status: subscriptionGrant.status,
          grantedAt: subscriptionGrant.grantedAt,
          metadata: subscriptionGrant.metadata,
        },
        getPlanLimit(subscriptionGrant.plan, "watchlists"),
        {
          ...ledgerBase,
          outcome: "processed",
          metadata: {
            action: "subscription_grant",
            userId: subscriptionGrant.userId,
            plan: subscriptionGrant.plan,
            eventType: subscriptionGrant.eventType,
          },
        },
      );
      return {
        outcome: "processed",
        metadata: {
          action: "subscription_grant",
          userId: subscriptionGrant.userId,
          plan: subscriptionGrant.plan,
          eventType: subscriptionGrant.eventType,
        },
        body: { ok: true },
      };
    }

    const revocation = extractDodoPlanRevocation(env, payload);
    if (revocation) {
      const userId =
        revocation.userId ??
        (await getUserIdForDodoLifecycle(env, {
          subscriptionId: revocation.subscriptionId,
          customerId: revocation.customerId,
          customerEmail: revocation.customerEmail,
        }));
      if (!userId) {
        await finalizeDodoWebhookLedgerOnly(env, {
          ...ledgerBase,
          outcome: "ignored",
          metadata: { action: "lifecycle", reason: "no_user_match" },
        });
        return {
          outcome: "ignored",
          metadata: { action: "lifecycle", reason: "no_user_match" },
          body: { ok: true, ignored: true, reason: "no_user_match" },
        };
      }

      if (revocation.action === "payment_issue") {
        if (
          revocation.eventType === "subscription.failed" &&
          !subscriptionFailureWithCheckoutIdDidNotClear
        ) {
          const clearedCheckout = await clearDodoPlanCheckout(env, userId, {
            allowTimestampMatchedStoredCheckoutId: true,
            occurredAt: revocation.revokedAt,
          });
          if (clearedCheckout) {
            await finalizeDodoWebhookLedgerOnly(env, {
              ...ledgerBase,
              outcome: "processed",
              metadata: {
                action: "checkout_failure",
                checkoutId: null,
                userId,
                eventType: revocation.eventType,
                status: revocation.status,
              },
            });
            return {
              outcome: "processed",
              metadata: {
                action: "checkout_failure",
                checkoutId: null,
                userId,
                eventType: revocation.eventType,
                status: revocation.status,
              },
              body: { ok: true, checkoutFailure: true },
            };
          }
        }

        await applyDodoPlanPaymentIssueWithLedger(
          env,
          {
            userId,
            status: revocation.eventType,
            occurredAt: revocation.revokedAt,
          },
          {
            ...ledgerBase,
            outcome: "processed",
            metadata: { action: "payment_issue", userId, eventType: revocation.eventType },
          },
        );
        return {
          outcome: "processed",
          metadata: { action: "payment_issue", userId, eventType: revocation.eventType },
          body: { ok: true, paymentIssue: true },
        };
      }

      const effectiveAtMs = Date.parse(revocation.effectiveAt ?? "");
      if (
        revocation.eventType === "subscription.cancelled" &&
        Number.isFinite(effectiveAtMs) &&
        effectiveAtMs > Date.now() + 60_000
      ) {
        await applyDodoPlanPaymentIssueWithLedger(
          env,
          {
            userId,
            status: "cancellation_scheduled",
            occurredAt: new Date().toISOString(),
            cancellationEffectiveAt: revocation.effectiveAt,
          },
          {
            ...ledgerBase,
            outcome: "processed",
            metadata: {
              action: "cancellation_scheduled",
              userId,
              effectiveAt: revocation.effectiveAt,
            },
          },
        );
        return {
          outcome: "processed",
          metadata: {
            action: "cancellation_scheduled",
            userId,
            effectiveAt: revocation.effectiveAt,
          },
          body: { ok: true, cancellationScheduled: true },
        };
      }

      await applyDodoPlanRevokeWithWatchlistReconcile(
        env,
        {
          userId,
          providerSubscriptionId: revocation.subscriptionId,
          status: revocation.eventType,
          revokedAt: revocation.revokedAt,
        },
        getPlanLimit("free", "watchlists"),
        {
          ...ledgerBase,
          outcome: "processed",
          metadata: { action: "revoke", userId, eventType: revocation.eventType },
        },
      );
      return {
        outcome: "processed",
        metadata: { action: "revoke", userId, eventType: revocation.eventType },
        body: { ok: true, revoked: true },
      };
    }

    const refund = extractDodoRefund(env, payload);
    if (refund) {
      const refundedUserId = await getUserIdForDodoPayment(env, refund.paymentId);
      await applyDodoRefundWithWatchlistReconcile(
        env,
        {
          paymentId: refund.paymentId,
          refundedAt: refund.refundedAt,
          userId: refundedUserId,
        },
        getPlanLimit("free", "watchlists"),
        {
          ...ledgerBase,
          outcome: "processed",
          metadata: { action: "refund", paymentId: refund.paymentId },
        },
      );
      return {
        outcome: "processed",
        metadata: { action: "refund", paymentId: refund.paymentId },
        body: { ok: true, refunded: true },
      };
    }

    const grant = extractDodoProofCreditGrant(env, payload);
    if (!grant) {
      await finalizeDodoWebhookLedgerOnly(env, {
        ...ledgerBase,
        outcome: "ignored",
        metadata: { action: "none" },
      });
      return {
        outcome: "ignored",
        metadata: { action: "none" },
        body: { ok: true, ignored: true },
      };
    }

    await applyDodoProofCreditGrantWithLedger(
      env,
      {
        userId: grant.userId,
        providerPaymentId: grant.paymentId,
        providerProductId: grant.productId,
        bundleSlug: grant.bundle,
        skuSlug: grant.skuSlug,
        credits: grant.credits,
        quantity: grant.quantity,
        grantedAt: grant.grantedAt,
        metadata: grant.metadata,
      },
      {
        ...ledgerBase,
        outcome: "processed",
        metadata: { action: "proof_credit_grant", userId: grant.userId, bundle: grant.bundle },
      },
    );

    return {
      outcome: "processed",
      metadata: { action: "proof_credit_grant", userId: grant.userId, bundle: grant.bundle },
      body: { ok: true },
    };
  }
}
