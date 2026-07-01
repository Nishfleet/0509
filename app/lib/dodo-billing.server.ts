import type { AppEnv } from "~/lib/env.server";
import { appOrigin } from "~/lib/env.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import {
  checkoutTargetFromSku,
  legacyBundleSlugForSku,
  readProviderProductId,
  resolveBillingSku,
  resolveBillingSkuFromProviderProductId,
  topUpQuantityForSku,
  type BillingSkuSlug,
  type CheckoutTarget,
} from "~/lib/billing-sku-catalog";
import { isPaidPlanFamily } from "~/lib/plan-entitlements";
import {
  dodo0509AdaptiveCurrencyEnabled,
  dodo0509AdaptiveCurrencyFeesInclusive,
  dodo0509ApiKey,
  dodo0509BaseUrl,
  dodo0509BrandId,
  type DodoCheckoutPricingContext,
} from "~/lib/dodo-pricing.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import type { PricingBillingCycle, PricingPlanSlug } from "~/lib/pricing";
import type { AppSession } from "~/lib/types";

export type DodoCheckoutTarget = CheckoutTarget;
const DODO_CHECKOUT_TIMEOUT_MS = 15_000;
const DODO_PORTAL_TIMEOUT_MS = 10_000;
const DODO_CHECKOUT_JSON_MAX_BYTES = 64_000;
const DODO_PORTAL_JSON_MAX_BYTES = 32_000;

export interface DodoCheckoutSession {
  checkoutUrl: string;
  sessionId: string | null;
}

export async function createDodo0509CheckoutSession({
  env,
  request,
  session,
  target,
  pricingContext = null,
  checkoutId = null,
  source = null,
  fetcher = fetch,
}: {
  env: AppEnv;
  request: Request;
  session: AppSession;
  target: DodoCheckoutTarget;
  pricingContext?: DodoCheckoutPricingContext | null;
  checkoutId?: string | null;
  source?: string | null;
  fetcher?: typeof fetch;
}): Promise<DodoCheckoutSession> {
  const apiKey = dodo0509ApiKey(env);
  if (!apiKey) throw new Response("Dodo API key is not configured.", { status: 503 });

  const productId = productIdForTarget(env, target);
  if (!productId) throw new Response("Dodo product is not configured.", { status: 503 });

  const checkoutSource = cleanCheckoutSource(source);
  const body: Record<string, unknown> = {
    product_cart: [{ product_id: productId, quantity: 1 }],
    adaptive_currency_fees_inclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
    customer: {
      email: session.user.email,
      name: session.user.name,
    },
    return_url: dodoCheckoutReturnUrl(env, request, target, checkoutSource),
    cancel_url: dodoCheckoutCancelUrl(env, request, target, checkoutId, checkoutSource),
    metadata: {
      app: "0509",
      user_id: session.user.id,
      target_kind: target.kind,
      sku: target.sku,
      ...(checkoutSource ? { source: checkoutSource } : {}),
      ...(checkoutId ? { checkout_id: checkoutId } : {}),
      ...(target.kind === "plan"
        ? { plan: target.planFamily, cycle: target.cycle }
        : { bundle: legacyBundleSlugForSku(target.sku) }),
    },
  };
  const billingCountry = normalizeCheckoutBillingCountry(pricingContext?.billingCountry);
  const billingCurrency = normalizeCheckoutBillingCurrency(pricingContext?.billingCurrency);
  if (billingCountry) body.billing_address = { country: billingCountry };
  if (dodo0509AdaptiveCurrencyEnabled(env) && billingCurrency) body.billing_currency = billingCurrency;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${dodo0509BaseUrl(env)}/checkouts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      { fetcher, timeoutMs: DODO_CHECKOUT_TIMEOUT_MS },
    );
  } catch {
    throw new Response("Dodo checkout is temporarily unavailable. Please try again.", {
      status: 502,
    });
  }
  let payload: Record<string, unknown>;
  try {
    payload = objectOrEmpty(
      (await readResponseJsonWithinLimit(response, DODO_CHECKOUT_JSON_MAX_BYTES)) ?? {},
    );
  } catch {
    throw new Response("Dodo checkout is temporarily unavailable. Please try again.", {
      status: 502,
    });
  }
  if (!response.ok) {
    throw new Response("Dodo checkout is temporarily unavailable. Please try again.", { status: 502 });
  }

  const checkoutUrl = readString(payload, "checkout_url");
  if (!checkoutUrl) throw new Response("Dodo did not return a checkout URL.", { status: 502 });
  if (!isDodoHostedCheckoutUrl(checkoutUrl)) {
    throw new Response("Dodo did not return a safe checkout URL.", { status: 502 });
  }

  return {
    checkoutUrl,
    sessionId: readString(payload, "session_id"),
  };
}

