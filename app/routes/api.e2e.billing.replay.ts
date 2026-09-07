import { RouterContextProvider, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { cloudflareRuntimeContext, getCloudflareContext } from "~/lib/cloudflare-context";
import type { AppEnv, EmailSendingBinding } from "~/lib/env.server";

const J5_FIXTURE_SECRET = "e2e-j5-fixture-webhook-secret-v1";
const J5_PRODUCT_ID = "e2e-j5-product-starter-monthly";
const J5_PLAN_CHANGE_PRODUCT_ID = "e2e-j5-product-agency-monthly";
const J5_BRAND_ID = "e2e-j5-brand";
const J5_REPLAY_PREFIX = "e2e-j5-replay:";
const J5_EVENT_PREFIX = "e2e-j5-event:";
const J5_VIEWPORTS = ["375x812", "768x900", "1440x900"] as const;
const J5_USERS = [
  "e2e-activation",
  "e2e-activation-tablet",
  "e2e-activation-desktop",
  "e2e-payment-issue",
  "e2e-payment-issue-tablet",
  "e2e-payment-issue-desktop",
  "e2e-cancelled",
  "e2e-cancelled-tablet",
  "e2e-cancelled-desktop",
  "e2e-refunded",
  "e2e-refunded-tablet",
  "e2e-refunded-desktop",
] as const;

type J5Viewport = (typeof J5_VIEWPORTS)[number];
type J5User = (typeof J5_USERS)[number];

interface J5ReplayMapping {
  action: "billing_lifecycle";
  userId: "e2e-payment-issue" | "e2e-payment-issue-tablet" | "e2e-payment-issue-desktop";
  runId: string;
  viewport: J5Viewport;
}

interface J5UserStateRow {
  plan: string;
  dodo_status: string | null;
  plan_updated_at: string;
  dodo_payment_id: string | null;
  dodo_product_id: string | null;
  dodo_subscription_id: string | null;
  dodo_customer_id: string | null;
  dodo_next_billing_at: string | null;
}

interface J5EventRow {
  event_type: string;
  outcome: string;
  metadata_json: string | null;
}

interface J5ReplayMarkerRow {
  outcome: string;
  metadata_json: string | null;
}

export interface J5TransitionState {
  plan: string;
  status: string | null;
  updatedAt: string;
  paymentId: string | null;
  productId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  nextBillingAt: string | null;
}

export interface J5TransitionEvidence {
  before: J5TransitionState;
  after: J5TransitionState;
  response: Record<string, unknown>;
}

export interface J5CommercialProviderReplayEvidence {
  checkout: { accepted: boolean; canonicalSku: string; safeHostedUrl: boolean };
  planChange: { previewed: boolean; tokenVerified: boolean; accepted: boolean; canonicalSku: string };
  syntheticCallCount: number;
  externalProviderCalled: false;
}

export type J5ReplayClaimDecision = "replayed" | "claimed" | "stale" | "in_progress" | "invalid";

/** Pure lease decision kept exported so route tests can exercise the race boundary without D1. */
export function resolveJ5ReplayClaim(
  row: J5ReplayMarkerRow | null,
  processingToken: string,
  runId: string,
  nowMs = Date.now(),
  leaseMs = 5 * 60 * 1000,
): J5ReplayClaimDecision {
  const metadata = parseObject(row?.metadata_json);
  if (row?.outcome === "processed" && metadata?.status === "succeeded" && metadata.runId === runId) return "replayed";
  if (row?.outcome !== "processing" || metadata?.runId !== runId) return "invalid";
  if (metadata.processingToken === processingToken) return "claimed";
  const startedAt = typeof metadata.processingStartedAt === "string" ? Date.parse(metadata.processingStartedAt) : Number.NaN;
  if (!Number.isFinite(startedAt)) return "invalid";
  return startedAt <= nowMs - leaseMs ? "stale" : "in_progress";
}

export function resolveJ5ReplayCompletion(input: {
  changes: number;
  currentStatus: string;
  currentToken: string | null;
  currentRunId: string | null;
  processingToken: string;
  runId: string;
}) {
  return input.changes === 1 && input.currentStatus === "processing" &&
    input.currentToken === input.processingToken && input.currentRunId === input.runId;
}

function sameTransitionState(left: J5TransitionState, right: J5TransitionState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameTransitionStateExceptTimestamp(left: J5TransitionState, right: J5TransitionState) {
  const { updatedAt: _leftUpdatedAt, ...leftState } = left;
  const { updatedAt: _rightUpdatedAt, ...rightState } = right;
  return JSON.stringify(leftState) === JSON.stringify(rightState);
}

function timestampAdvanced(left: J5TransitionState, right: J5TransitionState) {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && rightTime > leftTime;
}

function matchesState(
  state: J5TransitionState,
  expected: Partial<J5TransitionState>,
) {
  return Object.entries(expected).every(([key, value]) => state[key as keyof J5TransitionState] === value);
}

export function resolveJ5LifecycleTransitionEvidence(
  evidence: Record<string, J5TransitionEvidence>,
  expected: { activationPaymentId: string; activationSubscriptionId: string; activationCustomerId: string },
) {
  const activation = evidence.activation;
  const duplicate = evidence.activation_duplicate;
  const paymentFailed = evidence.payment_failed;
  const paymentRecovered = evidence.payment_recovered;
  const scheduled = evidence.cancellation_scheduled;
  const missing = evidence.cancellation_missing;
  const nullFlag = evidence.cancellation_null;
  const reversed = evidence.cancellation_reversed;
  const older = evidence.cancellation_older;
  const planChanged = evidence.plan_change_applied;
  const cancelledActivation = evidence.cancelled_activation;
  const cancelled = evidence.cancelled_terminal;
  const expired = evidence.expired_after_cancel;
  const refundedActivation = evidence.refunded_activation;
  const partial = evidence.refund_partial;
  const failed = evidence.refund_failed;
  const refunded = evidence.refund_succeeded;
  const activationIdentity = {
    paymentId: expected.activationPaymentId,
    productId: J5_PRODUCT_ID,
    subscriptionId: expected.activationSubscriptionId,
    customerId: expected.activationCustomerId,
  };
  return {
    activationDuplicate: Boolean(
      activation && duplicate &&
      matchesState(activation.before, { plan: "free" }) &&
      matchesState(activation.after, { plan: "starter", status: "active", ...activationIdentity }) &&
      duplicate.response.duplicate === true && sameTransitionState(duplicate.before, duplicate.after) &&
      sameTransitionState(activation.after, duplicate.before)
    ),
    paymentFailedRecovered: Boolean(
      paymentFailed && paymentRecovered &&
      matchesState(paymentFailed.before, { plan: "starter", status: "active" }) &&
      matchesState(paymentFailed.after, { plan: "starter", status: "payment.failed" }) &&
      sameTransitionState(paymentFailed.after, paymentRecovered.before) &&
      matchesState(paymentRecovered.after, { plan: "starter", status: "active" })
    ),
    cancellationScheduledReversed: Boolean(
      scheduled && reversed &&
      matchesState(scheduled.before, { plan: "starter", status: "active", ...activationIdentity }) &&
      duplicate && sameTransitionState(duplicate.after, scheduled.before) &&
      matchesState(scheduled.after, { plan: "starter", status: "cancellation_scheduled", ...activationIdentity }) &&
      matchesState(reversed.before, { plan: "starter", status: "cancellation_scheduled", ...activationIdentity }) &&
      matchesState(reversed.after, { plan: "starter", status: "active", ...activationIdentity })
    ),
    missingNullNoReversal: Boolean(
      missing && nullFlag &&
      scheduled && sameTransitionState(scheduled.after, missing.before) &&
      sameTransitionState(missing.before, missing.after) &&
      matchesState(missing.after, { plan: "starter", status: "cancellation_scheduled", ...activationIdentity }) &&
      sameTransitionState(missing.after, nullFlag.before) && sameTransitionState(nullFlag.before, nullFlag.after) &&
      reversed && sameTransitionState(nullFlag.after, reversed.before)
    ),
    olderNoRegression: Boolean(
      older && reversed && sameTransitionState(reversed.after, older.before) &&
      matchesState(older.before, { plan: "starter", status: "active", ...activationIdentity }) &&
      sameTransitionState(older.before, older.after)
    ),
    planChangeApplied: Boolean(
      planChanged && older && sameTransitionState(older.after, planChanged.before) &&
      matchesState(planChanged.before, { plan: "starter", status: "active", ...activationIdentity }) &&
      matchesState(planChanged.after, {
        plan: "agency",
        status: "active",
        paymentId: expected.activationPaymentId,
        productId: J5_PLAN_CHANGE_PRODUCT_ID,
        subscriptionId: expected.activationSubscriptionId,
        customerId: expected.activationCustomerId,
      })
    ),
    cancelledExpiredRevoked: Boolean(
      cancelledActivation && cancelled && expired &&
      matchesState(cancelledActivation.before, { plan: "free" }) &&
      matchesState(cancelledActivation.after, { plan: "starter", status: "active" }) &&
      sameTransitionState(cancelledActivation.after, cancelled.before) &&
      matchesState(cancelled.after, { plan: "free", status: "subscription.cancelled" }) &&
      sameTransitionState(cancelled.after, expired.before) &&
      sameTransitionStateExceptTimestamp(expired.before, expired.after) &&
      timestampAdvanced(expired.before, expired.after) &&
      matchesState(expired.after, { plan: "free", status: "subscription.cancelled" })
    ),
    fullRefundRevoked: Boolean(
      refundedActivation && refunded &&
      matchesState(refundedActivation.before, { plan: "free" }) &&
      matchesState(refundedActivation.after, { plan: "starter", status: "active" }) &&
      failed && sameTransitionState(failed.after, refunded.before) &&
      matchesState(refunded.before, { plan: "starter", status: "active" }) &&
      matchesState(refunded.after, { plan: "free", status: "refunded" })
    ),
    partialAndFailedNoMutation: Boolean(
      partial && failed &&
      refundedActivation && sameTransitionState(refundedActivation.after, partial.before) &&
      matchesState(partial.before, { plan: "starter", status: "active" }) && sameTransitionState(partial.before, partial.after) &&
      sameTransitionState(partial.after, failed.before) && sameTransitionState(failed.before, failed.after)
    ),
  };
}

const J5_REPLAY_ACTIONS: Readonly<Record<string, J5ReplayMapping>> = Object.freeze(
  Object.fromEntries(
    J5_VIEWPORTS.map((viewport) => {
      const userId = viewport === "768x900"
        ? "e2e-payment-issue-tablet"
        : viewport === "1440x900"
          ? "e2e-payment-issue-desktop"
          : "e2e-payment-issue";
      return [`e2e-j5-billing-lifecycle-${viewport}`, {
        action: "billing_lifecycle" as const,
        userId,
        runId: `e2e-run-j5-billing-lifecycle-${viewport}`,
        viewport,
      }] as const;
    }),
  ),
);

export function resolveJ5ReplayAction(idempotencyKey: string, userId: string, runId: string) {
  const resolved = J5_REPLAY_ACTIONS[idempotencyKey];
  return resolved?.userId === userId && resolved.runId === runId ? resolved.action : null;
}

function fixtureCookieUser(request: Request) {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("f9_e2e_fixture="));
  if (matches.length !== 1) return null;
  try {
    const value = decodeURIComponent(matches[0]!.slice("f9_e2e_fixture=".length));
    return (J5_USERS as readonly string[]).includes(value) ? value : null;
  } catch {
    return null;
  }
}

function isLoopbackStateRequest(request: Request) {
  if (request.method !== "GET" || request.headers.get("x-0509-e2e-test-mode") !== "1") return false;
  let url: URL;
  try { url = new URL(request.url); } catch { return false; }
  const port = Number(url.port);
  return url.pathname === "/api/e2e/billing/state" && url.protocol === "http:" && url.hostname === "127.0.0.1" &&
    !url.username && !url.password && Number.isInteger(port) && port >= 1_024 && port <= 65_535 &&
    url.origin === `http://127.0.0.1:${port}`;
}

export function resolveJ5ReplayStateRequest(request: Request) {
  if (!isLoopbackStateRequest(request)) return null;
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()].sort();
  if (keys.length !== 1 || keys[0] !== "user_id") return null;
  const userId = url.searchParams.get("user_id") ?? "";
  if (!(J5_USERS as readonly string[]).includes(userId) || fixtureCookieUser(request) !== userId) return null;
  return { userId: userId as J5User };
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/api/e2e/billing/replay") return notFound();
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const [{ resolveE2EProviderDeny, sanitizeE2EProviderEnv }, { isE2ETestRequestEnabled }, guardModule] =
    await Promise.all([
      import("~/lib/e2e-provider.server"),
      import("~/lib/e2e-auth.server"),
      import("~/lib/e2e-harness-guard.server"),
    ]);
  const networkDeny = await resolveE2EProviderDeny(env, request);
  const testModeEnabled = await isE2ETestRequestEnabled(env, request);
  const guarded = await guardModule.guardE2EHarnessReplayRequest(request, {
    networkDeny,
    testMode: { enabled: testModeEnabled, sentinel: networkDeny.enabled && networkDeny.failClosed },
  });
  if (!guarded.ok || guarded.metadata.scenario !== "j5") return notFound();
  const mapping = J5_REPLAY_ACTIONS[guarded.metadata.idempotencyKey];
  if (!mapping || mapping.userId !== guarded.metadata.userId || mapping.runId !== guarded.metadata.runId || !env.DB) {
    return notFound();
  }

  const controlledInbox = createControlledInboxBinding();
  const replayEnv = fixtureReplayEnv(sanitizeE2EProviderEnv(env), controlledInbox.binding);
  try {
    const claim = await claimReplay(env, guarded.metadata.idempotencyKey, mapping, guarded.metadata.runId);
    if (claim.replayed) return noStoreJson({ ok: true, replayed: true, result: claim.result, ...claim.result });
    const result = await runJ5Replay(
      replayEnv,
      context,
      request,
      mapping,
      guarded.metadata.clock,
      controlledInbox.acceptedTags,
    );
    await completeReplay(env, guarded.metadata.idempotencyKey, claim.processingToken, guarded.metadata.runId, result);
    return noStoreJson({ ok: true, replayed: false, result, ...result });
  } catch (error) {
    if (error instanceof J5ReplayInProgressError) return noStoreJson({ ok: false, blocker: "j5_replay_in_progress" }, 409);
    return noStoreJson({ ok: false, blocker: safeJ5ReplayBlocker(error) }, 503);
  }
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const identity = resolveJ5ReplayStateRequest(request);
  if (!identity) return notFound();
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const [{ resolveE2EProviderDeny, sanitizeE2EProviderEnv }, { isE2ETestRequestEnabled }] = await Promise.all([
    import("~/lib/e2e-provider.server"),
    import("~/lib/e2e-auth.server"),
  ]);
  const networkDeny = await resolveE2EProviderDeny(env, request);
  if (!env.DB || !networkDeny.enabled || !networkDeny.failClosed || !(await isE2ETestRequestEnabled(env, request))) return notFound();
  try {
    const state = await readJ5UserState(sanitizeE2EProviderEnv(env), identity.userId);
    return state ? noStoreJson({ ok: true, ...state }) : notFound();
  } catch {
    return noStoreJson({ ok: false, blocker: "j5_state_failed" }, 503);
  }
}

