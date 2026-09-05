import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { buildBillingCanaryLockId } from "~/lib/billing-canary-lock";
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
  dodo_plan_change_product_id: string | null;
  dodo_status: string | null;
  dodo_subscription_id: string | null;
  dodo_customer_id: string | null;
  dodo_next_billing_at: string | null;
  evidence_entitlement_anchor: string | null;
  evidence_entitlement_anchor_source: string | null;
}

interface WatchlistStateSnapshot {
  id: string;
  is_active: number;
  paused_reason: string | null;
  updated_at: string;
}

interface BillingCanaryRecoveryMetadata {
  action: "billing_canary_active";
  userId: string;
  userPlanSnapshot: UserPlanSnapshot;
  watchlistStateSnapshot: WatchlistStateSnapshot[];
  planPaymentId: string;
  creditPaymentId: string;
  canaryPlan: PricingPlanSlug;
  canaryProductId: string;
  canaryPlanUpdatedAt: string;
}

interface RecoverableBillingCanaryRow {
  event_id: string;
  metadata_json: string;
}

const BILLING_CANARY_RECOVERY_STALE_DAYS = 5 / (24 * 60);
// Keep the lock-held work below the shared 5-minute webhook lease and the
// script's 60-second request timeout; observed overruns fail closed.
const BILLING_CANARY_MAX_RUNTIME_MS = 60_000;

export function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST", "cache-control": "no-store" } },
  );
}

function hasValidCanaryToken(request: Request, token: string | undefined) {
  const configured = token?.trim();
  if (!configured) {
    return false;
  }

  return request.headers.get("x-0509-canary-token") === configured;
}

