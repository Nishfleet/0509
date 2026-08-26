import type { ActionFunctionArgs } from "react-router";

const CLEANUP_OPERATION_HEADER = "x-0509-canary-operation";
const CLEANUP_BODY_MAX_BYTES = 4_096;
const CLEANUP_TRUTH =
  "Cleanup removes verified canary-owned R2 artifacts and reconciles their D1 references before removing watchlist, digest, and delivery rows; the proof capture and proof target remain as owner-scoped audit evidence with null artifact keys.";

interface CanaryTargetRow {
  user_id: string;
  email: string | null;
  name: string | null;
  watchlist_id: string;
  watchlist_name: string;
  target_label: string;
}

interface CanaryOwnerRow {
  user_id: string;
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

async function getCanaryOwner(env: { DB?: D1Database }, canaryEmail: string) {
  if (!env.DB) {
    return null;
  }

  const result = await env.DB.prepare(`
      SELECT id AS user_id
      FROM user
      WHERE lower(email) = lower(?)
      LIMIT 1
    `).bind(canaryEmail).all<CanaryOwnerRow>();

  return result.results?.[0]?.user_id ?? null;
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
      { ok: false, blocker: "canary_requires_post" },
      {
        status: 405,
        headers: {
          allow: "POST",
          "cache-control": "no-store",
        },
      },
    );
  }

  const isCleanupRequest = request.headers.get(CLEANUP_OPERATION_HEADER) === "cleanup";
  const { verifyExpectedCanaryWorkerVersion } = await import(
    "~/lib/canary-release-identity.server"
  );
  if (!verifyExpectedCanaryWorkerVersion(request, env).ok) {
    return Response.json(
      { ok: false, blocker: "worker_version_mismatch" },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
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

  const cleanupOperation = request.headers.get(CLEANUP_OPERATION_HEADER);
  if (cleanupOperation !== null && cleanupOperation !== "cleanup") {
    return cleanupErrorResponse("invalid_cleanup_operation", 400);
  }

  const gateRunId = cleanupOperation === "cleanup" ? null : await readGateRunId(request);
  if (gateRunId === false) {
    return Response.json(
      { ok: false, blocker: "invalid_gate_run_id" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const requestUrl = new URL(request.url);
  const requestedProofProviderParam = requestUrl.searchParams.get("proofProvider");
  if (requestedProofProviderParam !== null && requestedProofProviderParam !== "browserless") {
    return Response.json(
      { ok: false, blocker: "unsupported_proof_provider" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  let target: CanaryTargetRow | null = null;
  let canaryOwnerUserId: string | null = null;
  if (cleanupOperation === "cleanup") {
    try {
      canaryOwnerUserId = await getCanaryOwner(env, canaryEmail);
    } catch {
      return cleanupErrorResponse("cleanup_owner_lookup_failed", 500);
    }
    if (!canaryOwnerUserId) {
      return cleanupErrorResponse("missing_launch_canary_user", 503);
    }
  } else {
    target = await getCanaryTarget(env, canaryEmail);
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
  }

  if (cleanupOperation === "cleanup") {
    const requestUrl = new URL(request.url);
    if (["runId", "digestRunId", "proofCaptureId"].some((key) => requestUrl.searchParams.has(key))) {
      return cleanupErrorResponse("cleanup_ids_must_be_in_json_body", 400);
    }

    const cleanupInput = await readCleanupInput(request);
    if (!cleanupInput) {
      return cleanupErrorResponse("invalid_cleanup_request", 400);
    }

    try {
      const { cleanupLaunchReadinessCanary } = await import("~/lib/data.server");
      const result = await cleanupLaunchReadinessCanary(env, {
        ownerUserId: canaryOwnerUserId as string,
        ...cleanupInput,
      });
      if (!result.cleaned) {
        return Response.json(
          {
            ok: false,
            mode: "cleanup",
            workerVersionId: env.CF_VERSION_METADATA?.id ?? null,
            blocker: result.reason ?? "cleanup_not_completed",
            cleanup: result,
            cleanupTruth: CLEANUP_TRUTH,
          },
          {
            status: 409,
            headers: { "cache-control": "no-store" },
          },
        );
      }

      return Response.json(
        {
          ok: true,
          mode: "cleanup",
          workerVersionId: env.CF_VERSION_METADATA?.id ?? null,
          cleanup: result,
          cleanupTruth: CLEANUP_TRUTH,
        },
        {
          status: 200,
          headers: { "cache-control": "no-store" },
        },
      );
    } catch {
      return cleanupErrorResponse("cleanup_failed", 500);
    }
  }

  if (!target) {
    return Response.json(
      { ok: false, blocker: "missing_active_watchlist" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const {
    createDigestRun,
    createProofCapture,
    createWatchEvent,
    createWatchlistRun,
    finishWatchlistRun,
    upsertProofTarget,
  } = await import("~/lib/data.server");
  const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
  const { captureLandingPageSnapshot, snapshotHasScreenshotArtifact } = await import(
    "~/lib/landing-pages.server"
  );
  const { compensateUncommittedProofArtifacts } = await import(
    "~/lib/proof-artifact-retention.server"
  );
  const {
    buildCanonicalPageIdentity,
    buildProofTargetIdentity,
  } = await import("~/lib/proof-policy.server");

  const now = new Date();
  const nowIso = now.toISOString();
  const periodEnd = nowIso;
  const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const canaryKey = `launch-readiness:${gateRunId ?? nowIso}`;
  const title = "Launch readiness canary";
  const summary = "Private canary verified the monitoring, proof, and digest delivery pipeline.";
  const proofUrl = "https://0509.io/";
  const requestedProofProvider = requestedProofProviderParam === "browserless"
    ? "browserless"
    : null;
  const requireSlackDelivery = readBooleanSearchParam(requestUrl, "requireSlack");
  const requireWhatsAppDelivery = readBooleanSearchParam(requestUrl, "requireWhatsApp");
  const gateCProofRequested = gateRunId !== null && !requireWhatsAppDelivery;
  const proofEmailSubject = gateCProofRequested
    ? buildGateCProofEmailSubject(gateRunId)
    : undefined;
  if (gateCProofRequested && !proofEmailSubject) {
    return Response.json(
      {
        ok: false,
        blocker: "gate_run_id_not_unique_in_proof_subject",
        gateRunId,
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const metadata = {
    kind: "launch_readiness_canary",
    gateRunId,
    generatedAt: nowIso,
    targetLabel: target.target_label,
    requestedProofProvider,
    requireSlackDelivery,
    requireWhatsAppDelivery,
  };

  const runId = await createWatchlistRun(env, target.watchlist_id, "manual", null, 1, {
    ...metadata,
    blocker: "launch_readiness_canary_incomplete",
    proofUrl,
  });
  const snapshot =
    requestedProofProvider === "browserless"
      ? await (await import("~/lib/browser-run.server")).captureBrowserlessProofSnapshot(
          env,
          proofUrl,
          { requireScreenshot: true },
        )
      : await captureLandingPageSnapshot(env, proofUrl, {
          preferRendered: true,
          requireScreenshot: true,
        });

  if (!snapshot || !snapshotHasScreenshotArtifact(snapshot)) {
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
    buildCanonicalPageIdentity(snapshot.canonicalUrl) ?? buildCanonicalPageIdentity(proofUrl) ?? "0509.io/";
  const proofTargetIdentity = buildProofTargetIdentity({
    watchlistId: target.watchlist_id,
    adId: null,
    canonicalPageIdentity,
  });
  let proofTarget;
  let proofCaptureId: string;
  let proofCaptureCommitted = false;
  try {
    proofTarget = await upsertProofTarget(env, {
      watchlistId: target.watchlist_id,
      adId: null,
      landingPageUrl: snapshot.canonicalUrl,
      canonicalPageIdentity,
      proofTargetIdentity,
      lastCaptureAttemptAt: snapshot.capturedAt,
    });

    if (!proofTarget) {
      throw new Response("Launch readiness proof target could not be created.", { status: 500 });
    }

    proofCaptureId = await createProofCapture(env, {
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
    proofCaptureCommitted = true;
  } catch (error) {
    if (!proofCaptureCommitted) {
      const compensated = await compensateUncommittedProofArtifacts(env, snapshot);
      if (!compensated.ok) {
        throw new Response("Launch readiness proof cleanup could not be completed.", { status: 500 });
      }
    }
    throw error;
  }

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

  const digestClaim = await createDigestRun(
    env,
    target.user_id,
    periodStart,
    periodEnd,
    {
      ...metadata,
      totalEvents: 1,
      watchlists: 1,
    },
    {
      returnClaim: true,
      items: [{
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
      }],
    },
  );
  if (!digestClaim.created) {
    return Response.json(
      {
        ok: false,
        blockers: ["digest_period_claim_conflict"],
        gateRunId,
        runId,
        proofCaptureId,
      },
      {
        status: 409,
        headers: { "cache-control": "no-store" },
      },
    );
  }
  const digestRunId = digestClaim.digestRunId;

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
    ...(proofEmailSubject ? { proofEmailSubject } : {}),
  });
  const deliveryDetails = delivery.details as Array<CanaryDeliveryDetail>;
  const emailAttempts = deliveryDetails.filter((attempt) => attempt.channel === "email");
  const proofEmail = gateCProofRequested
    ? buildPrivateProofEmail(emailAttempts, gateRunId!, proofEmailSubject!)
    : null;
  const proofEmailBlockers = gateCProofRequested
    ? [
        emailAttempts.length === 1 ? null : "proof_email_not_unique",
        proofEmail?.subject ? null : "proof_email_subject_invalid",
        proofEmail?.dispatchStartedAt ? null : "proof_email_dispatch_timestamp_invalid",
      ].filter((value): value is string => Boolean(value))
    : [];
  const deliverySent = gateCProofRequested
    ? proofEmail?.provider.status === "sent" && proofEmail.subject !== null && proofEmail.dispatchStartedAt !== null
    : deliveryDetails.some((attempt) => attempt.status === "sent");
  const slackDeliverySent = deliveryDetails.some(
    (attempt) => attempt.channel === "slack" && attempt.status === "sent",
  );
  const whatsappAttempts = deliveryDetails.filter((attempt) => attempt.channel === "whatsapp");
  const hasExplicitWebhookStatus = whatsappAttempts.some((attempt) => attempt.webhookStatus !== undefined);
  const whatsappDeliverySent = requireWhatsAppDelivery && whatsappAttempts.length > 0
    ? hasExplicitWebhookStatus
      ? whatsappAttempts.some(
          (attempt) => attempt.status === "sent" && attempt.webhookStatus === "delivered",
        )
      : await hasReconciledWhatsAppDelivery(env, digestRunId, target.user_id)
    : false;
  const deliveryBlockers = [
    deliverySent ? null : "no_digest_delivery_sent",
    requireSlackDelivery && !slackDeliverySent ? "no_slack_digest_sent" : null,
    requireWhatsAppDelivery && !whatsappDeliverySent ? "no_whatsapp_digest_sent" : null,
    ...proofEmailBlockers,
  ].filter((value): value is string => Boolean(value));

  return Response.json(
    {
      ok: deliveryBlockers.length === 0,
      gateRunId,
      workerVersionId: env.CF_VERSION_METADATA?.id ?? null,
      blockers: deliveryBlockers,
      runId,
      proofCaptureId,
      digestRunId,
      delivery: sanitizeDeliveryForCanary(deliveryDetails, delivery.attempts, delivery.channels),
      ...(proofEmail ? { proofEmail } : {}),
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
        renderStatus: snapshot.captureMethod === "browser_render" ? "rendered" : "captured",
      },
    },
    {
      status: deliveryBlockers.length === 0 ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

interface CanaryDeliveryDetail {
  channel: string;
  status: string;
  deliveredAt?: string | null;
  webhookStatus?: string;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  subject?: string | null;
  providerDispatchStartedAt?: string | null;
}

function buildPrivateProofEmail(
  emailAttempts: CanaryDeliveryDetail[],
  gateRunId: string,
  expectedSubject: string,
) {
  const attempt = emailAttempts.length === 1 ? emailAttempts[0] : null;
  const dispatchStartedAt = readCanonicalUtcTimestamp(attempt?.providerDispatchStartedAt);
  return {
    gateRunId,
    dispatchStartedAt,
    subject: attempt?.subject === expectedSubject ? expectedSubject : null,
    provider: {
      status: attempt?.status ?? null,
      accepted: attempt?.status === "sent",
      messageId: attempt?.providerMessageId ?? null,
      error: attempt?.errorMessage ?? null,
    },
  };
}

function readCanonicalUtcTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.endsWith("Z")) return null;
  try {
    return new Date(value).toISOString() === value ? value : null;
  } catch {
    return null;
  }
}

function buildGateCProofEmailSubject(gateRunId: string): string | null {
  const subject = `0509 Gate C proof ${gateRunId}`;
  return countExactOccurrences(subject, gateRunId) === 1 ? subject : null;
}

function countExactOccurrences(value: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = value.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function sanitizeDeliveryForCanary(
  details: CanaryDeliveryDetail[],
  attempts: number,
  channels: string[],
) {
  return {
    attempts,
    channels,
    details: details.map((attempt) => ({
      channel: attempt.channel,
      status: attempt.status,
      deliveredAt: attempt.deliveredAt ?? null,
      ...(attempt.webhookStatus ? { webhookStatus: attempt.webhookStatus } : {}),
    })),
  };
}

async function hasReconciledWhatsAppDelivery(
  env: { DB?: D1Database },
  digestRunId: string,
  userId: string,
) {
  if (!env.DB) return false;

  try {
    const result = await env.DB.prepare(`
        SELECT 1 AS present
        FROM delivery_attempt
        WHERE digest_run_id = ?
          AND user_id = ?
          AND channel = 'whatsapp'
          AND status = 'sent'
          AND webhook_status = 'delivered'
        LIMIT 1
      `).bind(digestRunId, userId).all<{ present: number }>();
    return (result.results?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function cleanupErrorResponse(blocker: string, status: number) {
  return Response.json(
    {
      ok: false,
      mode: "cleanup",
      blocker,
      cleanupTruth: CLEANUP_TRUTH,
    },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

async function readCleanupInput(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return null;
  }

  const { readRequestTextWithinLimit } = await import("~/lib/bounded-response.server");
  const rawBody = await readRequestTextWithinLimit(request, CLEANUP_BODY_MAX_BYTES);
  if (!rawBody) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const body = parsed as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (keys.join(",") === "gateRunId") {
    const gateRunId = typeof body.gateRunId === "string" ? body.gateRunId.trim() : "";
    return /^[a-z0-9._-]{1,128}$/u.test(gateRunId) ? { gateRunId } : null;
  }
  if (keys.join(",") !== "digestRunId,proofCaptureId,runId") return null;
  if (!isCleanupIdentifier(body.runId) || !isCleanupIdentifier(body.digestRunId) || !isCleanupIdentifier(body.proofCaptureId)) {
    return null;
  }

  return {
    runId: body.runId,
    digestRunId: body.digestRunId,
    proofCaptureId: body.proofCaptureId,
  };
}

async function readGateRunId(request: Request): Promise<string | null | false> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return null;
  }
  const { readRequestTextWithinLimit } = await import("~/lib/bounded-response.server");
  const rawBody = await readRequestTextWithinLimit(request, CLEANUP_BODY_MAX_BYTES);
  if (!rawBody) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).sort().join(",") !== "gateRunId") return false;
  const gateRunId = typeof body.gateRunId === "string" ? body.gateRunId.trim() : "";
  return /^[a-z0-9._-]{1,128}$/u.test(gateRunId) ? gateRunId : false;
}

function isCleanupIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f\s]/.test(value);
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
