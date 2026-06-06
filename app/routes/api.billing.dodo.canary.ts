import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { AppEnv } from "~/lib/env.server";
import type { PricingPlanSlug } from "~/lib/pricing";

interface BillingCanaryUserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string | null;
}

interface PlanGrantRow {
  plan: string;
  dodo_payment_id: string | null;
}

interface CreditGrantRow {
  credits: number;
  expires_at: string;
  granted_at: string;
  provider_payment_id: string;
}

export function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

function hasValidCanaryToken(request: Request, token: string | undefined) {
  const configured = token?.trim();
  if (!configured) {
    return false;
  }

  return request.headers.get("x-0509-canary-token") === configured;
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    dodo0509BrandId,
    dodo0509ProductIds,
    dodo0509UsageBundleProductIds,
    usageBundleCreditCount,
  } = await import("~/lib/dodo-pricing.server");
  const { signDodoWebhookPayload } = await import("~/lib/dodo-billing.server");
  const env = getEnv(context);

  if (!hasValidCanaryToken(request, env.CANARY_BYPASS_TOKEN)) {
    throw new Response("Not found", { status: 404 });
  }

  if (!env.DB) {
    return canaryFailure("missing_db");
  }

  const emailOverride = await readTestEmailOverride(request);
  if (emailOverride.invalid) {
    return canaryFailure("invalid_canary_email_override");
  }

  const canaryEmail = emailOverride.email ?? env.LAUNCH_CANARY_EMAIL?.trim();
  if (!canaryEmail) {
    return canaryFailure("missing_launch_canary_email");
  }

  const user = await getBillingCanaryUser(env, canaryEmail);
  if (!user) {
    return canaryFailure("missing_canary_user");
  }

  const plan = planForCanary(user.plan);
  const planProductId = dodo0509ProductIds(env)[plan].monthly;
  const creditProductId = dodo0509UsageBundleProductIds(env).proof_500;
  if (!planProductId || !creditProductId) {
    return canaryFailure("missing_dodo_product_ids");
  }

  const nowIso = new Date().toISOString();
  const runKey = `billing-canary-${normalizeIdempotencySegment(user.id)}-${plan}-monthly-proof-500-${normalizeIdempotencySegment(nowIso)}`;
  const brandId = dodo0509BrandId(env) || undefined;
  const creditCount = usageBundleCreditCount("proof_500");
  const planPaymentId = `${runKey}-plan`;
  const creditPaymentId = `${runKey}-proof-500`;
  const planPayload = {
    id: planPaymentId,
    payment_id: planPaymentId,
    brand_id: brandId,
	    status: "payment.succeeded",
	    created_at: nowIso,
	    updated_at: nowIso,
	    metadata: {
      app: "0509",
      user_id: user.id,
      target_kind: "plan",
      plan,
      cycle: "monthly",
      canary: "billing",
    },
    product_cart: [
      {
        product_id: planProductId,
        quantity: 1,
      },
    ],
  };
  const creditPayload = {
    id: creditPaymentId,
    payment_id: creditPaymentId,
    brand_id: brandId,
	    status: "payment.succeeded",
	    created_at: nowIso,
	    updated_at: nowIso,
	    metadata: {
      app: "0509",
      user_id: user.id,
      target_kind: "usage_bundle",
      bundle: "proof_500",
      credits: creditCount,
      canary: "billing",
    },
    product_cart: [
      {
        product_id: creditProductId,
        quantity: 1,
      },
    ],
  };

  const [planWebhook, creditWebhook] = await Promise.all([
    postSignedWebhook({
      env,
      context,
      request,
      webhookId: `${runKey}-plan-webhook`,
      payload: planPayload,
      signDodoWebhookPayload,
    }),
    postSignedWebhook({
      env,
      context,
      request,
      webhookId: `${runKey}-credit-webhook`,
      payload: creditPayload,
      signDodoWebhookPayload,
    }),
  ]);

  const [planGrant, creditGrant] = await Promise.all([
    getPlanGrant(env, user.id, planPaymentId),
    getCreditGrant(env, user.id, creditPaymentId),
  ]);
  const paidPlanUnlocked = planWebhook.ok && planGrant?.plan === plan;
	  const proofCreditsGranted =
	    creditWebhook.ok &&
	    creditGrant?.provider_payment_id === creditPaymentId &&
	    Number(creditGrant.credits) === creditCount &&
	    isCurrentActiveCreditGrant(creditGrant, nowIso);
	  const creditCleanupOk = creditGrant
	    ? await cleanupCanaryCreditGrant(env, user.id, creditPaymentId)
	    : false;
	  const ok = paidPlanUnlocked && proofCreditsGranted && creditCleanupOk;

  return Response.json(
    {
      ok,
      user: {
        email: user.email,
        plan,
      },
      webhook: {
        plan: planWebhook,
        proofCredits: creditWebhook,
      },
      grants: {
        paidPlanUnlocked,
	        proofCreditsGranted,
	        proofCreditCleanupOk: creditCleanupOk,
	        credits: creditGrant?.credits ?? 0,
	      },
    },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

async function postSignedWebhook({
  env,
  context,
  request,
  webhookId,
  payload,
  signDodoWebhookPayload,
}: {
  env: AppEnv;
  context: ActionFunctionArgs["context"];
  request: Request;
  webhookId: string;
  payload: Record<string, unknown>;
  signDodoWebhookPayload: (
    env: AppEnv,
    webhookId: string,
    webhookTimestamp: string,
    rawBody: string,
  ) => Promise<string>;
}) {
  const rawBody = JSON.stringify(payload);
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signDodoWebhookPayload(env, webhookId, webhookTimestamp, rawBody);
  const webhookUrl = new URL("/api/webhooks/dodo", request.url);
  const webhookRequest = new Request(webhookUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "0509-billing-canary/1.0",
      "webhook-id": webhookId,
      "webhook-timestamp": webhookTimestamp,
      "webhook-signature": `v1=${signature}`,
    },
    body: rawBody,
  });
  const { action: webhookAction } = await import("~/routes/api.webhooks.dodo");
  const response = await webhookAction({
    context,
    request: webhookRequest,
    params: {},
  } as never);

  return {
    ok: response.ok,
    status: response.status,
  };
}