function dodoCheckoutReturnUrl(
  env: AppEnv,
  request: Request,
  target: DodoCheckoutTarget,
  source: string | null,
) {
  const url = new URL(`${appOrigin(env, request)}/app/billing`);
  url.searchParams.set("checkout", "dodo");
  url.searchParams.set("kind", target.kind);
  const cleanSource = cleanCheckoutSource(source);
  if (cleanSource) url.searchParams.set("source", cleanSource);
  if (target.kind === "plan") {
    url.searchParams.set("plan", target.planFamily);
    url.searchParams.set("cycle", target.cycle);
  }
  if (target.kind === "top_up") {
    url.searchParams.set("sku", target.sku);
    url.searchParams.set("started", new Date().toISOString());
  }
  return url.toString();
}

function dodoCheckoutCancelUrl(
  env: AppEnv,
  request: Request,
  target: DodoCheckoutTarget,
  checkoutId: string | null,
  source: string | null,
) {
  const cleanSource = cleanCheckoutSource(source);
  if (target.kind === "plan") {
    const url = new URL(`${appOrigin(env, request)}/api/billing/dodo/cancel`);
    if (checkoutId) url.searchParams.set("checkout_id", checkoutId);
    url.searchParams.set("plan", target.planFamily);
    url.searchParams.set("cycle", target.cycle);
    if (cleanSource) url.searchParams.set("source", cleanSource);
    return url.toString();
  }

  const url = new URL(`${appOrigin(env, request)}/app/billing`);
  url.searchParams.set("checkout", "cancelled");
  url.searchParams.set("kind", "top_up");
  url.searchParams.set("sku", target.sku);
  if (cleanSource) url.searchParams.set("source", cleanSource);
  url.hash = "top-ups";
  return url.toString();
}

function cleanCheckoutSource(value: string | null | undefined) {
  const cleaned = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(cleaned) ? cleaned : null;
}

export async function createDodoCustomerPortalSession(
  env: AppEnv,
  customerId: string,
  options: { request?: Request; fetcher?: typeof fetch } = {},
): Promise<string | null> {
  const apiKey = dodo0509ApiKey(env);
  if (!apiKey) return null;
  const endpoint = new URL(
    `${dodo0509BaseUrl(env)}/customers/${encodeURIComponent(customerId)}/customer-portal/session`,
  );
  if (options.request) {
    endpoint.searchParams.set("return_url", `${appOrigin(env, options.request)}/app/billing`);
  }

  try {
    const response = await fetchWithTimeout(
      endpoint.toString(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      { fetcher: options.fetcher, timeoutMs: DODO_PORTAL_TIMEOUT_MS },
    );
    if (!response.ok) {
      releaseFetchTimeout(response);
      return null;
    }

    const payload = objectOrEmpty(
      (await readResponseJsonWithinLimit(response, DODO_PORTAL_JSON_MAX_BYTES)) ?? {},
    );
    const portalUrl = readString(payload, "link") || readString(payload, "url") || "";
    return isDodoHostedCustomerPortalUrl(portalUrl) ? portalUrl : null;
  } catch {
    return null;
  }
}

export function isDodoHostedCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "checkout.dodopayments.com" ||
        url.hostname === "test.checkout.dodopayments.com" ||
        url.hostname.endsWith(".checkout.dodopayments.com"))
    );
  } catch {
    return false;
  }
}

export function isDodoHostedCustomerPortalUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "customer.dodopayments.com" ||
        url.hostname === "test.customer.dodopayments.com" ||
        url.hostname.endsWith(".customer.dodopayments.com"))
    );
  } catch {
    return false;
  }
}

// Standard Svix/Dodo replay tolerance: signed events older (or newer) than
// this are rejected so a captured-but-valid webhook cannot be replayed later.
export const DODO_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export async function verifyDodoWebhookRequest(env: AppEnv, request: Request, rawBody: string) {
  const secret = env.DODO_0509_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Response("Dodo webhook secret is not configured.", { status: 503 });

  const webhookId = request.headers.get("webhook-id") ?? request.headers.get("svix-id") ?? "";
  const webhookTimestamp =
    request.headers.get("webhook-timestamp") ?? request.headers.get("svix-timestamp") ?? "";
  const webhookSignature =
    request.headers.get("webhook-signature") ?? request.headers.get("svix-signature") ?? "";
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw new Response("Missing Dodo webhook signature headers.", { status: 400 });
  }

  if (!isDodoWebhookTimestampFresh(webhookTimestamp)) {
    throw new Response("Stale Dodo webhook timestamp.", { status: 400 });
  }

  const expectedSignature = await signDodoWebhookPayload(env, webhookId, webhookTimestamp, rawBody);
  if (!signatureMatches(webhookSignature, expectedSignature)) {
    throw new Response("Invalid Dodo webhook signature.", { status: 401 });
  }
}

export function isDodoWebhookTimestampFresh(
  webhookTimestamp: string,
  now: number = Date.now(),
) {
  const trimmed = webhookTimestamp.trim();
  // Svix sends unix seconds; tolerate ISO strings for canaries and tests.
  const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed);
  if (!Number.isFinite(numeric)) return false;

  return Math.abs(now - numeric) <= DODO_WEBHOOK_TOLERANCE_SECONDS * 1000;
}

export async function signDodoWebhookPayload(
  env: AppEnv,
  webhookId: string,
  webhookTimestamp: string,
  rawBody: string,
) {
  const secret = env.DODO_0509_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Response("Dodo webhook secret is not configured.", { status: 503 });

  return hmacSha256Base64(secret, `${webhookId}.${webhookTimestamp}.${rawBody}`);
}

export function extractDodoProofCreditGrant(env: AppEnv, payload: unknown) {
  if (!isSuccessfulDodoPaymentWebhook(payload)) return null;

  const root = paymentPayloadFromWebhookPayload(payload);
  const brandId = readString(root, "brand_id");
  const configuredBrandId = dodo0509BrandId(env);
  if (configuredBrandId && brandId && brandId !== configuredBrandId) return null;

  const metadata = objectOrEmpty(root.metadata);
  const userId = readString(metadata, "user_id") || readString(metadata, "userId");
  const paymentId = readString(root, "payment_id") || readString(root, "id");
  if (!userId || !paymentId) return null;

  const product = firstProduct(root);
  if (readDodoBoolean(product, "is_subscription") === true) return null;
  const productId = readString(product, "product_id");
  const sku = productId ? resolveBillingSkuFromProviderProductId(env, productId) : null;
  if (!productId || !sku || !sku.topUpQuantity) return null;

  const quantity = Math.max(1, Math.floor(Number(readValue(product, "quantity") ?? 1)));
  const credits = topUpQuantityForSku(sku) * quantity;
  const grantedAt = readString(root, "created_at") || new Date().toISOString();
  const legacyBundle = legacyBundleSlugForSku(sku.slug);

  return {
    userId,
    paymentId,
    productId,
    skuSlug: sku.slug,
    bundle: legacyBundle ?? sku.slug,
    quantity,
    credits,
    grantedAt,
    metadata: root,
  };
}