function hasCanonicalCanaryOrigin(request: Request) {
  try {
    const url = new URL(request.url);
    const authority = request.url.match(/^https:\/\/([^/?#]+)/i)?.[1]?.toLowerCase();
    return (
      url.protocol === "https:" &&
      url.origin === "https://0509.io" &&
      authority === "0509.io" &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);

  if (!hasValidCanaryToken(request, env.CANARY_BYPASS_TOKEN)) {
    throw new Response("Not found", { status: 404 });
  }

  if (!hasCanonicalCanaryOrigin(request)) {
    throw new Response("Not found", { status: 404 });
  }

  if (request.method !== "POST") {
    return Response.json(
      { ok: false, blocker: "billing_canary_requires_post" },
      {
        status: 405,
        headers: { Allow: "POST", "cache-control": "no-store" },
      },
    );
  }

  const { verifyExpectedCanaryWorkerVersion } = await import(
    "~/lib/canary-release-identity.server"
  );
  if (!verifyExpectedCanaryWorkerVersion(request, env).ok) {
    return canaryConflict("worker_version_mismatch");
  }

  if (!env.DB) {
    return canaryFailure("missing_db");
  }

  const canaryInput = await readCanaryInput(request);
  if (canaryInput.invalid) {
    return canaryFailure("invalid_canary_email_override");
  }

  const canaryEmail = canaryInput.email ?? env.LAUNCH_CANARY_EMAIL?.trim();
  if (!canaryEmail) {
    return canaryFailure("missing_launch_canary_email");
  }

  let user: BillingCanaryUserRow | null;
  try {
    user = await getBillingCanaryUser(env, canaryEmail);
    if (!user) {
      return canaryFailure("missing_canary_user");
    }
  } catch {
    return canaryFailure("billing_canary_failed");
  }

  const {
    dodo0509BrandId,
    dodo0509ProductIds,
    dodo0509UsageBundleProductIds,
    usageBundleCreditCount,
  } = await import("~/lib/dodo-pricing.server");
  const { signDodoWebhookPayload } = await import("~/lib/dodo-billing.server");
  const {
    DODO_WEBHOOK_PROCESSING_LEASE_MS,
    beginDodoWebhookEventProcessing,
    failDodoWebhookEventProcessing,
  } = await import("~/lib/data.server");

  const plan = planForCanary(user.plan);
  if (!plan) {
    return canaryFailure("invalid_canary_plan");
  }
  const planProductId = dodo0509ProductIds(env)[plan].monthly;
  const creditProductId = dodo0509UsageBundleProductIds(env).proof_500;
  if (!planProductId || !creditProductId) {
    return canaryFailure("missing_dodo_product_ids");
  }

  const nowIso = new Date().toISOString();
  const gateRunId = canaryInput.gateRunId ?? normalizeIdempotencySegment(nowIso);
  const runKey = `billing-canary-${normalizeIdempotencySegment(user.id)}-${plan}-monthly-proof-500-${gateRunId}`;
  const planPaymentId = `${runKey}-plan`;
  const creditPaymentId = `${runKey}-proof-500`;
  // Each invocation owns a unique ledger row. The row id is also the fencing
  // token carried by its internal webhooks, so an expired worker can never
  // release or borrow a newer invocation's lease.
  const lockEventId = buildBillingCanaryLockId(user.id, crypto.randomUUID());
  const lockStartedAt = Date.now();
  const maxRuntimeMs = Math.min(
    BILLING_CANARY_MAX_RUNTIME_MS,
    DODO_WEBHOOK_PROCESSING_LEASE_MS - 30_000,
  );
  let durationExceeded = false;
  let lockClaimed = false;
  let lockSafeToRelease = true;
  let lockReleaseFailed = false;
  let response: Response | null = null;

  const assertCanaryWithinRuntime = () => {
    if (Date.now() - lockStartedAt >= maxRuntimeMs) {
      durationExceeded = true;
      throw new Error("billing_canary_duration_exceeded");
    }
  };

  const runLockedCanary = async () => {
    if (!(await recoverPreviousBillingCanaryRuns(env, user.id, lockEventId))) {
      return canaryFailure("billing_canary_recovery_failed");
    }
    const userPlanSnapshot = await getUserPlanSnapshot(env, user.id);
    const watchlistStateSnapshot = await getWatchlistStateSnapshot(env, user.id);

    if (
      !userPlanSnapshot ||
      userPlanSnapshot.plan !== plan ||
      !["active", "succeeded", "payment.succeeded"].includes(userPlanSnapshot.dodo_status ?? "") ||
      userPlanSnapshot.dodo_plan_change_product_id !== null
    ) {
      return canaryFailure("billing_canary_account_not_stable");
    }

    const lockMetadata = {
      action: "billing_canary_active",
      userId: user.id,
      userPlanSnapshot,
      watchlistStateSnapshot,
      planPaymentId,
      creditPaymentId,
      canaryPlan: plan,
      canaryProductId: planProductId,
      canaryPlanUpdatedAt: nowIso,
      startedAt: new Date().toISOString(),
    };
    const lockMetadataResult = await env.DB!.prepare(`
        UPDATE dodo_webhook_event
        SET metadata_json = ?
        WHERE event_id = ?
          AND event_type = 'billing.canary.lock'
          AND user_id = ?
          AND outcome = 'processing'
      `).bind(JSON.stringify(lockMetadata), lockEventId, user.id).run();
    if (Number(lockMetadataResult.meta?.changes ?? 0) !== 1) {
      return canaryFailure("billing_canary_lock_metadata_failed");
    }
    lockSafeToRelease = false;

    const brandId = dodo0509BrandId(env) || undefined;
    const creditCount = usageBundleCreditCount("proof_500");
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
        billing_canary_lock_id: lockEventId,
        expected_plan_snapshot_json: JSON.stringify(userPlanSnapshot),
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
        billing_canary_lock_id: lockEventId,
      },
      product_cart: [
        {
          product_id: creditProductId,
          quantity: 1,
        },
      ],
    };

    let planWebhook: WebhookResult | null = null;
    let creditWebhook: WebhookResult | null = null;
    let planGrant: PlanGrantRow | null = null;
    let creditGrant: CreditGrantRow | null = null;
    let paidPlanUnlocked = false;
    let proofCreditsGranted = false;
    let planCleanupOk = false;
    let watchlistCleanupOk = false;
    let creditCleanupOk = false;
    let mutationFailed = false;
    let postCanaryWatchlists: WatchlistStateSnapshot[] | null = null;
    const mutationStarted = true;

    try {
      assertCanaryWithinRuntime();
      const webhookResults = await Promise.allSettled([
        postSignedWebhook({
          env,
          context,
          request,
          webhookId: `${runKey}-plan-webhook`,
          payload: planPayload,
          lockEventId,
          signDodoWebhookPayload,
        }),
        postSignedWebhook({
          env,
          context,
          request,
          webhookId: `${runKey}-credit-webhook`,
          payload: creditPayload,
          lockEventId,
          signDodoWebhookPayload,
        }),
      ]);
      assertCanaryWithinRuntime();
      planWebhook = settledWebhookResult(webhookResults[0]);
      creditWebhook = settledWebhookResult(webhookResults[1]);
      mutationFailed = webhookResults.some((result) => result.status === "rejected");

      const grantResults = await Promise.allSettled([
        getPlanGrant(env, user.id, planPaymentId),
        getCreditGrant(env, user.id, creditPaymentId),
      ]);
      if (grantResults[0].status === "fulfilled") {
        planGrant = grantResults[0].value;
      } else {
        mutationFailed = true;
      }
      if (grantResults[1].status === "fulfilled") {
        creditGrant = grantResults[1].value;
      } else {
        mutationFailed = true;
      }

      paidPlanUnlocked = planWebhook?.ok === true && planGrant?.plan === plan;
      proofCreditsGranted =
        creditWebhook?.ok === true &&
        creditGrant?.provider_payment_id === creditPaymentId &&
        Number(creditGrant.quantity_granted) === creditCount &&
        isCurrentActiveTopUpGrant(creditGrant);
      postCanaryWatchlists = await getWatchlistStateSnapshot(env, user.id);
    } catch {
      mutationFailed = true;
    } finally {
      if (mutationStarted) {
        try {
          postCanaryWatchlists ??= await getWatchlistStateSnapshot(env, user.id);
          const [planCleanup, creditCleanup] = await Promise.all([
            cleanupCanaryPlanGrant(
              env,
              user.id,
              planPaymentId,
              plan,
              planProductId,
              nowIso,
              planWebhook?.watchlistUpdatedAt ?? nowIso,
              userPlanSnapshot,
              watchlistStateSnapshot,
              postCanaryWatchlists,
            ),
            cleanupCanaryCreditGrant(env, user.id, creditPaymentId),
          ]);
          planCleanupOk = planCleanup.planCleanupOk;
          watchlistCleanupOk = planCleanup.watchlistCleanupOk;
          creditCleanupOk = creditCleanup;
        } catch {
          mutationFailed = true;
        }
      }
    }
    lockSafeToRelease = planCleanupOk && watchlistCleanupOk && creditCleanupOk;
    const ok =
      !mutationFailed &&
      paidPlanUnlocked &&
      proofCreditsGranted &&
      planCleanupOk &&
      watchlistCleanupOk &&
      creditCleanupOk;
    const cleanupConflict = !planCleanupOk || !watchlistCleanupOk;

    return Response.json(
      {
        ok,
        gateRunId,
        workerVersionId: env.CF_VERSION_METADATA?.id ?? null,
        ...(!ok
          ? {
              blocker: durationExceeded
                ? "billing_canary_duration_exceeded"
                : mutationFailed
                  ? "billing_canary_failed"
                  : cleanupConflict
                    ? "billing_canary_concurrent_update"
                    : "billing_canary_failed",
            }
          : {}),
        user: {
          plan,
        },
        webhook: {
          plan: planWebhook,
          proofCredits: creditWebhook,
        },
        grants: {
          paidPlanUnlocked,
          planCleanupOk,
          watchlistCleanupOk,
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
  };

  try {
    const claim = await beginDodoWebhookEventProcessing(env, {
      eventId: lockEventId,
      eventType: "billing.canary.lock",
      userId: user.id,
      payloadTimestamp: null,
      billingCanaryGuard: "acquire_lock",
    });
    if (claim.status !== "claimed") {
      response = canaryConflict(
        claim.status === "in_progress"
          ? "billing_canary_in_progress"
          : "billing_canary_lock_unavailable",
      );
    } else {
      lockClaimed = true;
      response = await runLockedCanary();
    }
  } catch {
    response = canaryFailure(
      durationExceeded ? "billing_canary_duration_exceeded" : "billing_canary_failed",
    );
  } finally {
    if (lockClaimed && lockSafeToRelease) {
      try {
        await failDodoWebhookEventProcessing(env, lockEventId, {
          action: "billing_canary_lock_released",
          userId: user.id,
        });
        const released = await env.DB.prepare(`
            SELECT outcome, processing_started_at
            FROM dodo_webhook_event
            WHERE event_id = ?
            LIMIT 1
          `).bind(lockEventId).all<{ outcome: string; processing_started_at: string | null }>();
        const lockRow = released.results?.[0];
        lockReleaseFailed = lockRow?.outcome !== "failed" || lockRow.processing_started_at !== null;
      } catch {
        lockReleaseFailed = true;
      }
    }
  }

  if (lockReleaseFailed) {
    return canaryFailure("billing_canary_lock_release_failed");
  }
  return response ?? canaryFailure("billing_canary_failed");
}

interface WebhookResult {
  ok: boolean;
  status: number;
  watchlistUpdatedAt?: string;
}

function settledWebhookResult(
  result: PromiseSettledResult<WebhookResult>,
): WebhookResult {
  return result.status === "fulfilled" ? result.value : { ok: false, status: 500 };
}

async function postSignedWebhook({
  env,
  context,
  request,
  webhookId,
  lockEventId,
  payload,
  signDodoWebhookPayload,
}: {
  env: AppEnv;
  context: ActionFunctionArgs["context"];
  request: Request;
  webhookId: string;
  lockEventId: string;
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
      "x-0509-billing-canary-lock-id": lockEventId,
    },
    body: rawBody,
  });
  const { action: webhookAction } = await import("~/routes/api.webhooks.dodo");
  const response = await webhookAction({
    context,
    request: webhookRequest,
    params: {},
  } as never);
  const responseBody = await response.clone().json().catch(() => null) as unknown;
  const watchlistUpdatedAt =
    responseBody && typeof responseBody === "object" && !Array.isArray(responseBody) &&
    typeof (responseBody as Record<string, unknown>).watchlistUpdatedAt === "string"
      ? (responseBody as Record<string, string>).watchlistUpdatedAt
      : undefined;

  return {
    ok: response.ok,
    status: response.status,
    ...(watchlistUpdatedAt ? { watchlistUpdatedAt } : {}),
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
        dodo_plan_change_product_id,
        dodo_status,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_next_billing_at,
        evidence_entitlement_anchor,
        evidence_entitlement_anchor_source
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

function parseBillingCanaryRecoveryMetadata(
  value: string,
  userId: string,
): BillingCanaryRecoveryMetadata | null {
  try {
    const parsed = JSON.parse(value) as Partial<BillingCanaryRecoveryMetadata>;
    const snapshot = parsed.userPlanSnapshot;
    const watchlists = parsed.watchlistStateSnapshot;
    if (
      parsed.action !== "billing_canary_active" ||
      parsed.userId !== userId ||
      !snapshot ||
      snapshot.user_id !== userId ||
      typeof snapshot.plan !== "string" ||
      typeof snapshot.plan_updated_at !== "string" ||
      !Array.isArray(watchlists) ||
      watchlists.some((row) =>
        !row ||
        typeof row.id !== "string" ||
        typeof row.is_active !== "number" ||
        typeof row.updated_at !== "string"
      ) ||
      typeof parsed.planPaymentId !== "string" ||
      typeof parsed.creditPaymentId !== "string" ||
      !planForCanary(parsed.canaryPlan ?? null) ||
      typeof parsed.canaryProductId !== "string" ||
      typeof parsed.canaryPlanUpdatedAt !== "string"
    ) {
      return null;
    }
    return parsed as BillingCanaryRecoveryMetadata;
  } catch {
    return null;
  }
}

async function recoverPreviousBillingCanaryRuns(
  env: AppEnv,
  userId: string,
  currentLockEventId: string,
) {
  if (!env.DB) return false;
  const recoveryNow = new Date().toISOString();
  const result = await env.DB.prepare(`
      SELECT event_id, metadata_json
      FROM dodo_webhook_event
      WHERE user_id = ?
        AND event_type = 'billing.canary.lock'
        AND event_id <> ?
        AND json_extract(metadata_json, '$.action') = 'billing_canary_active'
        AND (
          outcome = 'failed'
          OR processing_started_at IS NULL
          OR julianday(?) > julianday(processing_started_at) + ?
        )
      ORDER BY received_at ASC
      LIMIT 20
    `).bind(
      userId,
      currentLockEventId,
      recoveryNow,
      BILLING_CANARY_RECOVERY_STALE_DAYS,
    ).all<RecoverableBillingCanaryRow>();

  for (const row of result.results ?? []) {
    const metadata = parseBillingCanaryRecoveryMetadata(row.metadata_json, userId);
    if (!metadata) return false;
    const postCanaryWatchlists = await getWatchlistStateSnapshot(env, userId);
    const [planCleanup, creditCleanupOk] = await Promise.all([
      cleanupCanaryPlanGrant(
        env,
        userId,
        metadata.planPaymentId,
        metadata.canaryPlan,
        metadata.canaryProductId,
        metadata.canaryPlanUpdatedAt,
        metadata.canaryPlanUpdatedAt,
        metadata.userPlanSnapshot,
        metadata.watchlistStateSnapshot,
        postCanaryWatchlists,
      ),
      cleanupCanaryCreditGrant(env, userId, metadata.creditPaymentId),
    ]);
    if (!planCleanup.planCleanupOk || !planCleanup.watchlistCleanupOk || !creditCleanupOk) {
      return false;
    }
    const recovered = await env.DB.prepare(`
        UPDATE dodo_webhook_event
        SET outcome = 'failed',
            processing_started_at = NULL,
            processed_at = NULL,
            metadata_json = ?
        WHERE event_id = ?
          AND user_id = ?
          AND event_type = 'billing.canary.lock'
          AND json_extract(metadata_json, '$.action') = 'billing_canary_active'
          AND (
            outcome = 'failed'
            OR processing_started_at IS NULL
            OR julianday(?) > julianday(processing_started_at) + ?
          )
      `).bind(
        JSON.stringify({ action: "billing_canary_recovered", recoveredAt: recoveryNow }),
        row.event_id,
        userId,
        recoveryNow,
        BILLING_CANARY_RECOVERY_STALE_DAYS,
      ).run();
    if (Number(recovered.meta?.changes ?? 0) !== 1) return false;
  }
  return true;
}

async function cleanupCanaryPlanGrant(
  env: AppEnv,
  userId: string,
  providerPaymentId: string,
  canaryPlan: PricingPlanSlug,
  canaryProductId: string,
  canaryPlanUpdatedAt: string,
  canaryWatchlistUpdatedAt: string | null,
  snapshot: UserPlanSnapshot,
  watchlists: WatchlistStateSnapshot[],
  postCanaryWatchlists: WatchlistStateSnapshot[],
) {
  if (!env.DB) return { planCleanupOk: false, watchlistCleanupOk: false };

  const expectedWatchlists = new Map(postCanaryWatchlists.map((watchlist) => [watchlist.id, watchlist]));
  if (!canaryWatchlistUpdatedAt) {
    return { planCleanupOk: false, watchlistCleanupOk: false };
  }
  const changedWatchlists = watchlists.flatMap((watchlist) => {
    const expected = expectedWatchlists.get(watchlist.id);
    return expected?.updated_at === canaryWatchlistUpdatedAt ? [{ snapshot: watchlist, expected }] : [];
  });
  const exactPostCanarySql = `
    user_id = ?
    AND plan IS ?
    AND plan_updated_at IS ?
    AND dodo_payment_id IS ?
    AND dodo_product_id IS ?
    AND dodo_plan_change_product_id IS ?
    AND dodo_status IS 'payment.succeeded'
    AND dodo_subscription_id IS ?
    AND dodo_customer_id IS ?
    AND dodo_next_billing_at IS ?
    AND evidence_entitlement_anchor IS ?
    AND evidence_entitlement_anchor_source IS ?
  `;
  const exactPostCanaryBindings = [
    userId,
    canaryPlan,
    canaryPlanUpdatedAt,
    providerPaymentId,
    canaryProductId,
    snapshot.dodo_plan_change_product_id,
    snapshot.dodo_subscription_id,
    snapshot.dodo_customer_id,
    snapshot.dodo_next_billing_at,
    snapshot.evidence_entitlement_anchor,
    snapshot.evidence_entitlement_anchor_source,
  ];
  const statements = changedWatchlists.map(({ snapshot: watchlist, expected }) =>
    env.DB!.prepare(`
      UPDATE watchlist
      SET is_active = ?,
          paused_reason = ?,
          updated_at = ?
      WHERE user_id = ?
        AND id = ?
        AND is_active = ?
        AND paused_reason IS ?
        AND updated_at = ?
    `).bind(
      watchlist.is_active,
      watchlist.paused_reason,
      watchlist.updated_at,
      userId,
      watchlist.id,
      expected.is_active,
      expected.paused_reason,
      expected.updated_at,
    ),
  );
  statements.push(
    env.DB.prepare(`
        UPDATE user_plan
        SET plan = ?,
            plan_updated_at = ?,
            dodo_payment_id = ?,
            dodo_product_id = ?,
            dodo_plan_change_product_id = ?,
            dodo_status = ?,
            dodo_subscription_id = ?,
            dodo_customer_id = ?,
            dodo_next_billing_at = ?,
            evidence_entitlement_anchor = ?,
            evidence_entitlement_anchor_source = ?
        WHERE ${exactPostCanarySql}
      `).bind(
        snapshot.plan,
        snapshot.plan_updated_at,
        snapshot.dodo_payment_id,
        snapshot.dodo_product_id,
        snapshot.dodo_plan_change_product_id,
        snapshot.dodo_status,
        snapshot.dodo_subscription_id,
        snapshot.dodo_customer_id,
        snapshot.dodo_next_billing_at,
        snapshot.evidence_entitlement_anchor,
        snapshot.evidence_entitlement_anchor_source,
        ...exactPostCanaryBindings,
      ),
  );

  let mutationResults: D1Result<unknown>[];
  try {
    mutationResults = await env.DB.batch(statements);
  } catch {
    return { planCleanupOk: false, watchlistCleanupOk: false };
  }
  const planMutationChanged = Number(mutationResults.at(-1)?.meta?.changes ?? 0) === 1;
  const watchlistMutationsChanged = mutationResults
    .slice(0, changedWatchlists.length)
    .every((result) => Number(result?.meta?.changes ?? 0) === 1);
  if (!planMutationChanged) {
    try {
      await env.DB.prepare(`
          UPDATE user_plan
          SET dodo_payment_id = CASE
                WHEN dodo_payment_id IS ? THEN ?
                ELSE dodo_payment_id
              END,
              dodo_product_id = CASE
                WHEN dodo_payment_id IS ? AND dodo_product_id IS ? THEN ?
                ELSE dodo_product_id
              END,
              dodo_status = CASE
                WHEN dodo_payment_id IS ?
                  AND plan_updated_at IS ?
                  AND dodo_status IS 'payment.succeeded'
                THEN ? ELSE dodo_status
              END,
              plan_updated_at = CASE
                WHEN dodo_payment_id IS ? AND plan_updated_at IS ?
                THEN ? ELSE plan_updated_at
              END
          WHERE user_id = ?
        `).bind(
          providerPaymentId,
          snapshot.dodo_payment_id,
          providerPaymentId,
          canaryProductId,
          snapshot.dodo_product_id,
          providerPaymentId,
          canaryPlanUpdatedAt,
          snapshot.dodo_status,
          providerPaymentId,
          canaryPlanUpdatedAt,
          snapshot.plan_updated_at,
          userId,
        ).run();
    } catch {
      return { planCleanupOk: false, watchlistCleanupOk: false };
    }
  }

  let planCleanupOk = false;
  try {
    const [syntheticGrant, restoredSnapshot] = await Promise.all([
      getPlanGrant(env, userId, providerPaymentId),
      getUserPlanSnapshot(env, userId),
    ]);
    planCleanupOk =
      !syntheticGrant &&
      (
        userPlanSnapshotsEqual(restoredSnapshot, snapshot) ||
        (restoredSnapshot !== null && restoredSnapshot.plan_updated_at !== canaryPlanUpdatedAt)
      );
  } catch {
    planCleanupOk = false;
  }

  let watchlistCleanupOk = false;
  try {
    const restored = await getWatchlistStateSnapshot(env, userId);
    watchlistCleanupOk = watchlistMutationsChanged && watchlistSnapshotsEqual(restored, watchlists);
    if (watchlistCleanupOk && changedWatchlists.length > 0) {
      const { syncWebMentionTargetsForUser } = await import(
        "~/lib/data/watchlist-web-mentions.server"
      );
      await syncWebMentionTargetsForUser(env, userId, new Date().toISOString());
    }
  } catch {
    watchlistCleanupOk = false;
  }
  return { planCleanupOk, watchlistCleanupOk };
}

function userPlanSnapshotsEqual(
  actual: UserPlanSnapshot | null,
  expected: UserPlanSnapshot | null,
) {
  if (!actual || !expected) {
    return actual === expected;
  }

  return (
    actual.user_id === expected.user_id &&
    actual.plan === expected.plan &&
    actual.plan_updated_at === expected.plan_updated_at &&
    actual.dodo_payment_id === expected.dodo_payment_id &&
    actual.dodo_product_id === expected.dodo_product_id &&
    actual.dodo_plan_change_product_id === expected.dodo_plan_change_product_id &&
    actual.dodo_status === expected.dodo_status &&
    actual.dodo_subscription_id === expected.dodo_subscription_id &&
    actual.dodo_customer_id === expected.dodo_customer_id &&
    actual.dodo_next_billing_at === expected.dodo_next_billing_at &&
    actual.evidence_entitlement_anchor === expected.evidence_entitlement_anchor &&
    actual.evidence_entitlement_anchor_source === expected.evidence_entitlement_anchor_source
  );
}

function watchlistSnapshotsEqual(
  actual: WatchlistStateSnapshot[],
  expected: WatchlistStateSnapshot[],
) {
  if (actual.length !== expected.length) {
    return false;
  }

  const sortById = (left: WatchlistStateSnapshot, right: WatchlistStateSnapshot) =>
    left.id.localeCompare(right.id);
  const actualSorted = [...actual].sort(sortById);
  const expectedSorted = [...expected].sort(sortById);
  return actualSorted.every((row, index) => {
    const expectedRow = expectedSorted[index];
    return (
      row.id === expectedRow.id &&
      row.is_active === expectedRow.is_active &&
      row.paused_reason === expectedRow.paused_reason &&
      row.updated_at === expectedRow.updated_at
    );
  });
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

function planForCanary(value: string | null): PricingPlanSlug | null {
  if (value === "agency" || value === "starter" || value === "scout") {
    return value;
  }

  return null;
}

async function readCanaryInput(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return { email: null, gateRunId: null, invalid: false };
  }

  const payload = await request.clone().json().catch(() => null);
  const value = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const email =
    value
      ? String(value.email ?? "").trim().toLowerCase()
      : "";
  const rawGateRunId = value ? String(value.gateRunId ?? "").trim() : "";
  const gateRunId = rawGateRunId ? normalizeIdempotencySegment(rawGateRunId) : null;
  const invalid = Boolean(
    (email && !email.endsWith("@example.com")) ||
    (rawGateRunId && (!/^[A-Za-z0-9._-]{1,128}$/u.test(rawGateRunId) || gateRunId !== rawGateRunId.toLowerCase()))
  );
  return { email: email || null, gateRunId, invalid };
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

function canaryConflict(blocker: string) {
  return Response.json(
    {
      ok: false,
      blocker,
    },
    {
      status: 409,
      headers: { "cache-control": "no-store" },
    },
  );
}

function normalizeIdempotencySegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
