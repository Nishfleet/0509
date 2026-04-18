import { Resend } from "resend";

import { buildAnalysisFields } from "~/lib/analysis.server";
import { captureCreativeText } from "~/lib/creative-text.server";
import {
  createAdObservation,
  createDigestRun,
  createLandingPageSnapshot,
  createWatchEvent,
  createWatchlistRun,
  clearDigestItems,
  finishWatchlistRun,
  getDigestByPeriod,
  getRecentSuccessfulRuns,
  getSavedQuery,
  getWatchlist,
  hydrateAdsWithPersistedCreatives,
  listActiveWatchlists,
  listObservationsForRun,
  listWatchEventsBetween,
  listWatchlists,
  logMetaIntegrationStatus,
  touchWatchlistScanned,
  upsertAd,
  upsertDigestDelivery,
  addDigestItem,
} from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import { captureLandingPageSnapshot } from "~/lib/landing-pages.server";
import { MetaApiError, searchAds } from "~/lib/meta-api.server";
import { normalizeSavedQuery } from "~/lib/normalize";
import { getUserPlan, PLAN_LIMITS } from "~/lib/plan.server";
import type {
  AdRecord,
  NormalizedSavedQuery,
  WatchEventType,
  WatchlistRecord,
  WatchlistRunRecord,
} from "~/lib/types";

const DEFAULT_PAGE_BUDGET = 2;
const MANUAL_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
const INACTIVE_MISS_THRESHOLD = 2;
const DIGEST_LOOKBACK_DAYS = 7;

type ObservationRecord = Awaited<ReturnType<typeof listObservationsForRun>>[number];

interface WatchEventDraft {
  eventType: WatchEventType;
  adId: string | null;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
}

interface ScanPayload {
  ads: AdRecord[];
  pagesScanned: number;
}

export interface MonitoringWorkflowParams {
  watchlistId: string;
  triggerType: WatchlistRunRecord["triggerType"];
  executionKey: string;
  proofCaptureRequestKeyPrefix: string;
  queuedAt: string;
}

interface RunScheduledMonitoringOptions {
  includeDigests?: boolean;
  cron?: string;
  scheduledTime?: number;
}

export async function runScheduledMonitoring(
  env: AppEnv,
  options: RunScheduledMonitoringOptions = {},
) {
  if (!env.DB) {
    return { queued: 0, duplicates: 0, inlineRuns: 0, digests: 0 };
  }

  const watchlists = await listActiveWatchlists(env);
  let queued = 0;
  let duplicates = 0;
  let inlineRuns = 0;

  const workflowBinding = getMonitoringWorkflowBinding(env);

  if (workflowBinding) {
    const scheduledTime = options.scheduledTime ?? Date.now();

    for (const watchlist of watchlists) {
      const executionKey = buildWatchlistExecutionIdempotencyKey({
        watchlistId: watchlist.id,
        triggerType: "scheduled",
        scheduledTime,
        cron: options.cron,
      });

      try {
        await workflowBinding.create({
          id: executionKey,
          params: {
            watchlistId: watchlist.id,
            triggerType: "scheduled",
            executionKey,
            proofCaptureRequestKeyPrefix: `proof:${executionKey}`,
            queuedAt: new Date(scheduledTime).toISOString(),
          },
        });
        queued += 1;
      } catch (error) {
        if (isDuplicateWorkflowCreateError(error)) {
          duplicates += 1;
          continue;
        }

        throw error;
      }
    }
  } else {
    const scanCache = new Map<string, Promise<ScanPayload>>();

    for (const watchlist of watchlists) {
      const query = await resolveWatchlistQuery(env, watchlist);
      if (!query) {
        continue;
      }

      if (!scanCache.has(watchlist.targetFingerprint)) {
        scanCache.set(
          watchlist.targetFingerprint,
          performBoundedScan(env, query, DEFAULT_PAGE_BUDGET),
        );
      }

      await runWatchlist(env, watchlist, "scheduled", scanCache.get(watchlist.targetFingerprint)!);
      inlineRuns += 1;
    }
  }

  const digests = options.includeDigests ? await runWeeklyDigests(env) : 0;

  return {
    queued,
    duplicates,
    inlineRuns,
    digests,
  };
}