export function extractDodoPlanGrant(env: AppEnv, payload: unknown) {
  if (!isSuccessfulDodoPaymentWebhook(payload)) return null;

  const root = paymentPayloadFromWebhookPayload(payload);
  const brandId = readString(root, "brand_id");
  const configuredBrandId = dodo0509BrandId(env);
  if (configuredBrandId && brandId && brandId !== configuredBrandId) return null;

  const metadata = objectOrEmpty(root.metadata);
  const userId = readString(metadata, "user_id") || readString(metadata, "userId");
  const paymentId = readString(root, "payment_id") || readString(root, "id");
  if (!userId || !paymentId) return null;

  const product = firstProduct(root);
  const rawProductId = readString(product, "product_id");
  const metadataPlan = planFromTrustedMetadata(metadata);
  const productId =
    rawProductId || productIdFromTrustedPlanMetadata(env, metadata, metadataPlan) || "";
  const skuMatch = productId ? resolveBillingSkuFromProviderProductId(env, productId) : null;
  if (skuMatch?.topUpQuantity) return null;
  if (readDodoBoolean(product, "is_subscription") === false) return null;
  const planMatch = skuMatch?.planFamily
    ? {
        plan: skuMatch.planFamily,
        cycle: skuMatch.billingInterval === "annual" ? ("yearly" as const) : ("monthly" as const),
      }
    : null;
  const plan = planMatch?.plan ?? null;
  const cycle = planMatch?.cycle ?? metadataPlan?.cycle ?? "monthly";

  // Real subscription payments arrive with product_cart: null (verified
  // against live Dodo payloads — the cart is only populated for one-time
  // purchases). Metadata fallback is allowed only for 0509 plan checkouts.
  if (!plan || !isPaidPlanFamily(plan)) return null;

  // Don't let a plan-purchase payment that ALSO matches a usage bundle fall
  // through ambiguously: bundle payments carry the bundle product id and no
  // plan metadata, so reaching this point with a plan means a plan purchase.
  return {
    userId,
    paymentId,
    productId: productId || null,
    plan,
    cycle,
    status: readString(root, "status") || "payment.succeeded",
    grantedAt: readDodoPaymentGrantTimestamp(root),
    subscriptionId: readString(root, "subscription_id") || null,
    customerId: readString(objectOrEmpty(root.customer), "customer_id") || null,
    metadata: root,
  };
}

const DODO_SUBSCRIPTION_GRANT_EVENT_TYPES = new Set([
  "subscription.active",
  "subscription.renewed",
]);

// Subscription lifecycle grants: subscription.active fires on first
// activation, subscription.renewed on every successful renewal (and dunning
// recovery). Handling these keeps the plan fresh across months and clears a
// stale payment-issue flag once the customer's card recovers. The payload is
// the subscription object: product_id, checkout metadata, next_billing_date.
export function extractDodoSubscriptionGrant(env: AppEnv, payload: unknown) {
  const envelope = objectOrEmpty(payload);
  const eventType = readString(envelope, "type") || readString(envelope, "event");
  if (!DODO_SUBSCRIPTION_GRANT_EVENT_TYPES.has(eventType)) return null;

  const root = paymentPayloadFromWebhookPayload(payload);
  const brandId = readString(root, "brand_id");
  const configuredBrandId = dodo0509BrandId(env);
  if (configuredBrandId && brandId && brandId !== configuredBrandId) return null;

  const metadata = objectOrEmpty(root.metadata);
  const userId = readString(metadata, "user_id") || readString(metadata, "userId");
  const subscriptionId = readString(root, "subscription_id");
  if (!userId || !subscriptionId) return null;

  const metadataPlan = planFromTrustedMetadata(metadata);
  const rawProductId = readString(root, "product_id");
  const productId =
    rawProductId || productIdFromTrustedPlanMetadata(env, metadata, metadataPlan) || "";
  const skuMatch = productId ? resolveBillingSkuFromProviderProductId(env, productId) : null;
  if (skuMatch?.topUpQuantity) return null;
  if (readDodoBoolean(root, "is_subscription") === false || readDodoBoolean(root, "is_recurring") === false) {
    return null;
  }
  const planMatch = skuMatch?.planFamily
    ? {
        plan: skuMatch.planFamily,
        cycle: skuMatch.billingInterval === "annual" ? ("yearly" as const) : ("monthly" as const),
      }
    : null;
  const plan = planMatch?.plan ?? null;
  const cycle = planMatch?.cycle ?? metadataPlan?.cycle ?? "monthly";
  if (!plan || !isPaidPlanFamily(plan)) return null;

  const grantedAt =
    readString(root, "previous_billing_date") ||
    readString(root, "created_at") ||
    new Date().toISOString();

  return {
    eventType,
    userId,
    subscriptionId,
    customerId: readString(objectOrEmpty(root.customer), "customer_id") || null,
    productId: productId || null,
    plan,
    cycle,
    status: "active",
    grantedAt,
    nextBillingAt: readString(root, "next_billing_date") || null,
    metadata: root,
  };
}

