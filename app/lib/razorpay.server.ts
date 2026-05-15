import type { AppEnv } from "~/lib/env.server";
import type { UserPlan } from "~/lib/plan.server";

export type RazorpayBillingPlan = Extract<UserPlan, "starter" | "agency">;
export type RazorpayBillingCycle = "monthly" | "yearly";

export interface RazorpaySubscription {
  id: string;
  status: string;
  short_url?: string | null;
  customer_id?: string | null;
  plan_id?: string | null;
}

export interface RazorpaySubscriptionInput {
  plan: RazorpayBillingPlan;
  cycle: RazorpayBillingCycle;
  userId: string;
  userEmail: string;
}

export interface RazorpaySubscriptionWebhookUpdate {
  eventId: string | null;
  event: string;
  payloadCreatedAt: string | null;
  userId: string;
  plan: RazorpayBillingPlan;
  status: string;
  subscriptionId: string;
  customerId: string | null;
  providerPlanId: string | null;
  shouldGrant: boolean;
  shouldRevoke: boolean;
}

const RAZORPAY_API_BASE_URL = "https://api.razorpay.com/v1";
const MONTHLY_TOTAL_COUNT = 120;
const YEARLY_TOTAL_COUNT = 10;
const CHECKOUT_LINK_TTL_SECONDS = 60 * 60;
const WEBHOOK_MAX_AGE_MS = 26 * 60 * 60 * 1000;
const WEBHOOK_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function trim(value: string | undefined) {
  return value?.trim() || "";
}

function planEnvKey(plan: RazorpayBillingPlan, cycle: RazorpayBillingCycle) {
  return `RAZORPAY_PLAN_${plan.toUpperCase()}_${cycle.toUpperCase()}` as keyof AppEnv;
}

export function parseRazorpayBillingPlan(value: FormDataEntryValue | null) {
  return value === "starter" || value === "agency" ? value : null;
}

export function parseRazorpayBillingCycle(value: FormDataEntryValue | null) {
  return value === "monthly" || value === "yearly" ? value : null;
}

export function razorpayPlanId(
  env: AppEnv,
  plan: RazorpayBillingPlan,
  cycle: RazorpayBillingCycle,
) {
  return trim(env[planEnvKey(plan, cycle)] as string | undefined);
}

export function isRazorpaySubscriptionOptionConfigured(
  env: AppEnv,
  plan: RazorpayBillingPlan,
  cycle: RazorpayBillingCycle,
) {
  return Boolean(trim(env.RAZORPAY_KEY_ID) && trim(env.RAZORPAY_KEY_SECRET) && razorpayPlanId(env, plan, cycle));
}

export function isRazorpaySubscriptionCheckoutConfigured(env: AppEnv) {
  return (
    isRazorpaySubscriptionOptionConfigured(env, "starter", "monthly") ||
    isRazorpaySubscriptionOptionConfigured(env, "starter", "yearly") ||
    isRazorpaySubscriptionOptionConfigured(env, "agency", "monthly") ||
    isRazorpaySubscriptionOptionConfigured(env, "agency", "yearly")
  );
}

function base64Encode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function authHeader(env: AppEnv) {
  const keyId = trim(env.RAZORPAY_KEY_ID);
  const keySecret = trim(env.RAZORPAY_KEY_SECRET);
  if (!keyId || !keySecret) {
    throw new Error("Razorpay keys are not configured.");
  }

  return `Basic ${base64Encode(`${keyId}:${keySecret}`)}`;
}

async function hmacSha256Hex(message: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) {
    return false;
  }

  const a = left.toLowerCase();
  const b = right.toLowerCase();
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);

  for (let index = 0; index < max; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }

  return diff === 0;
}

export async function verifyRazorpaySubscriptionSignature(input: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
  keySecret: string;
}) {
  const expected = await hmacSha256Hex(
    `${input.paymentId}|${input.subscriptionId}`,
    input.keySecret,
  );
  return safeHexEqual(expected, input.signature);
}

export async function verifyRazorpayWebhookSignature(input: {
  rawBody: string;
  signature: string | null;
  webhookSecret: string | undefined;
}) {
  const secret = trim(input.webhookSecret);
  if (!secret) {
    throw new Response("Razorpay webhook secret is not configured.", { status: 503 });
  }

  if (!input.signature) {
    throw new Response("Missing Razorpay webhook signature.", { status: 400 });
  }

  const expected = await hmacSha256Hex(input.rawBody, secret);
  if (!safeHexEqual(expected, input.signature)) {
    throw new Response("Invalid Razorpay webhook signature.", { status: 401 });
  }
}

export async function createRazorpaySubscription(
  env: AppEnv,
  input: RazorpaySubscriptionInput,
  fetcher: typeof fetch = fetch,
) {
  const planId = razorpayPlanId(env, input.plan, input.cycle);
  if (!planId) {
    throw new Error(`Razorpay ${input.plan} ${input.cycle} plan is not configured.`);
  }

  const now = Math.floor(Date.now() / 1000);
  const response = await fetcher(`${RAZORPAY_API_BASE_URL}/subscriptions`, {
    method: "POST",
    headers: {
      authorization: authHeader(env),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      plan_id: planId,
      total_count: input.cycle === "monthly" ? MONTHLY_TOTAL_COUNT : YEARLY_TOTAL_COUNT,
      quantity: 1,
      customer_notify: false,
      expire_by: now + CHECKOUT_LINK_TTL_SECONDS,
      notes: {
        product: "five_to_nine",
        source: "0509_web",
        user_id: input.userId,
        user_email: input.userEmail,
        plan: input.plan,
        cycle: input.cycle,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Razorpay subscription creation failed with ${response.status}: ${body}`);
  }

  return response.json() as Promise<RazorpaySubscription>;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readUnixTimestampIso(value: unknown) {
  const timestamp =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString();
}

export async function fingerprintRazorpayWebhookBody(rawBody: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `body_sha256:${hex}`;
}

export function isRazorpayWebhookFresh(payloadCreatedAt: string | null, now = Date.now()) {
  if (!payloadCreatedAt) {
    return true;
  }

  const createdAt = Date.parse(payloadCreatedAt);
  if (!Number.isFinite(createdAt)) {
    return false;
  }

  return createdAt <= now + WEBHOOK_FUTURE_TOLERANCE_MS && now - createdAt <= WEBHOOK_MAX_AGE_MS;
}

export function parseRazorpaySubscriptionWebhook(
  payload: unknown,
): RazorpaySubscriptionWebhookUpdate | null {
  const root = readObject(payload);
  const event = readString(root?.event);
  const subscription = readObject(readObject(readObject(root?.payload)?.subscription)?.entity);
  if (!event || !subscription) {
    return null;
  }

  const notes = readObject(subscription.notes);
  const userId = readString(notes?.user_id);
  const plan = readString(notes?.plan);
  const status = readString(subscription.status);
  const subscriptionId = readString(subscription.id);
  if (!userId || !status || !subscriptionId || (plan !== "starter" && plan !== "agency")) {
    return null;
  }

  return {
    eventId: readString(root?.id),
    event,
    payloadCreatedAt: readUnixTimestampIso(root?.created_at),
    userId,
    plan,
    status,
    subscriptionId,
    customerId: readString(subscription.customer_id),
    providerPlanId: readString(subscription.plan_id),
    shouldGrant: status === "active",
    shouldRevoke: ["cancelled", "completed", "expired", "halted", "paused"].includes(status),
  };
}
