import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { billingCanaryLockBelongsToUser } from "~/lib/billing-canary-lock";
import type { BillingLifecycleEmailOutboxInput } from "~/lib/delivery.server";
import type { AppEnv } from "~/lib/env.server";

const DODO_WEBHOOK_MAX_BODY_BYTES = 256_000;
const DODO_WEBHOOK_PROCESSING_FAILURE_MESSAGE =
  "Dodo webhook processing failed. The event will be retried.";
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

function webhookEventOccurrenceIso(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return undefined;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function sameBillingInstant(left: string | null | undefined, right: string | null | undefined) {
  const leftMs = Date.parse(left ?? "");
  const rightMs = Date.parse(right ?? "");
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

async function getUserIdFromActiveBillingCanaryOriginalPayment(
  env: AppEnv,
  paymentId: string,
) {
  const activeCanaryLock = await env.DB?.prepare(`
    SELECT user_id
    FROM dodo_webhook_event
    WHERE event_type = 'billing.canary.lock'
      AND outcome = 'processing'
      AND processing_started_at IS NOT NULL
      AND julianday(?) <= julianday(processing_started_at) + (5.0 / 1440.0)
      AND json_valid(metadata_json)
      AND json_extract(metadata_json, '$.userPlanSnapshot.dodo_payment_id') = ?
    LIMIT 1
  `).bind(
    new Date().toISOString(),
    paymentId,
  ).all<{ user_id: string }>();
  return activeCanaryLock?.results?.[0]?.user_id ?? null;
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
  const eventOccurrenceTimestamp = webhookEventOccurrenceIso(envelope.timestamp);

  const preflightPlanGrant = extractDodoPlanGrant(env, payload);
  const preflightProofCreditGrant = extractDodoProofCreditGrant(env, payload);
  const preflightCheckoutFailure = extractDodoPlanCheckoutFailure(env, payload);
  const preflightSubscriptionGrant = extractDodoSubscriptionGrant(env, payload);
  const preflightRevocation = extractDodoPlanRevocation(env, payload);
  const preflightRefund = extractDodoRefund(env, payload);
  let preflightUserId =
    preflightPlanGrant?.userId ??
    preflightProofCreditGrant?.userId ??
    preflightCheckoutFailure?.userId ??
    preflightSubscriptionGrant?.userId ??
    preflightRevocation?.userId ??
    null;
  if (!preflightUserId && preflightRevocation) {
    const lifecycleSubscriptionId =
      preflightRevocation.subscriptionId !== preflightRevocation.eventType
        ? preflightRevocation.subscriptionId
        : null;
    preflightUserId = await getUserIdForDodoLifecycle(env, {
      subscriptionId: lifecycleSubscriptionId,
      customerId: preflightRevocation.customerId,
      customerEmail: preflightRevocation.customerEmail,
    });
  }
  if (!preflightUserId && preflightRefund) {
    preflightUserId =
      (await getUserIdForDodoPayment(env, preflightRefund.paymentId)) ??
      (await getUserIdFromActiveBillingCanaryOriginalPayment(env, preflightRefund.paymentId));
  }
  const declaredCanaryUserId = preflightPlanGrant?.isBillingCanary
    ? preflightPlanGrant.userId
    : preflightProofCreditGrant?.isBillingCanary
      ? preflightProofCreditGrant.userId
      : null;
  const declaredCanaryLockId = preflightPlanGrant?.isBillingCanary
    ? preflightPlanGrant.billingCanaryLockId
    : preflightProofCreditGrant?.isBillingCanary
      ? preflightProofCreditGrant.billingCanaryLockId
      : null;
  const internalCanaryLockHeader = request.headers.get("x-0509-billing-canary-lock-id");
  const isInternalBillingCanary = Boolean(
    declaredCanaryUserId &&
    billingCanaryLockBelongsToUser(declaredCanaryLockId, declaredCanaryUserId) &&
    internalCanaryLockHeader === declaredCanaryLockId,
  );

  const claim = await beginDodoWebhookEventProcessing(env, {
    eventId,
    eventType,
    userId: preflightUserId,
    payloadTimestamp,
    ...(isInternalBillingCanary
      ? {
          billingCanaryGuard: "require_lock" as const,
          billingCanaryLockId: declaredCanaryLockId!,
        }
      : preflightUserId
        ? { billingCanaryGuard: "defer_while_locked" as const }
        : {}),
  });
  if (claim.status === "deferred") {
    throw new Response(DODO_WEBHOOK_PROCESSING_FAILURE_MESSAGE, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "60" },
    });
  }
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
    try {
      await failDodoWebhookEventProcessing(env, eventId, {
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (ledgerError) {
      // A failed finalization must not turn the provider response into an
      // unbounded exception. Keep the retry signal while leaving the ledger
      // state honest: this catch does not claim the failure transition won.
      logBillingEvent(env, "error", "dodo.webhook.failure_ledger", "Dodo webhook failure ledger update failed", {
        eventId,
        details: {
          error: ledgerError instanceof Error ? ledgerError.message : String(ledgerError),
        },
      });
    }
    // Keep provider retry semantics (Dodo retries every non-2xx response)
    // without returning provider, database, or credential-bearing exception
    // text to the signed webhook caller.
    throw new Response(DODO_WEBHOOK_PROCESSING_FAILURE_MESSAGE, {
      status: 500,
      headers: {
        "cache-control": "no-store",
      },
    });
  }

  async function processDodoEvent(): Promise<{
    outcome: "processed" | "ignored";
    metadata: Record<string, unknown>;
    body: Record<string, unknown>;
  }> {
    const ledgerBase = { eventId };
    let subscriptionFailureWithCheckoutIdDidNotClear = false;
    const planGrant = preflightPlanGrant;
    if (planGrant) {
      if (
        planGrant.isBillingCanary &&
        isInternalBillingCanary &&
        !planGrant.billingCanaryExpectedPlanSnapshot
      ) {
        throw new Error("billing_canary_plan_snapshot_invalid");
      }
      const planGrantApplied = await applyDodoPlanGrantWithWatchlistReconcile(
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
        ...(planGrant.isBillingCanary && isInternalBillingCanary
          ? [{
              billingCanaryPrecondition: planGrant.billingCanaryExpectedPlanSnapshot,
              returnMutationTimestamps: true,
            }]
          : []),
      );
      if (planGrant.isBillingCanary && isInternalBillingCanary && planGrantApplied?.changed !== true) {
        throw new Error("billing_canary_plan_precondition_failed");
      }
      return {
        outcome: "processed",
        metadata: { action: "plan_grant", userId: planGrant.userId, plan: planGrant.plan },
        body: {
          ok: true,
          ...(planGrant.isBillingCanary && isInternalBillingCanary && "watchlistUpdatedAt" in (planGrantApplied ?? {})
            ? { watchlistUpdatedAt: planGrantApplied?.watchlistUpdatedAt }
            : {}),
        },
      };
    }

    const checkoutFailure = preflightCheckoutFailure;
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

    const subscriptionGrant = preflightSubscriptionGrant;
    if (subscriptionGrant) {
      const cancellationScheduled = subscriptionGrant.cancellationScheduled === true;
      const cancellationReversalRequested =
        (subscriptionGrant.eventType === "subscription.updated" ||
          subscriptionGrant.eventType === "subscription.plan_changed") &&
        subscriptionGrant.cancellationScheduled === false;
      const planChangedWithoutProviderTimestamp =
        (subscriptionGrant.eventType === "subscription.plan_changed" ||
          subscriptionGrant.eventType === "subscription.updated") &&
        !subscriptionGrant.hasProviderGrantTimestamp;
      const fallbackGrantAt = planChangedWithoutProviderTimestamp
        ? eventOccurrenceTimestamp ?? verifiedWebhookTimestamp
        : undefined;
      const acceptedGrantAt = subscriptionGrant.grantedAt ?? fallbackGrantAt;
      const ordinarySubscriptionUpdate =
        subscriptionGrant.eventType === "subscription.updated" && !cancellationScheduled;
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
      // Only an explicit false from a signed subscription.updated or
      // subscription.plan_changed payload may reverse a scheduled
      // cancellation. Missing/null flags stay on the ordinary pending-claim
      // path and can never imply reactivation.
      if (cancellationReversalRequested && acceptedGrantAt) {
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
            grantedAt: acceptedGrantAt,
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
        if (cancellationReversal.handled) {
          return {
            outcome: "processed",
            metadata: {
              action: "cancellation_reversal",
              userId: subscriptionGrant.userId,
              plan: subscriptionGrant.plan,
              eventType: subscriptionGrant.eventType,
              changed: cancellationReversal.changed,
            },
            body: { ok: true },
          };
        }
      }
      // Live Dodo subscription payloads carry no updated_at (verified against
      // the live subscriptions API, 2026-07-13), so real plan_changed events
      // arrive without a provider grant timestamp. A pure scheduled
      // cancellation has no pending plan-change row — routing it through the
      // plan-change-pending guard would match zero rows, finalize the ledger
      // as ignored, and silently drop the cancellation status + email. Let it
      // take the normal grant path instead; the signature-verified webhook
      // envelope timestamp (fallbackGrantAt) preserves monotonic ordering.
      const requiresPendingPlanChange =
        ordinarySubscriptionUpdate ||
        (planChangedWithoutProviderTimestamp && !cancellationScheduled);
      const allowsPendingPlanChangeTarget =
        ordinarySubscriptionUpdate ||
        (planChangedWithoutProviderTimestamp && !cancellationScheduled);
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

    const revocation = preflightRevocation;
    if (revocation) {
      const revocationRetryKind: BillingLifecycleEmailKind =
        revocation.action === "payment_issue" ? "payment_issue" : "revoke";
      const retryResolvedUserId =
        lifecycleEmailRetry?.kind === revocationRetryKind
          ? lifecycleEmailRetry.userId
          : null;
      const lifecycleSubscriptionId =
        revocation.subscriptionId !== revocation.eventType ? revocation.subscriptionId : null;
      const userId =
        revocation.userId ??
        retryResolvedUserId ??
        preflightUserId ??
        (await getUserIdForDodoLifecycle(env, {
          subscriptionId: lifecycleSubscriptionId,
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
            providerPaymentId: lifecyclePaymentId,
            providerSubscriptionId: lifecycleSubscriptionId,
          },
          {
            ...ledgerBase,
            outcome: "processed",
            metadata: { action: "payment_issue", userId, eventType: revocation.eventType },
          },
          { lifecycleEmailOutbox: paymentIssueOutbox },
        );
        // Skip the email when the monotonic guard rejected a stale event —
        // the plan already moved past this state (e.g. payment recovered).
        const matchesPaymentIssueRetry =
          lifecycleEmailRetry?.kind === "payment_issue" &&
          lifecycleEmailRetry.userId === userId;
        const expectedPaymentIssueStateUpdatedAt =
          paymentIssueApplied?.stateUpdatedAt ?? revocation.revokedAt;
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
            : Boolean(lifecyclePaymentId) &&
              currentPaymentIssueState.dodoPaymentId === lifecyclePaymentId);
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

      if (!lifecycleSubscriptionId) {
        throw new Error(`Dodo ${revocation.eventType} webhook is missing required subscription_id.`);
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
          providerSubscriptionId: lifecycleSubscriptionId,
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
      const expectedRevokeStateUpdatedAt =
        revokeApplied?.stateUpdatedAt ?? revocation.revokedAt;
      const currentRevokeState =
        matchesRevokeRetry && expectedRevokeStateUpdatedAt
          ? await getUserPlanBillingInfo(env, userId)
          : null;
      const shouldRetryRevokeEmail =
        currentRevokeState?.plan === "free" &&
        currentRevokeState.dodoStatus === revocation.eventType &&
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

    const refund = preflightRefund;
    if (refund) {
      const retryResolvedUserId =
        lifecycleEmailRetry?.kind === "refund" ? lifecycleEmailRetry.userId : null;
      const refundedUserId =
        retryResolvedUserId ?? preflightUserId ?? (await getUserIdForDodoPayment(env, refund.paymentId));
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
          refundType: refund.refundType,
          refundAmount: refund.refundAmount ?? null,
          paymentAmount: refund.paymentAmount ?? null,
        },
        getPlanLimit("free", "watchlists"),
        {
          ...ledgerBase,
          outcome: "processed",
          metadata: {
            action: "refund",
            paymentId: refund.paymentId,
            refundId: refund.refundId,
            refundAmount: refund.refundAmount ?? null,
            paymentAmount: refund.paymentAmount ?? null,
            refundCurrency: refund.refundCurrency ?? null,
            refundReason: refund.refundReason ?? null,
            refundType: refund.refundType,
            creditMutationPolicy:
              refund.refundType === "partial" &&
              refund.refundAmount != null &&
              refund.paymentAmount != null &&
              refund.paymentAmount > 0
                ? "prorated_topup_v1"
                : refund.refundType === "partial"
                  ? "audit_only_v2"
                  : "full_revoke_v1",
            refundReconciliationStatus:
              refund.refundType === "partial" ? "pending" : "not_required",
          },
        },
        { lifecycleEmailOutbox: refundOutbox },
      );
      const matchesRefundRetry =
        lifecycleEmailRetry?.kind === "refund" &&
        lifecycleEmailRetry.userId === refundedUserId;
      const expectedRefundStateUpdatedAt =
        refundApplied?.stateUpdatedAt ?? refund.refundedAt;
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
        (!("topUpChanged" in refundApplied) || refundApplied.topUpChanged !== true) &&
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

    if (eventType === "refund.succeeded") {
      throw new Error("dodo_refund_payload_unresolvable");
    }

    const grant = preflightProofCreditGrant;
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

  // Freeze the lifecycle email BEFORE the mutation batch so its pending
  // outbox row rides the same D1 transaction as the plan mutation + ledger
  // finalize — a worker crash after the batch can no longer lose the email
  // (the recovery sweep replays pending outbox rows; Dodo redelivery is
  // already deduped by the finalized ledger). If preparation fails, fail the
  // webhook before billing state mutates so Dodo can retry the whole event.
  async function prepareLifecycleEmailOutbox(
    lifecycleUserId: string,
    build: (profile: { email: string; name: string | null }) => BillingLifecycleEmailOutboxInput,
  ) {
    const profile = await getUserDeliveryProfile(env, lifecycleUserId);
    if (!profile?.email) {
      return undefined;
    }
    const delivery = await import("~/lib/delivery.server");
    return delivery.prepareBillingLifecycleEmailOutbox(
      env,
      build({ email: profile.email, name: profile.name }),
    );
  }

  // Lifecycle emails remain best-effort for unexpected application errors.
  // An explicit provider rejection is different: the delivery attempt is
  // durably `failed`, so reopen this processed webhook and return non-2xx.
  // Dodo redelivery may then retry that failed attempt only. Sent and
  // provider-unknown attempts remain terminal/suppressed in delivery.server.
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