function planFromMetadata(metadata: Record<string, unknown>) {
  const metadataPlan = readString(metadata, "plan");
  return metadataPlan === "scout" || metadataPlan === "starter" || metadataPlan === "agency"
    ? metadataPlan
    : null;
}

function planFromTrustedMetadata(
  metadata: Record<string, unknown>,
): { plan: PricingPlanSlug; cycle: PricingBillingCycle } | null {
  if (readString(metadata, "app") !== "0509") return null;
  if (readString(metadata, "target_kind") !== "plan") return null;
  const plan = planFromMetadata(metadata);
  if (!plan || !isPaidPlanFamily(plan)) return null;

  return {
    plan,
    cycle: cycleFromMetadata(metadata),
  };
}

function productIdFromTrustedPlanMetadata(
  env: AppEnv,
  metadata: Record<string, unknown>,
  trustedPlan: { plan: PricingPlanSlug; cycle: PricingBillingCycle } | null,
) {
  if (!trustedPlan) return "";
  const skuSlug = readString(metadata, "sku");
  const sku = skuSlug ? resolveBillingSku(skuSlug) : null;
  if (!sku || sku.purchaseType !== "subscription" || !sku.planFamily) return "";
  const skuCycle = sku.billingInterval === "annual" ? "yearly" : "monthly";
  if (sku.planFamily !== trustedPlan.plan || skuCycle !== trustedPlan.cycle) return "";
  return readProviderProductId(env, sku);
}

function cycleFromMetadata(metadata: Record<string, unknown>): PricingBillingCycle {
  const metadataCycle = readString(metadata, "cycle");
  return metadataCycle === "monthly" || metadataCycle === "yearly" ? metadataCycle : "monthly";
}

// Hard lifecycle ends: the customer (or Dodo) terminated the subscription.
const DODO_REVOCATION_EVENT_TYPES = new Set([
  "subscription.cancelled",
  "subscription.expired",
]);

// Dunning states: a renewal payment hiccuped and Dodo is retrying. The
// customer keeps their paid plan during this window; we only record the
// payment issue so the app can warn them. Revoking here would silently
// strip a paying customer over a transient card failure.
const DODO_PAYMENT_ISSUE_EVENT_TYPES = new Set(["subscription.failed", "subscription.on_hold"]);

export type DodoLifecycleAction = "revoke" | "payment_issue";

