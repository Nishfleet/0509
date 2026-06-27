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
  quantity_granted: number;
  status: string;
  granted_at: string;
  provider_payment_id: string;
}

interface UserPlanSnapshot {
  user_id: string;
  plan: string;
  plan_updated_at: string;
  dodo_payment_id: string | null;
  dodo_product_id: string | null;
  dodo_status: string | null;
  dodo_subscription_id: string | null;
  dodo_customer_id: string | null;
  dodo_next_billing_at: string | null;
}

interface WatchlistStateSnapshot {
  id: string;
  is_active: number;
  paused_reason: string | null;
  updated_at: string;
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
  const userPlanSnapshot = await getUserPlanSnapshot(env, user.id);
  const watchlistStateSnapshot = await getWatchlistStateSnapshot(env, user.id);

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
    Number(creditGrant.quantity_granted) === creditCount &&
    isCurrentActiveTopUpGrant(creditGrant);
  const [planCleanupOk, creditCleanupOk] = await Promise.all([
    planGrant
      ? cleanupCanaryPlanGrant(
          env,
          user.id,
          planPaymentId,
          userPlanSnapshot,
          watchlistStateSnapshot,
        )
      : Promise.resolve(false),
    creditGrant ? cleanupCanaryCreditGrant(env, user.id, creditPaymentId) : Promise.resolve(false),
  ]);
  const ok = paidPlanUnlocked && proofCreditsGranted && planCleanupOk && creditCleanupOk;

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
        planCleanupOk,
        watchlistCleanupOk: planCleanupOk,
        proofCreditsGranted,
        proofCreditCleanupOk: creditCleanupOk,
        credits: creditGrant ? Number(creditGrant.quantity_granted) : 0,
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
      SELECT quantity_granted, status, granted_at, provider_payment_id
      FROM evidence_top_up_grant
      WHERE workspace_user_id = ?
        AND provider_payment_id = ?
      LIMIT 1
    `).bind(userId, providerPaymentId).all<CreditGrantRow>();

  return result?.results?.[0] ?? null;
}

async function getUserPlanSnapshot(env: AppEnv, userId: string) {
  const result = await env.DB?.prepare(`
      SELECT
        user_id,
        plan,
        plan_updated_at,
        dodo_payment_id,
        dodo_product_id,
        dodo_status,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_next_billing_at
      FROM user_plan
      WHERE user_id = ?
      LIMIT 1
    `).bind(userId).all<UserPlanSnapshot>();

  return result?.results?.[0] ?? null;
}

async function getWatchlistStateSnapshot(env: AppEnv, userId: string) {
  const result = await env.DB?.prepare(`
      SELECT id, is_active, paused_reason, updated_at
      FROM watchlist
      WHERE user_id = ?
    `).bind(userId).all<WatchlistStateSnapshot>();

  return result?.results ?? [];
}

async function cleanupCanaryPlanGrant(
  env: AppEnv,
  userId: string,
  providerPaymentId: string,
  snapshot: UserPlanSnapshot | null,
  watchlists: WatchlistStateSnapshot[],
) {
  try {
    if (snapshot) {
      await env.DB?.prepare(`
          UPDATE user_plan
          SET plan = ?,
              plan_updated_at = ?,
              dodo_payment_id = ?,
              dodo_product_id = ?,
              dodo_status = ?,
              dodo_subscription_id = ?,
              dodo_customer_id = ?,
              dodo_next_billing_at = ?
          WHERE user_id = ?
            AND dodo_payment_id = ?
        `).bind(
          snapshot.plan,
          snapshot.plan_updated_at,
          snapshot.dodo_payment_id,
          snapshot.dodo_product_id,
          snapshot.dodo_status,
          snapshot.dodo_subscription_id,
          snapshot.dodo_customer_id,
          snapshot.dodo_next_billing_at,
          userId,
          providerPaymentId,
        ).run();
    } else {
      await env.DB?.prepare(`
          DELETE FROM user_plan
          WHERE user_id = ?
            AND dodo_payment_id = ?
        `).bind(userId, providerPaymentId).run();
    }

    const syntheticGrant = await getPlanGrant(env, userId, providerPaymentId);
    const watchlistsRestored = await restoreWatchlistStateSnapshot(env, userId, watchlists);
    return !syntheticGrant && watchlistsRestored;
  } catch {
    return false;
  }
}

async function restoreWatchlistStateSnapshot(
  env: AppEnv,
  userId: string,
  watchlists: WatchlistStateSnapshot[],
) {
  try {
    for (const watchlist of watchlists) {
      await env.DB?.prepare(`
          UPDATE watchlist
          SET is_active = ?,
              paused_reason = ?,
              updated_at = ?
          WHERE user_id = ?
            AND id = ?
        `).bind(
          watchlist.is_active,
          watchlist.paused_reason,
          watchlist.updated_at,
          userId,
          watchlist.id,
        ).run();
    }
    return true;
  } catch {
    return false;
  }
}

async function cleanupCanaryCreditGrant(env: AppEnv, userId: string, providerPaymentId: string) {
  try {
    await env.DB?.prepare(`
        DELETE FROM evidence_top_up_grant
        WHERE workspace_user_id = ?
          AND provider_payment_id = ?
      `).bind(userId, providerPaymentId).run();
    const remaining = await getCreditGrant(env, userId, providerPaymentId);
    return !remaining;
  } catch {
    return false;
  }
}

function isCurrentActiveTopUpGrant(grant: CreditGrantRow) {
  return grant.status === "active" && Number(grant.quantity_granted) > 0;
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