async function getBillingCanaryUser(env: AppEnv, email: string) {
  const result = await env.DB?.prepare(`
      SELECT
        user.id,
        user.email,
        user.name,
        user_plan.plan
      FROM user
      LEFT JOIN user_plan
        ON user_plan.user_id = user.id
      WHERE lower(user.email) = lower(?)
      LIMIT 1
    `).bind(email).all<BillingCanaryUserRow>();

  return result?.results?.[0] ?? null;
}

async function getPlanGrant(env: AppEnv, userId: string, providerPaymentId: string) {
  const result = await env.DB?.prepare(`
      SELECT plan, dodo_payment_id
      FROM user_plan
      WHERE user_id = ?
        AND dodo_payment_id = ?
      LIMIT 1
    `).bind(userId, providerPaymentId).all<PlanGrantRow>();

  return result?.results?.[0] ?? null;
}

async function getCreditGrant(env: AppEnv, userId: string, providerPaymentId: string) {
  const result = await env.DB?.prepare(`
      SELECT credits, expires_at, granted_at, provider_payment_id
      FROM proof_usage_credit
      WHERE user_id = ?
        AND provider_payment_id = ?
      LIMIT 1
    `).bind(userId, providerPaymentId).all<CreditGrantRow>();

  return result?.results?.[0] ?? null;
}

async function cleanupCanaryCreditGrant(env: AppEnv, userId: string, providerPaymentId: string) {
  try {
    await env.DB?.prepare(`
        DELETE FROM proof_usage_credit
        WHERE user_id = ?
          AND provider_payment_id = ?
      `).bind(userId, providerPaymentId).run();
    return true;
  } catch {
    return false;
  }
}

function isCurrentActiveCreditGrant(grant: CreditGrantRow, nowIso: string) {
  const now = Date.parse(nowIso);
  const grantedAt = Date.parse(grant.granted_at);
  const expiresAt = Date.parse(grant.expires_at);
  return (
    Number.isFinite(now) &&
    Number.isFinite(grantedAt) &&
    Number.isFinite(expiresAt) &&
    grantedAt >= now &&
    expiresAt > now
  );
}

function planForCanary(value: string | null): PricingPlanSlug {
  if (value === "agency" || value === "starter" || value === "scout") {
    return value;
  }

  return "scout";
}

async function readTestEmailOverride(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return { email: null, invalid: false };
  }

  const payload = await request.clone().json().catch(() => null);
  const email =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? String((payload as Record<string, unknown>).email ?? "").trim().toLowerCase()
      : "";
  if (!email) {
    return { email: null, invalid: false };
  }

  if (!email.endsWith("@example.com")) {
    return { email: null, invalid: true };
  }

  return { email, invalid: false };
}

function canaryFailure(blocker: string) {
  return Response.json(
    {
      ok: false,
      blocker,
    },
    {
      status: 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

function normalizeIdempotencySegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