function fixtureReplayEnv(env: AppEnv, emailBinding: EmailSendingBinding): AppEnv {
  return {
    ...env,
    DODO_0509_API_KEY: "fixture",
    DODO_0509_WEBHOOK_SECRET: J5_FIXTURE_SECRET,
    DODO_0509_BRAND_ID: J5_BRAND_ID,
    DODO_0509_PRODUCT_STARTER_MONTHLY_ID: J5_PRODUCT_ID,
    DODO_0509_PRODUCT_AGENCY_MONTHLY_ID: J5_PLAN_CHANGE_PRODUCT_ID,
    EMAIL: emailBinding,
    EMAIL_FROM_EMAIL: "e2e-mailer@example.invalid",
  };
}

function createControlledInboxBinding() {
  const acceptedTags: string[] = [];
  const binding: EmailSendingBinding = {
    async send(message) {
      const from = typeof message.from === "string" ? message.from : message.from.email;
      const recipients = Array.isArray(message.to) ? message.to : [message.to];
      const recipientEmails = recipients.map((recipient) =>
        typeof recipient === "string" ? recipient : recipient.email,
      );
      const tag = message.headers?.["X-0509-Tag"] ?? "";
      if (
        from !== "e2e-mailer@example.invalid" ||
        recipientEmails.length !== 1 ||
        !recipientEmails[0]?.endsWith("@example.invalid") ||
        !["billing-payment-issue", "billing-cancellation", "billing-refund"].includes(tag) ||
        !message.subject.trim() ||
        !(message.html?.trim() || message.text?.trim())
      ) {
        throw new Error("j5_controlled_inbox_contract_failed");
      }
      acceptedTags.push(tag);
      return { messageId: `e2e-j5-inbox-${acceptedTags.length}` };
    },
  };
  return { acceptedTags, binding };
}

