import type { AppEnv } from "~/lib/env.server";
import type { UserPlan } from "~/lib/plan.server";

export type DodoBillingPlan = Extract<UserPlan, "starter" | "agency">;
export type DodoBillingCycle = "monthly" | "yearly";

export interface DodoCheckoutSession {
  session_id?: string | null;
  checkout_session_id?: string | null;
  id?: string | null;
  checkout_url?: string | null;
  payment_link?: string | null;
}

export interface DodoCheckoutInput {
  plan: DodoBillingPlan;
  cycle: DodoBillingCycle;
  userId: string;
  userEmail: string;
  userName?: string | null;
  returnUrl: string;
}

export interface DodoSubscriptionWebhookUpdate {
  event: string;
  payloadCreatedAt: string | null;
  userId: string;
  plan: DodoBillingPlan;
  status: string;
  subscriptionId: string;
  customerId: string | null;
  productId: string | null;
  brandId: string | null;
  checkoutSessionId: string | null;
  shouldGrant: boolean;
  shouldRevoke: boolean;
}

const DODO_LIVE_URL = "https://live.dodopayments.com";
const DODO_TEST_URL = "https://test.dodopayments.com";
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
const WEBHOOK_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function trim(value: string | null | undefined) {
  return value?.trim() || "";
}

function dodoApiKey(env: AppEnv) {
  return trim(env.DODO_0509_PAYMENTS_API_KEY);
}

export function dodoWebhookSecret(env: AppEnv) {
  return trim(env.DODO_0509_PAYMENTS_WEBHOOK_KEY);
}

function dodoBrandId(env: AppEnv) {
  return trim(env.DODO_0509_BRAND_ID);
}

function dodoEnvironment(env: AppEnv) {
  const mode = trim(env.DODO_0509_ENVIRONMENT).toLowerCase();
  return mode === "test" || mode === "live" ? mode : null;
}

function dodoBaseUrl(env: AppEnv) {
  const mode = dodoEnvironment(env);
  if (!mode) {
    throw new Error("Dodo environment must be explicitly configured as test or live.");
  }
  return mode === "test" ? DODO_TEST_URL : DODO_LIVE_URL;
}

function productEnvKey(plan: DodoBillingPlan, cycle: DodoBillingCycle) {
  return `DODO_0509_PRODUCT_${plan.toUpperCase()}_${cycle.toUpperCase()}` as keyof AppEnv;
}

export function parseDodoBillingPlan(value: FormDataEntryValue | null) {
  return value === "starter" || value === "agency" ? value : null;
}

export function parseDodoBillingCycle(value: FormDataEntryValue | null) {
  return value === "monthly" || value === "yearly" ? value : null;
}

export function dodoProductId(
  env: AppEnv,
  plan: DodoBillingPlan,
  cycle: DodoBillingCycle,
) {
  return trim(env[productEnvKey(plan, cycle)] as string | undefined);
}

export function isDodoCheckoutOptionConfigured(
  env: AppEnv,
  plan: DodoBillingPlan,
  cycle: DodoBillingCycle,
) {
  return Boolean(
    dodoApiKey(env) &&
    dodoWebhookSecret(env) &&
    dodoBrandId(env) &&
    dodoEnvironment(env) &&
    dodoProductId(env, plan, cycle),
  );
}

export function isDodoCheckoutConfigured(env: AppEnv) {
  return (
    isDodoCheckoutOptionConfigured(env, "starter", "monthly") ||
    isDodoCheckoutOptionConfigured(env, "starter", "yearly") ||
    isDodoCheckoutOptionConfigured(env, "agency", "monthly") ||
    isDodoCheckoutOptionConfigured(env, "agency", "yearly")
  );
}

export function resolveDodoPlanFromProductId(
  env: AppEnv,
  productId: string | null | undefined,
) {
  const id = trim(productId);
  if (!id) {
    return null;
  }

  const options: Array<{
    cycle: DodoBillingCycle;
    plan: DodoBillingPlan;
  }> = [
    { plan: "starter", cycle: "monthly" },
    { plan: "starter", cycle: "yearly" },
    { plan: "agency", cycle: "monthly" },
    { plan: "agency", cycle: "yearly" },
  ];

  return options.find((option) => dodoProductId(env, option.plan, option.cycle) === id) ?? null;
}

export function isDodoWebhookProductAllowed(
  env: AppEnv,
  update: Pick<DodoSubscriptionWebhookUpdate, "plan" | "productId" | "brandId">,
) {
  const configuredPlan = resolveDodoPlanFromProductId(env, update.productId);
  const expectedBrandId = dodoBrandId(env);
  return (
    configuredPlan?.plan === update.plan &&
    Boolean(expectedBrandId) &&
    (!update.brandId || update.brandId === expectedBrandId)
  );
}

export function dodoCheckoutSessionId(session: DodoCheckoutSession) {
  return trim(session.session_id) || trim(session.checkout_session_id) || trim(session.id);
}

export function dodoCheckoutUrl(session: DodoCheckoutSession) {
  return trim(session.checkout_url) || trim(session.payment_link);
}

