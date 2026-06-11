import type { AppEnv } from "~/lib/env.server";
import { appOrigin } from "~/lib/env.server";
import {
  dodo0509ApiKey,
  dodo0509BaseUrl,
  dodo0509BrandId,
  dodo0509PlanForProductId,
  dodo0509ProductIds,
  dodo0509UsageBundleForProductId,
  dodo0509UsageBundleProductIds,
  usageBundleCreditCount,
} from "~/lib/dodo-pricing.server";
import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";
import type { AppSession } from "~/lib/types";

export type DodoCheckoutTarget =
  | { kind: "plan"; plan: PricingPlanSlug; cycle: PricingBillingCycle }
  | { kind: "usage_bundle"; bundle: UsageBundleSlug };

export interface DodoCheckoutSession {
  checkoutUrl: string;
  sessionId: string | null;
}

export async function createDodo0509CheckoutSession({
  env,
  request,
  session,
  target,
  fetcher = fetch,
}: {
  env: AppEnv;
  request: Request;
  session: AppSession;
  target: DodoCheckoutTarget;
  fetcher?: typeof fetch;
}): Promise<DodoCheckoutSession> {
  const apiKey = dodo0509ApiKey(env);
  if (!apiKey) throw new Response("Dodo API key is not configured.", { status: 503 });

  const productId = productIdForTarget(env, target);
  if (!productId) throw new Response("Dodo product is not configured.", { status: 503 });

  const response = await fetcher(`${dodo0509BaseUrl(env)}/checkouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: {
        email: session.user.email,
        name: session.user.name,
      },
      return_url: `${appOrigin(env, request)}/app?checkout=dodo`,
      metadata: {
        app: "0509",
        user_id: session.user.id,
        target_kind: target.kind,
        ...(target.kind === "plan"
          ? { plan: target.plan, cycle: target.cycle }
          : { bundle: target.bundle, credits: usageBundleCreditCount(target.bundle) }),
      },
    }),
  });
  const payload = objectOrEmpty(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new Response(readPayloadMessage(payload, "Dodo checkout failed."), { status: 502 });
  }

  const checkoutUrl = readString(payload, "checkout_url");
  if (!checkoutUrl) throw new Response("Dodo did not return a checkout URL.", { status: 502 });

  return {
    checkoutUrl,
    sessionId: readString(payload, "session_id"),
  };
}

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

  const expectedSignature = await signDodoWebhookPayload(env, webhookId, webhookTimestamp, rawBody);
  if (!signatureMatches(webhookSignature, expectedSignature)) {
    throw new Response("Invalid Dodo webhook signature.", { status: 401 });
  }
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
  const productId = readString(product, "product_id");
  const bundle = productId ? dodo0509UsageBundleForProductId(env, productId) : undefined;
  if (!productId || !bundle) return null;

	  const quantity = Math.max(1, Math.floor(Number(readValue(product, "quantity") ?? 1)));
	  const credits = usageBundleCreditCount(bundle) * quantity;
	  const grantedAt = readString(root, "created_at") || new Date().toISOString();

	  return {
	    userId,
    paymentId,
    productId,
    bundle,
	    quantity,
	    credits,
	    grantedAt,
	    expiresAt: addDaysIso(grantedAt, 30),
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
  const productId = readString(product, "product_id");
  const planMatch = productId ? dodo0509PlanForProductId(env, productId) : null;
  const metadataPlan = readString(metadata, "plan");
  const metadataCycle = readString(metadata, "cycle");
  const plan =
    planMatch?.plan ??
    (metadataPlan === "scout" || metadataPlan === "starter" || metadataPlan === "agency"
      ? metadataPlan
      : null);
  const cycle =
    planMatch?.cycle ??
    (metadataCycle === "monthly" || metadataCycle === "yearly" ? metadataCycle : "monthly");
  if (!plan || !productId) return null;

	  return {
	    userId,
	    paymentId,
	    productId,
	    plan,
	    cycle,
	    status: readString(root, "status") || "payment.succeeded",
	    grantedAt: readDodoPaymentGrantTimestamp(root),
	    metadata: root,
	  };
	}

const DODO_REVOCATION_EVENT_TYPES = new Set([
  "subscription.cancelled",
  "subscription.expired",
  "subscription.failed",
  "subscription.on_hold",
]);

export function extractDodoPlanRevocation(env: AppEnv, payload: unknown) {
  const envelope = objectOrEmpty(payload);
  const eventType = readString(envelope, "type") || readString(envelope, "event");
  if (!DODO_REVOCATION_EVENT_TYPES.has(eventType)) return null;

  const root = paymentPayloadFromWebhookPayload(payload);
  const brandId = readString(root, "brand_id");
  const configuredBrandId = dodo0509BrandId(env);
  if (configuredBrandId && brandId && brandId !== configuredBrandId) return null;

  const metadata = objectOrEmpty(root.metadata);
  const userId = readString(metadata, "user_id") || readString(metadata, "userId") || null;
  const customer = objectOrEmpty(root.customer);
  const customerEmail = readString(customer, "email") || null;
  if (!userId && !customerEmail) return null;

  const subscriptionId =
    readString(root, "subscription_id") || readString(root, "id") || eventType;
  const revokedAt =
    readString(root, "cancelled_at") ||
    readString(root, "updated_at") ||
    readString(root, "created_at") ||
    new Date().toISOString();

  return {
    eventType,
    userId,
    customerEmail,
    subscriptionId,
    status: readString(root, "status") || eventType,
    revokedAt,
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
  if (target.kind === "plan") {
    return dodo0509ProductIds(env)[target.plan][target.cycle];
  }

  return dodo0509UsageBundleProductIds(env)[target.bundle];
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

function readPayloadMessage(payload: unknown, fallback: string) {
  const message = readString(objectOrEmpty(payload), "message");
  return message || fallback;
}

function readString(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function readValue(value: Record<string, unknown>, key: string) {
  return value[key];
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