export async function runWatchlistManual(env: AppEnv, watchlist: WatchlistRecord) {
  if (
    watchlist.lastScannedAt &&
    Date.now() - new Date(watchlist.lastScannedAt).getTime() < MANUAL_REFRESH_COOLDOWN_MS
  ) {
    throw new Error("This watchlist was refreshed recently. Try again in a few minutes.");
  }

  return runWatchlist(
    env,
    watchlist,
    "manual",
    (async () => {
      const query = await resolveWatchlistQuery(env, watchlist);
      if (!query) {
        throw new Error("The watchlist target could not be resolved.");
      }
      return performBoundedScan(env, query, DEFAULT_PAGE_BUDGET);
    })(),
  );
}

export async function runWatchlistWorkflowJob(
  env: AppEnv,
  params: MonitoringWorkflowParams,
) {
  const watchlist = await getWatchlist(env, params.watchlistId);
  if (!watchlist || !watchlist.isActive) {
    return {
      status: "skipped" as const,
      reason: "watchlist_unavailable",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  const query = await resolveWatchlistQuery(env, watchlist);
  if (!query) {
    return {
      status: "skipped" as const,
      reason: "watchlist_target_unresolved",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  const result = await runWatchlist(
    env,
    watchlist,
    params.triggerType,
    performBoundedScan(env, query, DEFAULT_PAGE_BUDGET),
  );

  return {
    status: "completed" as const,
    executionKey: params.executionKey,
    proofCaptureRequestKeyPrefix: params.proofCaptureRequestKeyPrefix,
    ...result,
  };
}

export async function runWatchlist(
  env: AppEnv,
  watchlist: WatchlistRecord,
  triggerType: WatchlistRunRecord["triggerType"],
  scanPromise: Promise<ScanPayload>,
) {
  const recentRuns = await getRecentSuccessfulRuns(env, watchlist.id, 3);
  const baselineRun = recentRuns[0] ?? null;
  const priorRun = recentRuns[1] ?? null;
  const runId = await createWatchlistRun(
    env,
    watchlist.id,
    triggerType,
    baselineRun?.id ?? null,
    DEFAULT_PAGE_BUDGET,
  );

  try {
    const { ads, pagesScanned } = await scanPromise;

    for (const ad of ads) {
      const enrichedAd = await enrichAdForObservation(env, ad);
      await upsertAd(env, enrichedAd);
      const landingPageSnapshotId = enrichedAd.landingPage
        ? await createLandingPageSnapshot(env, enrichedAd.landingPage)
        : null;

      await createAdObservation(env, {
        adId: enrichedAd.metaAdId,
        watchlistRunId: runId,
        landingPageSnapshotId,
        landingPageUrl: enrichedAd.landingPage?.canonicalUrl ?? enrichedAd.landingPageUrl,
        seenAt: new Date().toISOString(),
        isActive: enrichedAd.active,
        metadata: {
          advertiser: enrichedAd.advertiser,
          hook: enrichedAd.hook,
          offer: enrichedAd.offer,
        },
      });
    }

    const [currentObservations, baselineObservations, priorObservations] = await Promise.all([
      listObservationsForRun(env, runId),
      baselineRun ? listObservationsForRun(env, baselineRun.id) : Promise.resolve([]),
      priorRun ? listObservationsForRun(env, priorRun.id) : Promise.resolve([]),
    ]);

    const eventDrafts = diffWatchlistObservations(
      watchlist,
      currentObservations,
      baselineObservations,
      priorObservations,
    );

    for (const draft of eventDrafts) {
      await createWatchEvent(env, {
        watchlistId: watchlist.id,
        runId,
        eventType: draft.eventType,
        adId: draft.adId,
        baselineFromRunId: baselineRun?.id ?? null,
        title: draft.title,
        summary: draft.summary,
        metadata: draft.metadata,
      });
    }

    await finishWatchlistRun(env, runId, {
      status: "succeeded",
      pagesScanned,
      summary: {
        adsSeen: currentObservations.length,
        events: eventDrafts.length,
        eventTypes: summarizeEventTypes(eventDrafts),
      },
    });
    await touchWatchlistScanned(env, watchlist.id);
    await logMetaIntegrationStatus(env, {
      status: env.META_AD_LIBRARY_TOKEN ? "healthy" : "demo",
      summary: env.META_AD_LIBRARY_TOKEN
        ? "Scheduled watchlist scan completed successfully."
        : "Watchlist scan completed in explicit demo mode because no Meta token is configured.",
      metadata: {
        watchlistId: watchlist.id,
        runId,
      },
    });

    return { runId, events: eventDrafts.length };
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown monitoring error.";
    const errorCode =
      error instanceof MetaApiError ? String(error.code) : "monitoring_failed";

    await finishWatchlistRun(env, runId, {
      status: "failed",
      pagesScanned: 0,
      summary: {
        adsSeen: 0,
        events: 0,
      },
      errorCode,
      errorMessage: details,
    });
    await logMetaIntegrationStatus(env, {
      status: "degraded",
      summary:
        error instanceof MetaApiError && error.isAuthError
          ? "Meta Ad Library authentication failed during monitoring."
          : "A monitoring run failed and needs attention.",
      errorCode,
      errorMessage: details,
      metadata: {
        watchlistId: watchlist.id,
        runId,
      },
    });
    throw error;
  }
}

export function diffWatchlistObservations(
  watchlist: WatchlistRecord,
  current: ObservationRecord[],
  baseline: ObservationRecord[],
  prior: ObservationRecord[],
) {
  const drafts: WatchEventDraft[] = [];
  const currentByAd = mapObservationsByAdId(current);
  const baselineByAd = mapObservationsByAdId(baseline);
  const priorByAd = mapObservationsByAdId(prior);

  for (const [adId, observation] of currentByAd) {
    const baselineObservation = baselineByAd.get(adId);

    if (!baselineObservation) {
      drafts.push({
        eventType: "ad_new",
        adId,
        title: "New ad detected",
        summary: `A new ad entered ${watchlist.name}.`,
        metadata: {
          advertiser: observation.metadata_json ? safeMetadata(observation).advertiser : null,
        },
      });
      continue;
    }

    if (
      observation.landing_page_url &&
      baselineObservation.landing_page_url &&
      observation.landing_page_url !== baselineObservation.landing_page_url
    ) {
      drafts.push({
        eventType: "landing_page_url_changed",
        adId,
        title: "Landing page URL changed",
        summary: "The destination URL changed between watchlist scans.",
        metadata: {
          from: baselineObservation.landing_page_url,
          to: observation.landing_page_url,
        },
      });
    }

    if (
      observation.normalized_headline_hash &&
      baselineObservation.normalized_headline_hash &&
      observation.normalized_headline_hash !== baselineObservation.normalized_headline_hash
    ) {
      drafts.push({
        eventType: "landing_page_headline_changed",
        adId,
        title: "Landing page headline changed",
        summary: "The landing-page headline changed after normalization.",
        metadata: {
          from: baselineObservation.raw_headline,
          to: observation.raw_headline,
        },
      });
    }
  }

  for (const [adId] of priorByAd) {
    const seenInBaseline = baselineByAd.has(adId);
    const seenNow = currentByAd.has(adId);

    if (!seenInBaseline && !seenNow) {
      drafts.push({
        eventType: "ad_inactive",
        adId,
        title: "Ad marked inactive",
        summary: `The ad has been absent for ${INACTIVE_MISS_THRESHOLD} consecutive runs.`,
        metadata: {
          threshold: INACTIVE_MISS_THRESHOLD,
        },
      });
    }
  }

  return dedupeEventDrafts(drafts);
}

export async function runWeeklyDigests(env: AppEnv) {
  if (!env.DB) {
    return 0;
  }

  const db = env.DB;
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - DIGEST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const periodStartIso = periodStart.toISOString();
  const periodEndIso = periodEnd.toISOString();

  const usersResult = await db
    .prepare(
      `
        SELECT DISTINCT user.id, user.email, user.name
        FROM user
        INNER JOIN watchlist ON watchlist.user_id = user.id
        WHERE watchlist.is_active = 1
      `,
    )
    .all<{ id: string; email: string; name: string }>();

  const users = usersResult.results ?? [];
  let digestsSent = 0;

  for (const user of users) {
    const plan = await getUserPlan(env, user.id);
    if (!PLAN_LIMITS[plan].digests) {
      continue;
    }

    const watchlists = await listWatchlists(env, user.id);
    const digestItems: Array<{
      watchlistId: string;
      watchlistName: string;
      eventType: WatchEventType;
      title: string;
      summary: string;
    }> = [];

    for (const watchlist of watchlists) {
      const events = await listWatchEventsBetween(
        env,
        watchlist.id,
        periodStartIso,
        periodEndIso,
      );

      for (const event of events) {
        digestItems.push({
          watchlistId: watchlist.id,
          watchlistName: watchlist.name,
          eventType: event.eventType,
          title: event.title,
          summary: event.summary,
        });
      }
    }

    if (digestItems.length === 0) {
      continue;
    }

    const existingDigest = await getDigestByPeriod(env, user.id, periodStartIso, periodEndIso);
    if (existingDigest?.delivery?.status === "sent") {
      continue;
    }

    const digestRunId =
      existingDigest?.id ??
      (await createDigestRun(env, user.id, periodStartIso, periodEndIso, {
        totalEvents: digestItems.length,
        watchlists: watchlists.length,
      }));

    if (existingDigest) {
      await clearDigestItems(env, digestRunId);
    }

    for (const item of digestItems) {
      await addDigestItem(env, digestRunId, item);
    }

    const delivery = await sendDigestEmail(env, {
      email: user.email,
      name: user.name,
      periodStart: periodStartIso,
      periodEnd: periodEndIso,
      items: digestItems,
    });

    await upsertDigestDelivery(env, digestRunId, delivery);
    digestsSent += 1;
  }

  return digestsSent;
}

async function sendDigestEmail(
  env: AppEnv,
  input: {
    email: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    items: Array<{
      watchlistId: string;
      watchlistName: string;
      eventType: WatchEventType;
      title: string;
      summary: string;
    }>;
  },
) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return {
      provider: "resend" as const,
      status: "failed" as const,
      recipientEmail: input.email,
      externalMessageId: null,
      errorMessage: "Resend is not configured for this environment.",
      deliveredAt: null,
    };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const html = renderDigestHtml(input);
  const response = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: input.email,
    subject: `0509 weekly digest: ${input.items.length} competitor changes`,
    html,
    text: stripHtml(html),
  });

  if (response.error) {
    return {
      provider: "resend" as const,
      status: "failed" as const,
      recipientEmail: input.email,
      externalMessageId: null,
      errorMessage: response.error.message,
      deliveredAt: null,
    };
  }

  return {
    provider: "resend" as const,
    status: "sent" as const,
    recipientEmail: input.email,
    externalMessageId: response.data?.id ?? null,
    errorMessage: null,
    deliveredAt: new Date().toISOString(),
  };
}

async function resolveWatchlistQuery(env: AppEnv, watchlist: WatchlistRecord) {
  if (watchlist.targetType === "advertiser") {
    return normalizeSavedQuery("advertiser", {
      query: watchlist.targetLabel,
      country: "India",
    });
  }

  const savedQuery = await getSavedQuery(env, watchlist.targetId);
  return savedQuery?.normalizedQuery ?? null;
}

async function performBoundedScan(
  env: AppEnv,
  query: NormalizedSavedQuery,
  pageBudget: number,
): Promise<ScanPayload> {
  let cursor: string | null | undefined = null;
  let pagesScanned = 0;
  const ads: AdRecord[] = [];

  do {
    const response = await searchAds(
      env,
      query,
      cursor ?? null,
      { allowDemoFallback: !env.META_AD_LIBRARY_TOKEN },
    );
    ads.push(...response.ads);
    cursor = response.nextCursor;
    pagesScanned += 1;
  } while (cursor && pagesScanned < pageBudget);

  const hydratedAds = await hydrateAdsWithPersistedCreatives(env, dedupeAds(ads));

  return {
    ads: hydratedAds,
    pagesScanned,
  };
}

export function buildWatchlistExecutionIdempotencyKey(input: {
  watchlistId: string;
  triggerType: WatchlistRunRecord["triggerType"];
  scheduledTime?: number;
  cron?: string | null;
}) {
  const slot = new Date(input.scheduledTime ?? Date.now())
    .toISOString()
    .replace(/[:.]/g, "-");
  const cronFragment = normalizeIdempotencySegment(input.cron ?? "adhoc");
  return `watchlist-run:${input.triggerType}:${input.watchlistId}:${cronFragment}:${slot}`;
}

export function buildProofCaptureRequestIdempotencyKey(input: {
  watchlistId: string;
  adId: string | null;
  landingPageUrl: string | null;
  eventType: WatchEventType;
}) {
  return [
    "proof-request",
    normalizeIdempotencySegment(input.watchlistId),
    normalizeIdempotencySegment(input.eventType),
    normalizeIdempotencySegment(input.adId ?? "none"),
    normalizeIdempotencySegment(normalizeIdempotencyUrl(input.landingPageUrl) ?? "none"),
  ].join(":");
}

function getMonitoringWorkflowBinding(env: AppEnv) {
  return env.MONITORING_WORKFLOW as Workflow<MonitoringWorkflowParams> | undefined;
}

function isDuplicateWorkflowCreateError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /already exists|already been created|instance .* exists|duplicate/i.test(
    error.message.toLowerCase(),
  );
}

function normalizeIdempotencyUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeIdempotencySegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function enrichAdForObservation(env: AppEnv, ad: AdRecord) {
  const [capturedLandingPage, capturedCreativeText] = await Promise.all([
    ad.landingPageUrl ? captureLandingPageSnapshot(env, ad.landingPageUrl) : Promise.resolve(null),
    ad.source === "meta" && ad.adSnapshotUrl && !ad.creativeText
      ? captureCreativeText(env, ad.adSnapshotUrl, ad)
      : Promise.resolve(null),
  ]);

  const nextAd = {
    ...ad,
    landingPage: capturedLandingPage ?? ad.landingPage ?? null,
    creativeText: capturedCreativeText?.text ?? ad.creativeText ?? null,
    creativeTextCaptureMethod:
      capturedCreativeText?.captureMethod ?? ad.creativeTextCaptureMethod ?? null,
    creativeTextMetadata:
      capturedCreativeText?.metadata ?? ad.creativeTextMetadata ?? null,
  };

  return ensureAnalysisFields(nextAd);
}

function ensureAnalysisFields(ad: AdRecord): AdRecord {
  return {
    ...ad,
    analysisFields: buildAnalysisFields(
      ad,
      ad.source === "meta" ? "meta_api" : "user",
    ),
  };
}