export function extractDodoPlanRevocation(env: AppEnv, payload: unknown) {
  const envelope = objectOrEmpty(payload);
  const eventType = readString(envelope, "type") || readString(envelope, "event");
  const action: DodoLifecycleAction | null = DODO_REVOCATION_EVENT_TYPES.has(eventType)
    ? "revoke"
    : DODO_PAYMENT_ISSUE_EVENT_TYPES.has(eventType)
      ? "payment_issue"
      : null;
  if (!action) return null;

  const root = paymentPayloadFromWebhookPayload(payload);
  const brandId = readString(root, "brand_id");
  const configuredBrandId = dodo0509BrandId(env);
  if (configuredBrandId && brandId && brandId !== configuredBrandId) return null;

  const metadata = objectOrEmpty(root.metadata);
  const userId = readString(metadata, "user_id") || readString(metadata, "userId") || null;
  const customer = objectOrEmpty(root.customer);
  const customerId = readString(customer, "customer_id") || null;
  const customerEmail = readString(customer, "email") || null;
  const productId = readString(root, "product_id");
  const skuMatch = productId ? resolveBillingSkuFromProviderProductId(env, productId) : null;
  const planMatch = skuMatch?.planFamily
    ? {
        plan: skuMatch.planFamily,
        cycle: skuMatch.billingInterval === "annual" ? ("yearly" as const) : ("monthly" as const),
      }
    : null;
  const metadataPlan = planFromTrustedMetadata(metadata);
  const hasPlanProof = Boolean(planMatch || metadataPlan);
  const rawSubscriptionId = readString(root, "subscription_id") || readString(root, "id");
  if (!userId && !rawSubscriptionId && !customerId && !hasPlanProof) return null;

  const subscriptionId = rawSubscriptionId || eventType;
  const revokedAt =
    readString(root, "cancelled_at") ||
    readString(root, "updated_at") ||
    readString(root, "created_at") ||
    new Date().toISOString();

  return {
    eventType,
    action,
    userId,
    customerId,
    customerEmail: hasPlanProof ? customerEmail : null,
    subscriptionId,
    status: readString(root, "status") || eventType,
    revokedAt,
    // When support uses Dodo's cancel-at-next-billing-date, the cancelled
    // event can carry a future effective timestamp; revoking immediately
    // would eat the period the customer already paid for.
    effectiveAt: readString(root, "cancelled_at") || revokedAt,
    metadata: root,
  };
}

const DODO_PLAN_CHECKOUT_FAILURE_EVENT_TYPES = new Set([
  "payment.cancelled",
  "payment.canceled",
  "subscription.failed",
]);

const DODO_PLAN_CHECKOUT_FAILURE_STATUSES = new Set([
  "cancelled",
  "canceled",
  "payment.cancelled",
  "payment.canceled",
  "subscription.failed",
]);

export function extractDodoPlanCheckoutFailure(env: AppEnv, payload: unknown) {
  const envelope = objectOrEmpty(payload);
  const eventType = readString(envelope, "type") || readString(envelope, "event");
  const root = paymentPayloadFromWebhookPayload(payload);
  const status = readString(root, "status");
  const canUseBareFailureStatus = !eventType;
  if (
    !DODO_PLAN_CHECKOUT_FAILURE_EVENT_TYPES.has(eventType) &&
    !(canUseBareFailureStatus && DODO_PLAN_CHECKOUT_FAILURE_STATUSES.has(status))
  ) {
    return null;
  }

  const brandId = readString(root, "brand_id");
  const configuredBrandId = dodo0509BrandId(env);
  if (configuredBrandId && brandId && brandId !== configuredBrandId) return null;

  const metadata = objectOrEmpty(root.metadata);
  const trustedPlan = planFromTrustedMetadata(metadata);
  const productId = readString(firstProduct(root), "product_id") || readString(root, "product_id");
  const skuMatch = productId ? resolveBillingSkuFromProviderProductId(env, productId) : null;
  const hasPlanProof = Boolean(trustedPlan || skuMatch?.planFamily);
  const userId = readString(metadata, "user_id") || readString(metadata, "userId");
  if (!userId || !hasPlanProof) return null;
  const checkoutId =
    readString(metadata, "checkout_id") ||
    readString(root, "checkout_id") ||
    readString(root, "checkout_session_id") ||
    readString(root, "session_id") ||
    null;
  if ((eventType === "subscription.failed" || (!eventType && status === "subscription.failed")) && !checkoutId) {
    return null;
  }
  const failedAt =
    readString(root, "failed_at") ||
    readString(root, "cancelled_at") ||
    readString(root, "updated_at") ||
    readString(root, "created_at");
  if (!Number.isFinite(Date.parse(failedAt))) return null;

  return {
    eventType: eventType || status || "checkout.failure",
    userId,
    checkoutId,
    paymentId: readString(root, "payment_id") || readString(root, "id") || null,
    status: status || eventType || "checkout.failure",
    failedAt,
    metadata: root,
  };
}

