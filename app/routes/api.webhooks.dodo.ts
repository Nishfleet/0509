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
      // Live Dodo subscription payloads carry no updated_at (verified against
      // the live subscriptions API, 2026-07-13), so real plan_changed events
      // arrive without a provider grant timestamp. A pure scheduled
      // cancellation has no pending plan-change row — routing it through the
      // plan-change-pending guard would match zero rows, finalize the ledger
      // as ignored, and silently drop the cancellation status + email. Let it
      // take the normal grant path instead; the signature-verified webhook
      // envelope timestamp (fallbackGrantAt) preserves monotonic ordering.
      const requiresPendingPlanChange =
        planChangedWithoutProviderTimestamp && !cancellationScheduled;
      const allowsPendingPlanChangeTarget =
        planChangedWithoutProviderTimestamp && !cancellationScheduled;
      const cancellationOutbox = cancellationScheduled
        ? await prepareLifecycleEmailOutbox(subscriptionGrant.userId, (profile) => ({
            kind: "cancellation_scheduled",
            userId: subscriptionGrant.userId,
            email: profile.email,
            name: profile.name,
            effectiveAt: subscriptionGrant.nextBillingAt,
            eventId,
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
          grantedAt: subscriptionGrant.grantedAt ?? fallbackGrantAt,
          metadata: subscriptionGrant.metadata,
          forcePlanChangePending: allowsPendingPlanChangeTarget,
          requirePlanChangePending: requiresPendingPlanChange,
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
        { lifecycleEmailOutbox: cancellationOutbox },
      );
      const matchesScheduledCancellationRetry =
        lifecycleEmailRetry?.kind === "cancellation_scheduled" &&
        lifecycleEmailRetry.userId === subscriptionGrant.userId;
      const currentScheduledCancellationState =
        matchesScheduledCancellationRetry &&
        cancellationScheduled &&
        grantApplied?.changed === false
          ? await getUserPlanBillingInfo(env, subscriptionGrant.userId)
          : null;
      const shouldRetryScheduledCancellationEmail =
        currentScheduledCancellationState?.dodoStatus === "cancellation_scheduled" &&
        currentScheduledCancellationState.dodoSubscriptionId ===
          subscriptionGrant.subscriptionId;
      if (
        cancellationScheduled &&
        (grantApplied?.changed !== false || shouldRetryScheduledCancellationEmail)
      ) {
        await sendBillingLifecycleEmailSafely("cancellation_scheduled", subscriptionGrant.userId, (delivery, profile) =>
          delivery.sendBillingCancellationEmail(env, {
            userId: subscriptionGrant.userId,
            email: profile.email,
            name: profile.name,
            kind: "scheduled",
            effectiveAt: subscriptionGrant.nextBillingAt,
            eventId,
            retryWebhookOnExplicitFailure: true,
          }),
        );
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
        const currentPaymentIssueState =
          matchesPaymentIssueRetry && paymentIssueApplied?.changed === false
            ? await getUserPlanBillingInfo(env, userId)
            : null;
        const shouldRetryPaymentIssueEmail =
          currentPaymentIssueState?.dodoStatus === revocation.eventType &&
          (revocation.subscriptionId === revocation.eventType ||
            currentPaymentIssueState.dodoSubscriptionId === revocation.subscriptionId);
        if (paymentIssueApplied?.changed !== false || shouldRetryPaymentIssueEmail) {
          await sendBillingLifecycleEmailSafely("payment_issue", userId, (delivery, profile) =>
            delivery.sendBillingPaymentIssueEmail(env, {
              userId,
              email: profile.email,
              name: profile.name,
              occurredAt: revocation.revokedAt,
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
      const currentRevokeState =
        matchesRevokeRetry && revokeApplied?.changed === false
          ? await getUserPlanBillingInfo(env, userId)
          : null;
      const shouldRetryRevokeEmail =
        currentRevokeState?.plan === "free" &&
        currentRevokeState.dodoStatus === revocation.eventType &&
        (revocation.subscriptionId === revocation.eventType ||
          currentRevokeState.dodoSubscriptionId === revocation.subscriptionId);
      if (revokeApplied?.changed !== false || shouldRetryRevokeEmail) {
        await sendBillingLifecycleEmailSafely("revoke", userId, (delivery, profile) =>
          delivery.sendBillingCancellationEmail(env, {
            userId,
            email: profile.email,
            name: profile.name,
            kind: "ended",
            eventId,
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
      const currentRefundState =
        matchesRefundRetry && refundedUserId && refundApplied?.changed !== true
          ? await getUserPlanBillingInfo(env, refundedUserId)
          : null;
      const shouldRetryRefundEmail =
        currentRefundState?.plan === "free" && currentRefundState.dodoStatus === "refunded";
      if (
        refundedUserId &&
        (refundApplied?.changed === true || shouldRetryRefundEmail)
      ) {
        await sendBillingLifecycleEmailSafely("refund", refundedUserId, (delivery, profile) =>
          delivery.sendBillingRefundEmail(env, {
            userId: refundedUserId,
            email: profile.email,
            name: profile.name,
            eventId,
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

  // Freeze the lifecycle email BEFORE the mutation batch so its pending
  // outbox row rides the same D1 transaction as the plan mutation + ledger
  // finalize — a worker crash after the batch can no longer lose the email
  // (the recovery sweep replays pending outbox rows; Dodo redelivery is
  // already deduped by the finalized ledger). Best-effort: a failure here
  // must never block the billing mutation itself — the post-batch send path
  // simply falls back to creating its own attempt row.
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
      return delivery.prepareBillingLifecycleEmailOutbox(
        env,
        build({ email: profile.email, name: profile.name }),
      );
    } catch {
      return undefined;
    }
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
      if (!profile?.email) {
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
