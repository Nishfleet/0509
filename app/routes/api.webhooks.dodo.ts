import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { BillingLifecycleEmailOutboxInput } from "~/lib/delivery.server";

const DODO_WEBHOOK_MAX_BODY_BYTES = 256_000;
type BillingLifecycleEmailKind =
  | "payment_issue"
  | "cancellation_scheduled"
  | "revoke"
  | "refund";

export function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

function webhookTimestampIso(value: string | null) {
  const timestampSeconds = Number(value);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return undefined;
  return new Date(timestampSeconds * 1000).toISOString();
}

function sameBillingInstant(left: string | null | undefined, right: string | null | undefined) {
  const leftMs = Date.parse(left ?? "");
  const rightMs = Date.parse(right ?? "");
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
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
    applyDodoCancellationReversalWithLedger,
    applyDodoPlanGrantWithWatchlistReconcile,
    applyDodoPlanPaymentIssueWithLedger,
    applyDodoPlanRevokeWithWatchlistReconcile,
    applyDodoProofCreditGrantWithLedger,
    applyDodoRefundWithWatchlistReconcile,
    beginDodoWebhookEventProcessing,
    clearDodoPlanCheckout,
    failDodoWebhookEventProcessing,
    failDodoWebhookEventForLifecycleEmailRetry,
    finalizeDodoWebhookLedgerOnly,
    getUserDeliveryProfile,
    getUserIdForDodoPayment,
    getUserIdForDodoLifecycle,
    getUserPlanBillingInfo,
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
  const verifiedWebhookTimestamp = webhookTimestampIso(payloadTimestamp);

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
  const lifecycleEmailRetry = claim.lifecycleEmailRetry ?? null;

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
      const cancellationScheduled = subscriptionGrant.cancellationScheduled === true;
      const planChangedWithoutProviderTimestamp =
        subscriptionGrant.eventType === "subscription.plan_changed" &&
        !subscriptionGrant.hasProviderGrantTimestamp;
      const fallbackGrantAt = planChangedWithoutProviderTimestamp ? verifiedWebhookTimestamp : undefined;
      const acceptedGrantAt = subscriptionGrant.grantedAt ?? fallbackGrantAt;
      const grantLedger = {
        ...ledgerBase,
        outcome: "processed" as const,
        metadata: {
          action: "subscription_grant",
          userId: subscriptionGrant.userId,
          plan: subscriptionGrant.plan,
          eventType: subscriptionGrant.eventType,
        },
      };
      const sendScheduledCancellationEmail = (stateUpdatedAt: string | null) =>
        sendBillingLifecycleEmailSafely(
          "cancellation_scheduled",
          subscriptionGrant.userId,
          (delivery, profile) =>
            delivery.sendBillingCancellationEmail(env, {
              userId: subscriptionGrant.userId,
              email: profile.email,
              name: profile.name,
              kind: "scheduled",
              effectiveAt: subscriptionGrant.nextBillingAt,
              eventId,
              subscriptionId: subscriptionGrant.subscriptionId,
              stateUpdatedAt,
              retryWebhookOnExplicitFailure: true,
            }),
        );
      if (lifecycleEmailRetry?.kind === "cancellation_scheduled") {
        const retryEnvelopeMatches =
          cancellationScheduled &&
          lifecycleEmailRetry.userId === subscriptionGrant.userId &&
          lifecycleEmailRetry.idempotencyKey ===
            `billing-cancellation:${subscriptionGrant.userId}:${eventId}`;
        const currentState = retryEnvelopeMatches
          ? await getUserPlanBillingInfo(env, subscriptionGrant.userId)
          : null;
        const retryIdentityMatches =
          currentState?.dodoStatus === "cancellation_scheduled" &&
          currentState.dodoSubscriptionId === subscriptionGrant.subscriptionId &&
          sameBillingInstant(currentState.dodoNextBillingAt, subscriptionGrant.nextBillingAt) &&
          Number.isFinite(Date.parse(currentState.planUpdatedAt ?? ""));
        await finalizeDodoWebhookLedgerOnly(
          env,
          retryIdentityMatches
            ? grantLedger
            : {
                ...ledgerBase,
                outcome: "ignored",
                metadata: {
                  action: "lifecycle_email_retry_identity_mismatch",
                  userId: lifecycleEmailRetry.userId,
                  eventType: subscriptionGrant.eventType,
                },
              },
        );
        if (retryIdentityMatches) {
          await sendScheduledCancellationEmail(currentState.planUpdatedAt);
        }
        return {
          outcome: retryIdentityMatches ? "processed" : "ignored",
          metadata: retryIdentityMatches
            ? grantLedger.metadata
            : { action: "lifecycle_email_retry_identity_mismatch" },
          body: { ok: true, cancellationScheduled: true },
        };
      }
      const requiresPendingPlanChange =
        planChangedWithoutProviderTimestamp && !cancellationScheduled;
      const allowsPendingPlanChangeTarget =
        planChangedWithoutProviderTimestamp && !cancellationScheduled;
      if (planChangedWithoutProviderTimestamp && !cancellationScheduled && fallbackGrantAt) {
        const cancellationReversal = await applyDodoCancellationReversalWithLedger(
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
            grantedAt: fallbackGrantAt,
            metadata: subscriptionGrant.metadata,
          },
          {
            ...ledgerBase,
            outcome: "processed",
            metadata: {
              action: "cancellation_reversal",
              userId: subscriptionGrant.userId,
              plan: subscriptionGrant.plan,
              eventType: subscriptionGrant.eventType,
            },
          },
        );
        if (cancellationReversal?.changed) {
          return {
            outcome: "processed",
            metadata: {
              action: "cancellation_reversal",
              userId: subscriptionGrant.userId,
              plan: subscriptionGrant.plan,
              eventType: subscriptionGrant.eventType,
            },
            body: { ok: true },
          };
        }
      }
      const cancellationOutbox = cancellationScheduled
        ? await prepareLifecycleEmailOutbox(subscriptionGrant.userId, (profile) => ({
            kind: "cancellation_scheduled",
            userId: subscriptionGrant.userId,
            email: profile.email,
            name: profile.name,
            effectiveAt: subscriptionGrant.nextBillingAt,
            eventId,
            subscriptionId: subscriptionGrant.subscriptionId,
            stateUpdatedAt: acceptedGrantAt ?? null,
          }))
        : undefined;
      const grantApplied = await applyDodoPlanGrantWithWatchlistReconcile(
        env,
        {
          userId: subscriptionGrant.userId,
          plan: subscriptionGrant.plan,
          providerPaymentId: null,
          providerProductId: subscriptionGrant.productId,
          providerSubscriptionId: subscriptionGrant.subscriptionId,
          providerCustomerId: subscriptionGrant.customerId,
          nextBillingAt: subscriptionGrant.nextBillingAt,
          status: cancellationScheduled ? "cancellation_scheduled" : subscriptionGrant.status,
          grantedAt: acceptedGrantAt,
          metadata: subscriptionGrant.metadata,
          forcePlanChangePending: allowsPendingPlanChangeTarget,
          requirePlanChangePending: requiresPendingPlanChange,
          requireProviderIdentityMatch: cancellationScheduled,
        },
        getPlanLimit(subscriptionGrant.plan, "watchlists"),
        grantLedger,
        { lifecycleEmailOutbox: cancellationOutbox },
      );
      if (cancellationScheduled && grantApplied?.changed !== false) {
        await sendScheduledCancellationEmail(acceptedGrantAt ?? null);
      }
      return {
        outcome: "processed",
        metadata: {
          action: "subscription_grant",
          userId: subscriptionGrant.userId,
          plan: subscriptionGrant.plan,
          eventType: subscriptionGrant.eventType,
        },
        body: cancellationScheduled ? { ok: true, cancellationScheduled: true } : { ok: true },
      };
    }

    const revocation = extractDodoPlanRevocation(env, payload);
    if (revocation) {
      const revocationRetryKind: BillingLifecycleEmailKind =
        revocation.action === "payment_issue" ? "payment_issue" : "revoke";
      const retryResolvedUserId =
        lifecycleEmailRetry?.kind === revocationRetryKind
          ? lifecycleEmailRetry.userId
          : null;
      const userId =
        revocation.userId ??
        retryResolvedUserId ??
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
      const lifecycleSubscriptionId =
        revocation.subscriptionId !== revocation.eventType ? revocation.subscriptionId : null;
      const lifecyclePaymentId = lifecycleSubscriptionId ? null : revocation.paymentId;

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

        const paymentIssueOutbox = await prepareLifecycleEmailOutbox(userId, (profile) => ({
          kind: "payment_issue",
          userId,
          email: profile.email,
          name: profile.name,
          occurredAt: revocation.revokedAt,
        }));
        const paymentIssueApplied = await applyDodoPlanPaymentIssueWithLedger(
          env,
          {
            userId,
            status: revocation.eventType,
            occurredAt: revocation.revokedAt,
            providerSubscriptionId: lifecycleSubscriptionId,
            providerPaymentId: lifecyclePaymentId,
          },
          {
            ...ledgerBase,
            outcome: "processed",
            metadata: { action: "payment_issue", userId, eventType: revocation.eventType },
          },
          { lifecycleEmailOutbox: paymentIssueOutbox },
        );
        const matchesPaymentIssueRetry =
          lifecycleEmailRetry?.kind === "payment_issue" &&
          lifecycleEmailRetry.userId === userId;
        const expectedPaymentIssueStateUpdatedAt = paymentIssueApplied?.stateUpdatedAt ?? null;
        const currentPaymentIssueState =
          matchesPaymentIssueRetry && expectedPaymentIssueStateUpdatedAt
            ? await getUserPlanBillingInfo(env, userId)
            : null;
        const shouldRetryPaymentIssueEmail =
          currentPaymentIssueState?.plan !== "free" &&
          currentPaymentIssueState?.dodoStatus === revocation.eventType &&
          sameBillingInstant(
            currentPaymentIssueState.planUpdatedAt,
            expectedPaymentIssueStateUpdatedAt,
          ) &&
          (lifecycleSubscriptionId
            ? currentPaymentIssueState.dodoSubscriptionId === lifecycleSubscriptionId
            : Boolean(lifecyclePaymentId) && currentPaymentIssueState.dodoPaymentId === lifecyclePaymentId);
        if (
          expectedPaymentIssueStateUpdatedAt &&
          (paymentIssueApplied?.changed === true || shouldRetryPaymentIssueEmail)
        ) {
          await sendBillingLifecycleEmailSafely("payment_issue", userId, (delivery, profile) =>
            delivery.sendBillingPaymentIssueEmail(env, {
              userId,
              email: profile.email,
              name: profile.name,
              occurredAt: revocation.revokedAt,
              status: revocation.eventType,
              subscriptionId: lifecycleSubscriptionId,
              paymentId: lifecyclePaymentId,
              stateUpdatedAt: expectedPaymentIssueStateUpdatedAt,
              retryWebhookOnExplicitFailure: true,
            }),
          );
        }
        return {
          outcome: "processed",
          metadata: { action: "payment_issue", userId, eventType: revocation.eventType },
          body: { ok: true, paymentIssue: true },
        };
      }

      const revokeOutbox = await prepareLifecycleEmailOutbox(userId, (profile) => ({
        kind: "revoke",
        userId,
        email: profile.email,
        name: profile.name,
        eventId,
      }));
      const revokeApplied = await applyDodoPlanRevokeWithWatchlistReconcile(
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
        { lifecycleEmailOutbox: revokeOutbox },
      );
      const matchesRevokeRetry =
        lifecycleEmailRetry?.kind === "revoke" && lifecycleEmailRetry.userId === userId;
      const expectedRevokeStateUpdatedAt = revokeApplied?.stateUpdatedAt ?? null;
      const currentRevokeState =
        matchesRevokeRetry && expectedRevokeStateUpdatedAt
          ? await getUserPlanBillingInfo(env, userId)
          : null;
      const shouldRetryRevokeEmail =
        currentRevokeState?.plan === "free" &&
        currentRevokeState.dodoStatus === revocation.eventType &&
        lifecycleSubscriptionId !== null &&
        currentRevokeState.dodoSubscriptionId === lifecycleSubscriptionId &&
        sameBillingInstant(currentRevokeState.planUpdatedAt, expectedRevokeStateUpdatedAt);
      if (
        expectedRevokeStateUpdatedAt &&
        (revokeApplied?.changed === true || shouldRetryRevokeEmail)
      ) {
        await sendBillingLifecycleEmailSafely("revoke", userId, (delivery, profile) =>
          delivery.sendBillingCancellationEmail(env, {
            userId,
            email: profile.email,
            name: profile.name,
            kind: "ended",
            eventId,
            status: revocation.eventType,
            subscriptionId: lifecycleSubscriptionId,
            stateUpdatedAt: expectedRevokeStateUpdatedAt,
            retryWebhookOnExplicitFailure: true,
          }),
        );
      }
      return {
        outcome: "processed",
        metadata: { action: "revoke", userId, eventType: revocation.eventType },
        body: { ok: true, revoked: true },
      };
    }

    const refund = extractDodoRefund(env, payload);
    if (refund) {
      const retryResolvedUserId =
        lifecycleEmailRetry?.kind === "refund" ? lifecycleEmailRetry.userId : null;
      const refundedUserId =
        retryResolvedUserId ?? (await getUserIdForDodoPayment(env, refund.paymentId));
      const refundOutbox = refundedUserId
        ? await prepareLifecycleEmailOutbox(refundedUserId, (profile) => ({
            kind: "refund",
            userId: refundedUserId,
            email: profile.email,
            name: profile.name,
            eventId,
          }))
        : undefined;
      const refundApplied = await applyDodoRefundWithWatchlistReconcile(
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
        { lifecycleEmailOutbox: refundOutbox },
      );
      const matchesRefundRetry =
        lifecycleEmailRetry?.kind === "refund" &&
        lifecycleEmailRetry.userId === refundedUserId;
      const expectedRefundStateUpdatedAt = refundApplied?.stateUpdatedAt ?? null;
      const currentRefundState =
        refundedUserId &&
        expectedRefundStateUpdatedAt &&
        (refundApplied?.changed === true || matchesRefundRetry)
          ? await getUserPlanBillingInfo(env, refundedUserId)
          : null;
      const refundStateMatches =
        currentRefundState?.plan === "free" &&
        currentRefundState.dodoStatus === "refunded" &&
        currentRefundState.dodoPaymentId === refund.paymentId &&
        sameBillingInstant(currentRefundState.planUpdatedAt, expectedRefundStateUpdatedAt);
      if (
        refundedUserId &&
        refundStateMatches &&
        (refundApplied?.changed === true || matchesRefundRetry)
      ) {
        await sendBillingLifecycleEmailSafely("refund", refundedUserId, (delivery, profile) =>
          delivery.sendBillingRefundEmail(env, {
            userId: refundedUserId,
            email: profile.email,
            name: profile.name,
            eventId,
            paymentId: refund.paymentId,
            stateUpdatedAt: expectedRefundStateUpdatedAt,
            retryWebhookOnExplicitFailure: true,
          }),
        );
      }
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

  async function prepareLifecycleEmailOutbox(
    lifecycleUserId: string,
    build: (profile: { email: string; name: string | null }) => BillingLifecycleEmailOutboxInput,
  ) {
    try {
      const profile = await getUserDeliveryProfile(env, lifecycleUserId);
      if (!profile?.email) {
        return undefined;
      }
      const delivery = await import("~/lib/delivery.server");
      return await delivery.prepareBillingLifecycleEmailOutbox(
        env,
        build({ email: profile.email, name: profile.name }),
      );
    } catch {
      return undefined;
    }
  }

  async function sendBillingLifecycleEmailSafely(
    kind: BillingLifecycleEmailKind,
    lifecycleUserId: string,
    send: (
      delivery: typeof import("~/lib/delivery.server"),
      profile: { email: string; name: string | null },
    ) => Promise<unknown>,
  ) {
    let delivery: typeof import("~/lib/delivery.server") | null = null;
    try {
      const profile = await getUserDeliveryProfile(env, lifecycleUserId);
      if (!profile?.email || profile.emailVerified !== true) {
        return;
      }
      delivery = await import("~/lib/delivery.server");
      await send(delivery, { email: profile.email, name: profile.name });
    } catch (error) {
      const { logBillingEvent } = await import("~/lib/log.server");
      logBillingEvent(env, "error", "dodo.webhook.lifecycle_email", "Billing lifecycle email failed", {
        eventId,
        details: {
          kind,
          userId: lifecycleUserId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (delivery?.isBillingLifecycleEmailExplicitFailure(error)) {
        const retryArmed = await failDodoWebhookEventForLifecycleEmailRetry(env, eventId, {
          kind,
          userId: lifecycleUserId,
          idempotencyKey: error.idempotencyKey,
          error: error.message,
        });
        if (retryArmed) {
          throw error;
        }
      }
    }
  }
}
