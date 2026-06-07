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

async function getCanaryTarget(env: { DB?: D1Database }, canaryEmail: string) {
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
        AND lower(user.email) = lower(?)
      ORDER BY watchlist.updated_at DESC
      LIMIT 1
    `).bind(canaryEmail).all<CanaryTargetRow>();

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
  const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
  const {
    buildCanonicalPageIdentity,
    buildProofTargetIdentity,
  } = await import("~/lib/proof-policy.server");
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

  const canaryEmail = env.LAUNCH_CANARY_EMAIL?.trim();
  if (!canaryEmail) {
    return Response.json(
      {
        ok: false,
        blocker: "missing_launch_canary_email",
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  const target = await getCanaryTarget(env, canaryEmail);
  if (!target) {
    return Response.json(
      {
        ok: false,
        blocker: "missing_active_watchlist",
        canaryEmail,
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
  const proofUrl = "https://0509.in/";
  const requestUrl = new URL(request.url);
  const requestedProofProvider = requestUrl.searchParams.get("proofProvider") === "browserless"
    ? "browserless"
    : null;
  const requireSlackDelivery = readBooleanSearchParam(requestUrl, "requireSlack");
  const requireWhatsAppDelivery = readBooleanSearchParam(requestUrl, "requireWhatsApp");
  const metadata = {
    kind: "launch_readiness_canary",
    generatedAt: nowIso,
    targetLabel: target.target_label,
    requestedProofProvider,
    requireSlackDelivery,
    requireWhatsAppDelivery,
  };

  const runId = await createWatchlistRun(env, target.watchlist_id, "manual", null, 1);
  const snapshot =
    requestedProofProvider === "browserless"
      ? await (await import("~/lib/browser-run.server")).captureBrowserlessProofSnapshot(env, proofUrl)
      : await captureLandingPageSnapshot(env, proofUrl);

  if (!snapshot) {
    const blocker =
      requestedProofProvider === "browserless"
        ? "browserless_proof_capture_failed"
        : "proof_capture_failed";
    await finishWatchlistRun(env, runId, {
      status: "failed",
      pagesScanned: 0,
      summary: {
        ...metadata,
        blocker,
        proofUrl,
      },
    });

    return Response.json(
      {
        ok: false,
        blocker,
        runId,
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  const canonicalPageIdentity =
    buildCanonicalPageIdentity(snapshot.canonicalUrl) ?? buildCanonicalPageIdentity(proofUrl) ?? "0509.in/";
  const proofTargetIdentity = buildProofTargetIdentity({
    watchlistId: target.watchlist_id,
    adId: null,
    canonicalPageIdentity,
  });
  let proofTarget = await upsertProofTarget(env, {
    watchlistId: target.watchlist_id,
    adId: null,
    landingPageUrl: snapshot.canonicalUrl,
    canonicalPageIdentity,
    proofTargetIdentity,
    lastCaptureAttemptAt: snapshot.capturedAt,
    lastSuccessfulProofAt: snapshot.capturedAt,
  });

  if (!proofTarget) {
    throw new Response("Launch readiness proof target could not be created.", { status: 500 });
  }

  const proofCaptureId = await createProofCapture(env, {
    proofTargetId: proofTarget.id,
    status: "succeeded",
    screenshotArtifactKey: readSnapshotString(snapshot.metadata, "screenshotArtifactKey"),
    htmlArtifactKey:
      readSnapshotString(snapshot.metadata, "htmlArtifactKey") ?? snapshot.artifactKey ?? null,
    extractedFields: snapshotToExtractedFields(snapshot),
    fieldConfidence: readSnapshotConfidence(snapshot),
    extractionWarnings: readSnapshotWarnings(snapshot),
    captureMetadata: {
      ...snapshot.metadata,
      ...metadata,
      kind: "launch_readiness_real_capture",
      proofUrl,
      canonicalUrl: snapshot.canonicalUrl,
      captureMethod: snapshot.captureMethod,
    },
    renderMode: readSnapshotRenderMode(snapshot),
    deviceProfile: readSnapshotDeviceProfile(snapshot),
    extractorVersion: readSnapshotString(snapshot.metadata, "extractorVersion") ?? "launch-readiness-canary-v2",
    idempotencyKey: `${canaryKey}:proof`,
    attemptedAt: snapshot.capturedAt,
    succeededAt: snapshot.capturedAt,
  });

  proofTarget = await upsertProofTarget(env, {
    watchlistId: target.watchlist_id,
    adId: null,
    landingPageUrl: snapshot.canonicalUrl,
    canonicalPageIdentity,
    proofTargetIdentity,
    lastCaptureAttemptAt: snapshot.capturedAt,
    lastSuccessfulProofAt: snapshot.capturedAt,
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
      proofUrl,
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
    lane: requireWhatsAppDelivery ? "customer" : "internal",
  });
  const deliverySent = delivery.details.some((attempt) => attempt.status === "sent");
  const slackDeliverySent = delivery.details.some(
    (attempt) => attempt.channel === "slack" && attempt.status === "sent",
  );
  const whatsappDeliverySent = delivery.details.some(
    (attempt) => attempt.channel === "whatsapp" && attempt.status === "sent",
  );
  const deliveryBlockers = [
    deliverySent ? null : "no_digest_delivery_sent",
    requireSlackDelivery && !slackDeliverySent ? "no_slack_digest_sent" : null,
    requireWhatsAppDelivery && !whatsappDeliverySent ? "no_whatsapp_digest_sent" : null,
  ].filter((value): value is string => Boolean(value));

  return Response.json(
    {
      ok: deliveryBlockers.length === 0,
      blockers: deliveryBlockers,
      runId,
      proofCaptureId,
      digestRunId,
      delivery,
      slackDelivery: {
        required: requireSlackDelivery,
        sent: slackDeliverySent,
      },
      whatsappDelivery: {
        required: requireWhatsAppDelivery,
        sent: whatsappDeliverySent,
        lane: requireWhatsAppDelivery ? "customer" : "internal",
      },
      proof: {
        capturedAt: snapshot.capturedAt,
        canonicalUrl: snapshot.canonicalUrl,
        captureMethod: snapshot.captureMethod,
        renderProvider: readSnapshotString(snapshot.metadata, "renderProvider"),
      },
    },
    {
      status: deliveryBlockers.length === 0 ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

function readBooleanSearchParam(url: URL, key: string) {
  return ["1", "true"].includes(url.searchParams.get(key)?.toLowerCase() ?? "");
}

function snapshotToExtractedFields(snapshot: {
  rawHeadline: string;
  normalizedHeadline: string;
  normalizedHeadlineHash: string;
  ctaText?: string | null;
  priceText?: string | null;
  formPresent?: boolean | null;
  canonicalUrl: string;
}) {
  return {
    rawHeadline: snapshot.rawHeadline,
    normalizedHeadline: snapshot.normalizedHeadline,
    normalizedHeadlineHash: snapshot.normalizedHeadlineHash,
    ctaText: snapshot.ctaText ?? null,
    priceText: snapshot.priceText ?? null,
    formPresent: snapshot.formPresent ?? null,
    canonicalUrl: snapshot.canonicalUrl,
  };
}

function readSnapshotString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readSnapshotConfidence(snapshot: { metadata?: Record<string, unknown> }) {
  const confidence = snapshot.metadata?.extractedFieldConfidence;
  if (!confidence || typeof confidence !== "object" || Array.isArray(confidence)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(confidence).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

function readSnapshotWarnings(snapshot: { metadata?: Record<string, unknown> }) {
  const warnings = snapshot.metadata?.extractionWarnings;
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings.filter((warning): warning is string => typeof warning === "string");
}

function readSnapshotRenderMode(snapshot: { metadata?: Record<string, unknown> }) {
  return readSnapshotString(snapshot.metadata, "renderMode") === "desktop" ? "desktop" : "mobile";
}

function readSnapshotDeviceProfile(snapshot: { metadata?: Record<string, unknown> }) {
  return readSnapshotString(snapshot.metadata, "deviceProfile") === "desktop_default"
    ? "desktop_default"
    : "mobile_default";
}
