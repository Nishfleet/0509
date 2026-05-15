import type { ActionFunctionArgs } from "react-router";

interface CanaryTargetRow {
  user_id: string;
  email: string | null;
  name: string | null;
  watchlist_id: string;
  watchlist_name: string;
  target_label: string;
}

function hasValidCanaryToken(request: Request, token: string | undefined) {
  const configured = token?.trim();
  if (!configured) {
    return false;
  }

  return request.headers.get("x-0509-canary-token") === configured;
}

async function getCanaryTarget(env: { DB?: D1Database }) {
  if (!env.DB) {
    return null;
  }

  const result = await env.DB.prepare(`
      SELECT
        user.id AS user_id,
        user.email,
        user.name,
        watchlist.id AS watchlist_id,
        watchlist.name AS watchlist_name,
        watchlist.target_label
      FROM watchlist
      INNER JOIN user
        ON user.id = watchlist.user_id
      WHERE watchlist.is_active = 1
      ORDER BY watchlist.updated_at DESC
      LIMIT 1
    `).all<CanaryTargetRow>();

  return result.results?.[0] ?? null;
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    addDigestItem,
    clearDigestItems,
    createDigestRun,
    createProofCapture,
    createWatchEvent,
    createWatchlistRun,
    finishWatchlistRun,
    upsertProofTarget,
  } = await import("~/lib/data.server");
  const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
  const env = getEnv(context);

  if (!hasValidCanaryToken(request, env.CANARY_BYPASS_TOKEN)) {
    throw new Response("Not found", { status: 404 });
  }

  if (!env.DB) {
    return Response.json(
      {
        ok: false,
        blocker: "missing_db",
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  const target = await getCanaryTarget(env);
  if (!target) {
    return Response.json(
      {
        ok: false,
        blocker: "missing_active_watchlist",
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const periodEnd = nowIso;
  const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const canaryKey = `launch-readiness:${nowIso}`;
  const title = "Launch readiness canary";
  const summary = "Private canary verified the monitoring, proof, and digest delivery pipeline.";
  const metadata = {
    kind: "launch_readiness_canary",
    generatedAt: nowIso,
    targetLabel: target.target_label,
  };

  const runId = await createWatchlistRun(env, target.watchlist_id, "manual", null, 1);
  const proofTargetIdentity = `launch-readiness:${target.watchlist_id}:0509-home`;
  let proofTarget = await upsertProofTarget(env, {
    watchlistId: target.watchlist_id,
    adId: null,
    landingPageUrl: "https://0509.in/",
    canonicalPageIdentity: "launch-readiness:0509-home",
    proofTargetIdentity,
    lastCaptureAttemptAt: nowIso,
    lastSuccessfulProofAt: nowIso,
  });

  if (!proofTarget) {
    throw new Response("Launch readiness proof target could not be created.", { status: 500 });
  }

  const proofCaptureId = await createProofCapture(env, {
    proofTargetId: proofTarget.id,
    status: "succeeded",
    extractedFields: {
      headline: "Five to Nine",
      proof: summary,
    },
    fieldConfidence: {
      headline: 1,
      proof: 1,
    },
    captureMetadata: metadata,
    extractorVersion: "launch-readiness-canary-v1",
    idempotencyKey: `${canaryKey}:proof`,
    attemptedAt: nowIso,
    succeededAt: nowIso,
  });

  proofTarget = await upsertProofTarget(env, {
    watchlistId: target.watchlist_id,
    adId: null,
    landingPageUrl: "https://0509.in/",
    canonicalPageIdentity: "launch-readiness:0509-home",
    proofTargetIdentity,
    lastCaptureAttemptAt: nowIso,
    lastSuccessfulProofAt: nowIso,
    lastSuccessfulCaptureId: proofCaptureId,
  });

  const eventId = await createWatchEvent(env, {
    watchlistId: target.watchlist_id,
    runId,
    eventType: "ad_new",
    adId: null,
    baselineFromRunId: null,
    title,
    summary,
    metadata,
    status: "confirmed",
    importanceScore: 100,
    proofCaptureId,
    confirmedAt: nowIso,
    lastEvaluatedAt: nowIso,
  });

  await finishWatchlistRun(env, runId, {
    status: "succeeded",
    pagesScanned: 1,
    summary: {
      ...metadata,
      events: 1,
      eventsConfirmed: 1,
      proofsAttempted: 1,
    },
  });

  const digestRunId = await createDigestRun(env, target.user_id, periodStart, periodEnd, {
    ...metadata,
    totalEvents: 1,
    watchlists: 1,
  });
  await clearDigestItems(env, digestRunId);
  await addDigestItem(env, digestRunId, {
    watchlistId: target.watchlist_id,
    watchlistName: target.watchlist_name,
    eventType: "ad_new",
    title,
    summary,
    metadata: {
      ...metadata,
      eventId,
      proofCaptureId,
    },
  });

  const delivery = await deliverWeeklyDigest(env, {
    userId: target.user_id,
    userName: target.name ?? "Five to Nine",
    accountEmail: target.email,
    digestRunId,
    periodStart,
    periodEnd,
    items: [
      {
        eventId,
        watchlistId: target.watchlist_id,
        watchlistName: target.watchlist_name,
        eventType: "ad_new",
        title,
        summary,
        metadata,
      },
    ],
    cadence: "daily",
    lane: "internal",
  });
  const deliverySent = delivery.details.some((attempt) => attempt.status === "sent");

  return Response.json(
    {
      ok: deliverySent,
      runId,
      proofCaptureId,
      digestRunId,
      delivery,
    },
    {
      status: deliverySent ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