export async function createDodoCheckoutSession(
  env: AppEnv,
  input: DodoCheckoutInput,
  fetcher: typeof fetch = fetch,
) {
  const apiKey = dodoApiKey(env);
  const productId = dodoProductId(env, input.plan, input.cycle);
  if (!apiKey) {
    throw new Error("Dodo API key is not configured.");
  }
  const brandId = dodoBrandId(env);
  if (!brandId) {
    throw new Error("Dodo 0509 brand id is not configured.");
  }
  if (!dodoWebhookSecret(env)) {
    throw new Error("Dodo webhook key is not configured.");
  }
  if (!productId) {
    throw new Error(`Dodo ${input.plan} ${input.cycle} product is not configured.`);
  }

  const customer: { email: string; name?: string } = { email: input.userEmail };
  if (input.userName?.trim()) {
    customer.name = input.userName.trim();
  }

  const response = await fetcher(`${dodoBaseUrl(env)}/checkouts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer,
      return_url: input.returnUrl,
      metadata: {
        brand_id: brandId,
        product: "five_to_nine",
        source: "0509_web",
        user_id: input.userId,
        user_email: input.userEmail,
        plan: input.plan,
        cycle: input.cycle,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      readString((payload as Record<string, unknown>)?.message) ||
      JSON.stringify(payload) ||
      "Dodo checkout could not be created.";
    throw new Error(`Dodo checkout creation failed with ${response.status}: ${message}`);
  }

  return payload as DodoCheckoutSession;
}

async function hmacSha256Base64(message: string, keyBytes: Uint8Array) {
  const keyMaterial = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyMaterial).set(keyBytes);
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeWebhookSecret(secret: string) {
  const normalized = secret.trim().replace(/^whsec_/, "");
  try {
    return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
  } catch {
    return new TextEncoder().encode(secret);
  }
}

function safeEqual(left: string, right: string) {
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function dodoSignatureCandidates(header: string) {
  return header
    .split(" ")
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^v1[=,]/, ""));
}

export async function verifyDodoWebhookSignature(input: {
  rawBody: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  webhookSecret: string | undefined;
  now?: number;
}) {
  const secret = trim(input.webhookSecret);
  if (!secret) {
    throw new Response("Dodo webhook secret is not configured.", { status: 503 });
  }
  if (!input.webhookId || !input.webhookTimestamp || !input.webhookSignature) {
    throw new Response("Missing Dodo webhook signature headers.", { status: 400 });
  }

  const timestamp = Number(input.webhookTimestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Response("Invalid Dodo webhook timestamp.", { status: 400 });
  }

  const now = input.now ?? Date.now();
  const timestampMs = timestamp * 1000;
  if (timestampMs < now - WEBHOOK_MAX_AGE_MS || timestampMs > now + WEBHOOK_FUTURE_TOLERANCE_MS) {
    throw new Response("Stale Dodo webhook event.", { status: 400 });
  }

  const signedPayload = `${input.webhookId}.${input.webhookTimestamp}.${input.rawBody}`;
  const expected = await hmacSha256Base64(signedPayload, decodeWebhookSecret(secret));
  const matches = dodoSignatureCandidates(input.webhookSignature).some((candidate) =>
    safeEqual(candidate, expected),
  );

  if (!matches) {
    throw new Response("Invalid Dodo webhook signature.", { status: 401 });
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTimestampIso(value: unknown) {
  const text = readString(value);
  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function readCustomerId(data: Record<string, unknown>) {
  const customer = readObject(data.customer);
  return readString(customer?.customer_id) || readString(customer?.id) || readString(data.customer_id);
}

function readMetadata(payload: Record<string, unknown>, data: Record<string, unknown>) {
  const candidates = [
    readObject(data.metadata),
    readObject(data.meta_data),
    readObject(data.custom_data),
    readObject(readObject(data.checkout_session)?.metadata),
    readObject(readObject(data.subscription)?.metadata),
    readObject(payload.metadata),
  ];

  return candidates.find(Boolean) ?? {};
}

function readPlan(value: unknown): DodoBillingPlan | null {
  return value === "starter" || value === "agency" ? value : null;
}

const DODO_GRANT_EVENTS = new Set([
  "subscription.active",
  "subscription.renewed",
  "subscription.resumed",
]);
const DODO_REVOKE_EVENTS = new Set([
  "subscription.cancelled",
  "subscription.expired",
  "subscription.failed",
  "subscription.on_hold",
]);

export function parseDodoSubscriptionWebhook(payload: unknown): DodoSubscriptionWebhookUpdate | null {
  const body = readObject(payload);
  const data = readObject(body?.data);
  if (!body || !data) {
    return null;
  }

  const event = readString(body.type) || readString(body.event) || "";
  const payloadType = readString(data.payload_type)?.toLowerCase();
  const subscriptionId = readString(data.subscription_id) || readString(data.id);
  if (payloadType && payloadType !== "subscription") {
    return null;
  }
  if (!event.startsWith("subscription.") || !subscriptionId) {
    return null;
  }

  const metadata = readMetadata(body, data);
  const userId = readString(metadata.user_id);
  const plan = readPlan(metadata.plan);
  if (!userId || !plan) {
    return null;
  }

  const status = (readString(data.status) || event.replace(/^subscription\./, "")).toLowerCase();
  const productId = readString(data.product_id) || readString(readObject(data.product)?.id);
  const brandId = readString(data.brand_id) || readString(metadata.brand_id);
  const shouldGrant =
    DODO_GRANT_EVENTS.has(event) ||
    ["active", "renewed", "resumed"].includes(status);
  const shouldRevoke =
    DODO_REVOKE_EVENTS.has(event) ||
    ["cancelled", "expired", "failed", "on_hold"].includes(status);

  return {
    event,
    payloadCreatedAt: readTimestampIso(body.timestamp) || readTimestampIso(data.created_at),
    userId,
    plan,
    status,
    subscriptionId,
    customerId: readCustomerId(data),
    productId,
    brandId,
    checkoutSessionId:
      readString(data.checkout_session_id) ||
      readString(data.checkout_session) ||
      readString(data.session_id),
    shouldGrant,
    shouldRevoke,
  };
}