async function runJ5CommercialProviderReplay(
  env: AppEnv,
  request: Request,
  mapping: J5ReplayMapping,
): Promise<J5CommercialProviderReplayEvidence> {
  const {
    changeDodo0509SubscriptionPlan,
    checkoutTargetFromSkuSlug,
    createDodo0509CheckoutSession,
    createDodoSubscriptionPlanChangePreviewToken,
    getDodo0509SubscriptionCurrency,
    isDodoHostedCheckoutUrl,
    previewDodo0509SubscriptionPlanChange,
    summarizeDodoSubscriptionPlanChangePreview,
    verifyDodoSubscriptionPlanChangePreviewToken,
  } = await import("~/lib/dodo-billing.server");
  const checkoutTarget = checkoutTargetFromSkuSlug("starter_monthly_v1");
  const planChangeTarget = checkoutTargetFromSkuSlug("agency_monthly_v1");
  if (checkoutTarget?.kind !== "plan" || planChangeTarget?.kind !== "plan") {
    throw new Error("j5_commercial_sku_contract_missing");
  }

  const activationUser = mapping.viewport === "768x900"
    ? "e2e-activation-tablet"
    : mapping.viewport === "1440x900"
      ? "e2e-activation-desktop"
      : "e2e-activation";
  const origin = new URL(request.url).origin;
  const replayEnv: AppEnv = { ...env, APP_ORIGIN: origin };
  const subscriptionId = `e2e-j5-sub-${activationUser}`;
  const calls: string[] = [];
  const controlledFetcher: typeof fetch = async (input, init) => {
    const value = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const url = new URL(value);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (
      url.origin !== "https://live.dodopayments.com" ||
      init?.headers === undefined ||
      new Headers(init.headers).get("authorization") !== "Bearer fixture"
    ) {
      throw new Error("j5_commercial_provider_boundary_failed");
    }
    const body = typeof init?.body === "string" ? parseObject(init.body) : null;

    if (method === "POST" && url.pathname === "/checkouts") {
      const productCart = Array.isArray(body?.product_cart) ? body.product_cart : [];
      const product = isObject(productCart[0]) ? productCart[0] : null;
      const metadataValue = isObject(body?.metadata) ? body.metadata : null;
      const customer = isObject(body?.customer) ? body.customer : null;
      const returnUrl = typeof body?.return_url === "string" ? new URL(body.return_url) : null;
      const cancelUrl = typeof body?.cancel_url === "string" ? new URL(body.cancel_url) : null;
      if (
        product?.product_id !== J5_PRODUCT_ID ||
        metadataValue?.user_id !== activationUser ||
        metadataValue?.sku !== "starter_monthly_v1" ||
        metadataValue?.plan !== "starter" ||
        customer?.email !== `${activationUser}@example.invalid` ||
        returnUrl?.origin !== origin ||
        returnUrl.pathname !== "/app/billing" ||
        cancelUrl?.origin !== origin ||
        cancelUrl.pathname !== "/api/billing/dodo/cancel"
      ) {
        throw new Error("j5_checkout_request_contract_failed");
      }
      calls.push("checkout");
      return Response.json({
        checkout_url: `https://test.checkout.dodopayments.com/session/${mapping.viewport}`,
        session_id: `e2e-j5-checkout-${mapping.viewport}`,
      });
    }

    if (method === "GET" && url.pathname === `/subscriptions/${subscriptionId}`) {
      calls.push("subscription_currency");
      return Response.json({ currency: "USD" });
    }

    const expectedPlanBody = body &&
      body.product_id === J5_PLAN_CHANGE_PRODUCT_ID &&
      body.proration_billing_mode === "prorated_immediately" &&
      body.effective_at === "immediately" &&
      body.on_payment_failure === "prevent_change" &&
      isObject(body.metadata) &&
      body.metadata.user_id === activationUser &&
      body.metadata.sku === "agency_monthly_v1" &&
      body.metadata.plan === "agency";
    if (
      method === "POST" &&
      url.pathname === `/subscriptions/${subscriptionId}/change-plan/preview` &&
      expectedPlanBody
    ) {
      calls.push("plan_change_preview");
      return Response.json({ immediate_charge: { summary: { total_amount: 129_900 } } });
    }
    if (
      method === "POST" &&
      url.pathname === `/subscriptions/${subscriptionId}/change-plan` &&
      expectedPlanBody
    ) {
      calls.push("plan_change");
      return Response.json({ id: subscriptionId, status: "active" });
    }
    throw new Error("j5_commercial_provider_call_unexpected");
  };

  const checkout = await createDodo0509CheckoutSession({
    env: replayEnv,
    request,
    session: {
      user: {
        id: activationUser,
        email: `${activationUser}@example.invalid`,
        name: "E2E Billing",
      },
      session: {
        id: `e2e-j5-session-${mapping.viewport}`,
        userId: activationUser,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    },
    target: checkoutTarget,
    checkoutId: `e2e-j5-checkout-${mapping.viewport}`,
    source: "e2e",
    fetcher: controlledFetcher,
  });
  const currency = await getDodo0509SubscriptionCurrency({
    env: replayEnv,
    subscriptionId,
    fetcher: controlledFetcher,
  });
  const preview = await previewDodo0509SubscriptionPlanChange({
    env: replayEnv,
    subscriptionId,
    target: planChangeTarget,
    userId: activationUser,
    effectiveAt: "immediately",
    prorationBillingMode: "prorated_immediately",
    fetcher: controlledFetcher,
  });
  const previewSummary = summarizeDodoSubscriptionPlanChangePreview(preview, currency);
  if (!previewSummary) throw new Error("j5_plan_change_preview_contract_failed");
  const previewInput = {
    subscriptionId,
    target: planChangeTarget,
    userId: activationUser,
    effectiveAt: "immediately" as const,
    prorationBillingMode: "prorated_immediately" as const,
    amount: previewSummary.amount,
    currency: previewSummary.currency,
  };
  const token = await createDodoSubscriptionPlanChangePreviewToken(replayEnv, previewInput);
  const tokenVerified = await verifyDodoSubscriptionPlanChangePreviewToken(
    replayEnv,
    token,
    previewInput,
  );
  if (!tokenVerified) throw new Error("j5_preview_check_failed");
  await changeDodo0509SubscriptionPlan({
    env: replayEnv,
    subscriptionId,
    target: planChangeTarget,
    userId: activationUser,
    effectiveAt: "immediately",
    prorationBillingMode: "prorated_immediately",
    fetcher: controlledFetcher,
  });
  if (calls.join(",") !== "checkout,subscription_currency,plan_change_preview,plan_change") {
    throw new Error("j5_commercial_provider_call_order_failed");
  }
  return {
    checkout: {
      accepted: checkout.sessionId === `e2e-j5-checkout-${mapping.viewport}`,
      canonicalSku: checkoutTarget.sku,
      safeHostedUrl: isDodoHostedCheckoutUrl(checkout.checkoutUrl),
    },
    planChange: {
      previewed: previewSummary.amount === 129_900 && previewSummary.currency === "USD",
      tokenVerified,
      accepted: true,
      canonicalSku: planChangeTarget.sku,
    },
    syntheticCallCount: calls.length,
    externalProviderCalled: false,
  };
}

function eventTime(clock: string, offsetSeconds: number) {
  const parsed = Date.parse(clock);
  return new Date((Number.isFinite(parsed) ? parsed : Date.now()) + offsetSeconds * 1_000).toISOString();
}

function metadata(userId: string, paymentId: string) {
  return { app: "0509", target_kind: "plan", user_id: userId, plan: "starter", cycle: "monthly", sku: "starter_monthly_v1", checkout_id: paymentId };
}

function basePayload(userId: string, paymentId: string, occurrence: string) {
  return { brand_id: J5_BRAND_ID, metadata: metadata(userId, paymentId), product_id: J5_PRODUCT_ID, payment_id: paymentId, subscription_id: `e2e-j5-sub-${userId}`, customer: { customer_id: `e2e-j5-cus-${userId}` }, created_at: occurrence, updated_at: occurrence, timestamp: occurrence };
}

function payloads(mapping: J5ReplayMapping, clock: string) {
  const activationUser = mapping.viewport === "768x900" ? "e2e-activation-tablet" : mapping.viewport === "1440x900" ? "e2e-activation-desktop" : "e2e-activation";
  const cancelledUser = mapping.viewport === "768x900" ? "e2e-cancelled-tablet" : mapping.viewport === "1440x900" ? "e2e-cancelled-desktop" : "e2e-cancelled";
  const refundedUser = mapping.viewport === "768x900" ? "e2e-refunded-tablet" : mapping.viewport === "1440x900" ? "e2e-refunded-desktop" : "e2e-refunded";
  const activationPayment = `e2e-j5-pay-${mapping.viewport}`;
  const paymentIssueUser = mapping.userId;
  const paymentIssuePayment = `e2e-j5-pay-${paymentIssueUser.replace(/^e2e-/, "")}`;
  const cancelledPayment = `e2e-j5-pay-${cancelledUser.replace(/^e2e-/, "")}`;
  const refundedPayment = `e2e-j5-pay-${refundedUser.replace(/^e2e-/, "")}`;
  const at = (user: string, payment: string, offset: number) => basePayload(user, payment, eventTime(clock, offset));
  const planChanged = (user: string, payment: string, offset: number, flag: true | false | null | undefined) => ({
    type: "subscription.plan_changed", ...at(user, payment, offset), subscription_id: `e2e-j5-sub-${user}`,
    is_subscription: true, ...(flag === undefined ? {} : { cancel_at_next_billing_date: flag }),
    next_billing_date: eventTime(clock, 30 * 24 * 60 * 60), updated_at: undefined,
  });
  const subscriptionRenewed = (user: string, payment: string, offset: number) => ({
    type: "subscription.renewed", ...at(user, payment, offset), subscription_id: `e2e-j5-sub-${user}`, is_subscription: true,
  });
  const lifecycle = (type: string, user: string, payment: string, offset: number) => ({
    type, ...at(user, payment, offset), subscription_id: `e2e-j5-sub-${user}`, id: `e2e-j5-${type}-${user}`,
    status: type === "subscription.expired" ? "expired" : type,
  });
  const planChange = {
    type: "subscription.plan_changed",
    ...at(activationUser, activationPayment, 8),
    product_id: J5_PLAN_CHANGE_PRODUCT_ID,
    product_cart: [{ product_id: J5_PLAN_CHANGE_PRODUCT_ID, is_subscription: true }],
    metadata: {
      ...metadata(activationUser, activationPayment),
      plan: "agency",
      cycle: "monthly",
      sku: "agency_monthly_v1",
    },
    subscription_id: `e2e-j5-sub-${activationUser}`,
    is_subscription: true,
    next_billing_date: eventTime(clock, 30 * 24 * 60 * 60),
    updated_at: undefined,
  };
  return [
    { label: "activation", user: activationUser, payload: { type: "payment.succeeded", ...at(activationUser, activationPayment, 1), id: activationPayment, status: "active", product_cart: [{ product_id: J5_PRODUCT_ID, is_subscription: true }] } },
    { label: "activation_duplicate", user: activationUser, duplicateOf: "activation" },
    { label: "payment_failed", user: paymentIssueUser, payload: { type: "payment.failed", ...at(paymentIssueUser, paymentIssuePayment, 2), status: "failed" } },
    { label: "payment_recovered", user: paymentIssueUser, payload: subscriptionRenewed(paymentIssueUser, paymentIssuePayment, 3) },
    { label: "cancellation_scheduled", user: activationUser, payload: planChanged(activationUser, activationPayment, 4, true) },
    { label: "cancellation_missing", user: activationUser, payload: planChanged(activationUser, activationPayment, 5, undefined) },
    { label: "cancellation_null", user: activationUser, payload: planChanged(activationUser, activationPayment, 6, null) },
    { label: "cancellation_reversed", user: activationUser, payload: planChanged(activationUser, activationPayment, 7, false) },
    { label: "cancellation_older", user: activationUser, payload: planChanged(activationUser, activationPayment, 0, true) },
    { label: "plan_change_applied", user: activationUser, payload: planChange },
    { label: "cancelled_activation", user: cancelledUser, payload: { type: "payment.succeeded", ...at(cancelledUser, cancelledPayment, 9), id: cancelledPayment, status: "active", subscription_id: `e2e-j5-sub-${cancelledUser}`, product_cart: [{ product_id: J5_PRODUCT_ID, is_subscription: true }] } },
    { label: "cancelled_terminal", user: cancelledUser, payload: lifecycle("subscription.cancelled", cancelledUser, cancelledPayment, 10) },
    { label: "expired_after_cancel", user: cancelledUser, payload: lifecycle("subscription.expired", cancelledUser, cancelledPayment, 11) },
    { label: "refunded_activation", user: refundedUser, payload: { type: "payment.succeeded", ...at(refundedUser, refundedPayment, 12), id: refundedPayment, status: "active", subscription_id: `e2e-j5-sub-${refundedUser}`, product_cart: [{ product_id: J5_PRODUCT_ID, is_subscription: true }] } },
    { label: "refund_partial", user: refundedUser, payload: { type: "refund.succeeded", data: { payload_type: "Refund", ...at(refundedUser, refundedPayment, 13), status: "succeeded", is_partial: true, refund_id: `e2e-j5-refund-partial-${mapping.viewport}` } } },
    { label: "refund_failed", user: refundedUser, payload: { type: "refund.failed", data: { payload_type: "Refund", ...at(refundedUser, refundedPayment, 15), status: "failed", refund_id: `e2e-j5-refund-failed-${mapping.viewport}` } } },
    { label: "refund_succeeded", user: refundedUser, payload: { type: "refund.succeeded", data: { payload_type: "Refund", ...at(refundedUser, refundedPayment, 16), status: "succeeded", is_partial: false, refund_id: `e2e-j5-refund-full-${mapping.viewport}` } } },
  ] as const;
}

async function runJ5Replay(
  env: AppEnv,
  context: ActionFunctionArgs["context"],
  request: Request,
  mapping: J5ReplayMapping,
  clock: string,
  acceptedInboxTags: string[],
) {
  const commercialProviderReplay = await runJ5CommercialProviderReplay(env, request, mapping);
  const { signDodoWebhookPayload } = await import("~/lib/dodo-billing.server");
  const { action: webhookAction } = await import("~/routes/api.webhooks.dodo");
  const innerContext = new RouterContextProvider();
  innerContext.set(cloudflareRuntimeContext, {
    ...getCloudflareContext(context),
    env,
  });
  const entries = payloads(mapping, clock);
  const evidence: Record<string, J5TransitionEvidence> = {};
  let planChangeClaimed = false;
  for (const [index, entry] of entries.entries()) {
    const userId = entry.user as J5User;
    const before = await readJ5TransitionState(env, userId);
    if (!before) throw new Error("j5_transition_precondition_missing");
    if (entry.label === "plan_change_applied") {
      const {
        claimDodoSubscriptionPlanChange,
        DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
      } = await import("~/lib/data.server");
      const claimed = await claimDodoSubscriptionPlanChange(env, {
        userId,
        status: DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
        providerProductId: J5_PLAN_CHANGE_PRODUCT_ID,
        currentSubscriptionId: before.subscriptionId ?? "",
        currentProductId: before.productId,
        currentStatus: before.status,
        currentPlanUpdatedAt: before.updatedAt,
      });
      if (!claimed) throw new Error("j5_plan_change_claim_failed");
      planChangeClaimed = true;
    }
    if ("duplicateOf" in entry) {
      const original = entries.findIndex((candidate) => "label" in candidate && candidate.label === entry.duplicateOf);
      const eventId = `${J5_EVENT_PREFIX}${mapping.viewport}:${original}`;
      const originalEntry = entries[original];
      if (!originalEntry || !("payload" in originalEntry)) throw new Error("j5_duplicate_source_missing");
      const rawBody = JSON.stringify(originalEntry.payload);
      const timestamp = String(Math.floor(Date.now() / 1_000));
      const signature = await signDodoWebhookPayload(env, eventId, timestamp, rawBody);
      const duplicateRequest = signedWebhookRequest(eventId, timestamp, signature, rawBody);
      const duplicateResponse = await webhookAction({
        context: innerContext,
        request: duplicateRequest,
        params: {},
        url: new URL(duplicateRequest.url),
        pattern: "/api/webhooks/dodo",
      });
      if (!duplicateResponse.ok) throw new Error("j5_duplicate_webhook_failed");
      const duplicateBody = await duplicateResponse.json().catch(() => ({}));
      const after = await readJ5TransitionState(env, userId);
      if (!after) throw new Error("j5_transition_postcondition_missing");
      evidence[entry.label] = { before, after, response: isObject(duplicateBody) ? duplicateBody : {} };
      continue;
    }
    if (!("payload" in entry)) continue;
    const eventId = `${J5_EVENT_PREFIX}${mapping.viewport}:${index}`;
    const rawBody = JSON.stringify(entry.payload);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = await signDodoWebhookPayload(env, eventId, timestamp, rawBody);
    const webhookRequest = signedWebhookRequest(eventId, timestamp, signature, rawBody);
    const response = await webhookAction({
      context: innerContext,
      request: webhookRequest,
      params: {},
      url: new URL(webhookRequest.url),
      pattern: "/api/webhooks/dodo",
    });
    if (!response.ok) throw new Error("j5_webhook_failed");
    const body = await response.json().catch(() => ({}));
    const after = await readJ5TransitionState(env, userId);
    if (!after) throw new Error("j5_transition_postcondition_missing");
    evidence[entry.label] = { before, after, response: isObject(body) ? body : {} };
  }
  const activationUserId = mapping.viewport === "768x900" ? "e2e-activation-tablet" : mapping.viewport === "1440x900" ? "e2e-activation-desktop" : "e2e-activation";
  const lifecycle = resolveJ5LifecycleTransitionEvidence(evidence, {
    activationPaymentId: `e2e-j5-pay-${mapping.viewport}`,
    activationSubscriptionId: `e2e-j5-sub-${activationUserId}`,
    activationCustomerId: `e2e-j5-cus-${activationUserId}`,
  });
  if (Object.values(lifecycle).some((verified) => verified !== true)) {
    throw new Error("j5_transition_evidence_failed");
  }
  const sortedInboxTags = [...acceptedInboxTags].sort();
  if (JSON.stringify(sortedInboxTags) !== JSON.stringify([
    "billing-cancellation",
    "billing-cancellation",
    "billing-payment-issue",
    "billing-refund",
  ])) {
    throw new Error("j5_controlled_inbox_evidence_failed");
  }
  const state = await readJ5Snapshot(env);
  return {
    scenario: "j5",
    action: "billing_lifecycle",
    viewport: mapping.viewport,
    lifecycle,
    commercialProviderReplay: {
      ...commercialProviderReplay,
      planChange: {
        ...commercialProviderReplay.planChange,
        claimAccepted: planChangeClaimed,
      },
      entitlementReconciled: lifecycle.planChangeApplied,
    },
    controlledInbox: {
      accepted: sortedInboxTags.length,
      tags: sortedInboxTags,
      externalProviderCalled: false,
    },
    state,
    provider: { called: false, reason: "e2e_network_denied" },
    cleanup: { rawProviderIdsExposed: false, secretsExposed: false, piiExposed: false },
  };
}

function signedWebhookRequest(eventId: string, timestamp: string, signature: string, rawBody: string) {
  return new Request("http://127.0.0.1:43127/api/webhooks/dodo", { method: "POST", body: rawBody, headers: {
    "content-type": "application/json", "webhook-id": eventId, "webhook-timestamp": timestamp, "webhook-signature": `v1=${signature}`,
  } });
}

class J5ReplayInProgressError extends Error {
  constructor() {
    super("j5_replay_in_progress");
    this.name = "J5ReplayInProgressError";
  }
}

const J5_SAFE_REPLAY_BLOCKERS = new Set([
  "j5_checkout_request_contract_failed",
  "j5_commercial_provider_boundary_failed",
  "j5_commercial_provider_call_order_failed",
  "j5_commercial_provider_call_unexpected",
  "j5_commercial_sku_contract_missing",
  "j5_controlled_inbox_contract_failed",
  "j5_controlled_inbox_evidence_failed",
  "j5_duplicate_source_missing",
  "j5_duplicate_webhook_failed",
  "j5_plan_change_preview_contract_failed",
  "j5_plan_change_claim_failed",
  "j5_preview_check_failed",
  "j5_transition_evidence_failed",
  "j5_transition_postcondition_missing",
  "j5_transition_precondition_missing",
  "j5_webhook_failed",
]);

export function safeJ5ReplayBlocker(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return J5_SAFE_REPLAY_BLOCKERS.has(message) ? message : "j5_replay_failed";
}

async function claimReplay(env: AppEnv, key: string, mapping: J5ReplayMapping, runId: string) {
  const { DODO_WEBHOOK_PROCESSING_LEASE_MS } = await import("~/lib/data.server");
  const marker = `${J5_REPLAY_PREFIX}${key}`;
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = ensureDb(env);
  const ownerMetadata = { runId, status: "processing", processingToken: token, processingStartedAt: now };
  await db.prepare(`INSERT INTO dodo_webhook_event (event_id, event_type, user_id, payload_timestamp, outcome, metadata_json, processing_started_at) VALUES (?, 'e2e_j5_replay', ?, ?, 'processing', ?, ?) ON CONFLICT(event_id) DO NOTHING`).bind(marker, mapping.userId, now, JSON.stringify(ownerMetadata), now).run();
  let row = await db.prepare("SELECT outcome, metadata_json FROM dodo_webhook_event WHERE event_id = ? LIMIT 1").bind(marker).first<J5ReplayMarkerRow>();
  let decision = resolveJ5ReplayClaim(row ?? null, token, runId, Date.parse(now), DODO_WEBHOOK_PROCESSING_LEASE_MS);
  if (decision === "replayed") {
    const metadata = parseObject(row?.metadata_json);
    const storedResult = metadata?.result;
    return { replayed: true as const, processingToken: token, result: isObject(storedResult) ? storedResult : {} };
  }
  if (decision === "in_progress") throw new J5ReplayInProgressError();
  if (decision === "stale") {
    const staleMetadata = parseObject(row?.metadata_json);
    const staleToken = typeof staleMetadata?.processingToken === "string" ? staleMetadata.processingToken : "";
    const staleStartedAt = typeof staleMetadata?.processingStartedAt === "string" ? staleMetadata.processingStartedAt : "";
    if (!staleToken || !staleStartedAt) throw new Error("j5_replay_stale_metadata_invalid");
    const reclaimed = await db.prepare("UPDATE dodo_webhook_event SET metadata_json = ?, processing_started_at = ? WHERE event_id = ? AND event_type = 'e2e_j5_replay' AND outcome = 'processing' AND json_extract(metadata_json, '$.status') = 'processing' AND json_extract(metadata_json, '$.runId') = ? AND json_extract(metadata_json, '$.processingToken') = ? AND json_extract(metadata_json, '$.processingStartedAt') = ?").bind(JSON.stringify(ownerMetadata), now, marker, runId, staleToken, staleStartedAt).run();
    if (Number(reclaimed.meta?.changes ?? 0) === 1) {
      return { replayed: false as const, processingToken: token, marker };
    }
    row = await db.prepare("SELECT outcome, metadata_json FROM dodo_webhook_event WHERE event_id = ? LIMIT 1").bind(marker).first<J5ReplayMarkerRow>();
    decision = resolveJ5ReplayClaim(row ?? null, token, runId, Date.parse(now), DODO_WEBHOOK_PROCESSING_LEASE_MS);
    if (decision === "replayed") {
      const metadata = parseObject(row?.metadata_json);
      return { replayed: true as const, processingToken: token, result: isObject(metadata?.result) ? metadata.result : {} };
    }
    if (decision === "in_progress" || decision === "stale") throw new J5ReplayInProgressError();
  }
  if (decision !== "claimed") throw new Error("j5_replay_claim_failed");
  return { replayed: false as const, processingToken: token, marker };
}

async function completeReplay(env: AppEnv, key: string, token: string, runId: string, result: Record<string, unknown>) {
  const marker = `${J5_REPLAY_PREFIX}${key}`;
  const db = ensureDb(env);
  const completion = await db.prepare("UPDATE dodo_webhook_event SET outcome = 'processed', processed_at = ?, metadata_json = ?, processing_started_at = NULL WHERE event_id = ? AND event_type = 'e2e_j5_replay' AND outcome = 'processing' AND json_extract(metadata_json, '$.status') = 'processing' AND json_extract(metadata_json, '$.processingToken') = ? AND json_extract(metadata_json, '$.runId') = ?").bind(new Date().toISOString(), JSON.stringify({ status: "succeeded", runId, result }), marker, token, runId).run();
  if (Number(completion.meta?.changes ?? 0) !== 1) throw new Error("j5_replay_completion_lost");
}

async function readJ5UserPlanRow(env: AppEnv, userId: J5User) {
  return ensureDb(env).prepare("SELECT plan, dodo_status, plan_updated_at, dodo_payment_id, dodo_product_id, dodo_subscription_id, dodo_customer_id, dodo_next_billing_at FROM user_plan WHERE user_id = ? LIMIT 1").bind(userId).first<J5UserStateRow>();
}

async function readJ5TransitionState(env: AppEnv, userId: J5User): Promise<J5TransitionState | null> {
  const row = await readJ5UserPlanRow(env, userId);
  return row ? {
    plan: row.plan,
    status: row.dodo_status,
    updatedAt: row.plan_updated_at,
    paymentId: row.dodo_payment_id,
    productId: row.dodo_product_id,
    subscriptionId: row.dodo_subscription_id,
    customerId: row.dodo_customer_id,
    nextBillingAt: row.dodo_next_billing_at,
  } : null;
}

async function readJ5UserState(env: AppEnv, userId: J5User) {
  const snapshot = await readJ5UserPlanRow(env, userId);
  return snapshot ? { user: publicUserLabel(userId), entitlement: { plan: snapshot.plan, status: snapshot.dodo_status, updatedAt: snapshot.plan_updated_at }, ledger: await readLedgerProjection(env, userId), provider: { called: false, reason: "e2e_network_denied" } } : null;
}

async function readJ5Snapshot(env: AppEnv) {
  const users = await Promise.all(J5_USERS.map(async (userId) => [publicUserLabel(userId), (await readJ5UserState(env, userId))?.entitlement ?? null] as const));
  const events = await ensureDb(env).prepare("SELECT event_type, outcome, metadata_json FROM dodo_webhook_event WHERE event_id LIKE ? ORDER BY event_id").bind(`${J5_EVENT_PREFIX}%`).all<J5EventRow>();
  const rows: J5EventRow[] = events.results ?? [];
  return { users: Object.fromEntries(users), ledger: { total: rows.length, processed: rows.filter((row) => row.outcome === "processed").length, ignored: rows.filter((row) => row.outcome === "ignored").length }, provider: { called: false, reason: "e2e_network_denied" } };
}

async function readLedgerProjection(env: AppEnv, userId: J5User) {
  // The production webhook ledger deliberately starts with a null user_id and
  // resolves linkage inside the signed payload. Scope by our namespaced event
  // ids here; exposing provider ids or raw payload metadata would defeat the
  // public projection's safety contract.
  void userId;
  const rows = await ensureDb(env).prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id LIKE ?").bind(`${J5_EVENT_PREFIX}%`).all<{ outcome: string }>();
  const ledgerRows: Array<{ outcome: string }> = rows.results ?? [];
  return { processed: ledgerRows.filter((row) => row.outcome === "processed").length, ignored: ledgerRows.filter((row) => row.outcome === "ignored").length };
}

function publicUserLabel(userId: J5User) {
  if (userId.includes("activation")) return userId.endsWith("tablet") ? "activation-tablet" : userId.endsWith("desktop") ? "activation-desktop" : "activation";
  return userId.replace(/^e2e-/, "");
}

function parseObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value || value.length > 16 * 1024) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch { return null; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function ensureDb(env: AppEnv) {
  if (!env.DB) throw new Error("missing_db");
  return env.DB;
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function notFound() {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}