function mapObservationsByAdId(observations: ObservationRecord[]) {
  return new Map(observations.map((observation) => [observation.ad_id, observation]));
}

function dedupeAds(ads: AdRecord[]) {
  const unique = new Map<string, AdRecord>();
  for (const ad of ads) {
    unique.set(ad.metaAdId, ad);
  }
  return [...unique.values()];
}

function dedupeEventDrafts(drafts: WatchEventDraft[]) {
  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = `${draft.eventType}:${draft.adId ?? "none"}:${JSON.stringify(draft.metadata)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function summarizeEventTypes(drafts: WatchEventDraft[]) {
  return drafts.reduce<Record<string, number>>((accumulator, draft) => {
    accumulator[draft.eventType] = (accumulator[draft.eventType] ?? 0) + 1;
    return accumulator;
  }, {});
}

function renderDigestHtml(input: {
  name: string;
  periodStart: string;
  periodEnd: string;
  items: Array<{
    watchlistId: string;
    watchlistName: string;
    eventType: WatchEventType;
    title: string;
    summary: string;
  }>;
}) {
  const groups = input.items.reduce<Record<string, typeof input.items>>((accumulator, item) => {
    accumulator[item.watchlistName] = accumulator[item.watchlistName] ?? [];
    accumulator[item.watchlistName].push(item);
    return accumulator;
  }, {});

  return `
    <div style="font-family: Inter, system-ui, sans-serif; color: #0b1220; line-height: 1.5;">
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">0509 weekly digest</p>
      <h1 style="margin: 0 0 12px;">${escapeHtml(input.name || "Team")}, here’s what changed on Meta.</h1>
      <p style="margin: 0 0 24px; color: #475467;">
        ${formatDate(input.periodStart)} to ${formatDate(input.periodEnd)} · ${input.items.length} tracked changes
      </p>
      ${Object.entries(groups)
        .map(
          ([watchlistName, items]) => `
            <section style="margin-bottom: 24px; padding: 18px; border: 1px solid #d7dce5; border-radius: 18px;">
              <h2 style="margin: 0 0 12px; font-size: 18px;">${escapeHtml(watchlistName)}</h2>
              <ul style="margin: 0; padding-left: 18px;">
                ${items
                  .map(
                    (item) => `
                      <li style="margin-bottom: 10px;">
                        <strong>${escapeHtml(item.title)}</strong><br />
                        <span style="color: #475467;">${escapeHtml(item.summary)}</span>
                      </li>
                    `,
                  )
                  .join("")}
              </ul>
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeMetadata(observation: ObservationRecord) {
  try {
    return JSON.parse(observation.metadata_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