export function extractDodoRefund(env: AppEnv, payload: unknown) {
  const envelope = objectOrEmpty(payload);
  const eventType = readString(envelope, "type") || readString(envelope, "event");
  if (eventType !== "refund.succeeded") return null;

  const root = paymentPayloadFromWebhookPayload(payload);
  const brandId = readString(root, "brand_id");
  const configuredBrandId = dodo0509BrandId(env);
  if (configuredBrandId && brandId && brandId !== configuredBrandId) return null;

  const paymentId = readString(root, "payment_id");
  if (!paymentId) return null;

  // Partial refunds keep access; only a full refund revokes what was paid for.
  const isPartial = readValue(root, "is_partial") === true;
  if (isPartial) return null;

  const refundedAt =
    readString(root, "created_at") ||
    readString(root, "updated_at") ||
    new Date().toISOString();

  return {
    eventType,
    paymentId,
    refundId: readString(root, "refund_id") || readString(root, "id") || null,
    refundedAt,
    metadata: root,
  };
}

function readDodoPaymentGrantTimestamp(root: Record<string, unknown>) {
  return (
    readString(root, "paid_at") ||
    readString(root, "succeeded_at") ||
    readString(root, "updated_at") ||
    readString(root, "created_at") ||
    new Date().toISOString()
  );
}

function productIdForTarget(env: AppEnv, target: DodoCheckoutTarget) {
  const sku = resolveBillingSku(target.sku);
  if (!sku) return "";
  return readProviderProductId(env, sku);
}

export function checkoutTargetFromSkuSlug(slug: string): DodoCheckoutTarget | null {
  return checkoutTargetFromSku(slug);
}

export function billingSkuSlugFromCheckoutTarget(target: DodoCheckoutTarget): BillingSkuSlug {
  return target.sku;
}

function isSuccessfulDodoPaymentWebhook(payload: unknown) {
  const envelope = objectOrEmpty(payload);
  const eventType = readString(envelope, "type") || readString(envelope, "event");
  const payment = paymentPayloadFromWebhookPayload(payload);
  const status = readString(payment, "status");

  if (eventType) {
    return eventType === "payment.succeeded";
  }

  return status === "succeeded" || status === "payment.succeeded";
}

function paymentPayloadFromWebhookPayload(payload: unknown) {
  const envelope = objectOrEmpty(payload);
  const data = objectOrEmpty(envelope.data);
  return data.payload_type === "Payment" || Object.keys(data).length > 0 ? data : envelope;
}

function firstProduct(root: Record<string, unknown>) {
  const cart = readValue(root, "product_cart");
  return Array.isArray(cart) ? objectOrEmpty(cart[0]) : {};
}

function addDaysIso(value: string, days: number) {
  const time = new Date(value).getTime();
  const start = Number.isFinite(time) ? time : Date.now();
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
}

async function hmacSha256Base64(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    decodeWebhookSecret(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64(new Uint8Array(signature));
}

function decodeWebhookSecret(secret: string) {
  const normalized = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : "";
  if (!normalized) return new TextEncoder().encode(secret);

  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return new TextEncoder().encode(secret);
  }
}

function signatureMatches(header: string, expected: string) {
  const candidates = header
    .split(/\s+/)
    .flatMap((part) => part.split(","))
    .map((part) => part.trim().replace(/^v\d+=?/, ""))
    .filter(Boolean);

  return candidates.some((candidate) => constantTimeEqual(candidate, expected));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function readString(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function readDodoBoolean(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (typeof candidate === "boolean") return candidate;
  if (typeof candidate === "string") {
    const normalized = candidate.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function normalizeCheckoutBillingCountry(value: unknown) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "";
}

function normalizeCheckoutBillingCurrency(value: unknown) {
  const currency = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "";
}

function readValue(value: Record<string, unknown>, key: string) {
  return value[key];
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
