import { digestMetadataForEvent } from "~/lib/change-intelligence";
import type { AppEnv } from "~/lib/env.server";
import {
  FIRST_BRIEF_KIND,
  buildFirstBriefDigestItems,
  firstBriefPeriod,
  hasEvidenceLinkedItem,
  isFirstBriefDigest,
  type FirstBriefAd,
  type FirstBriefEvent,
} from "~/lib/first-brief";
import type { WatchEventRecord, WatchlistRecord } from "~/lib/types";

type DeliveryProfile = {
  email?: string | null;
  name?: string | null;
  emailVerified?: boolean | null;
} | null;

async function data() {
  return import("~/lib/data.server");
}

async function reportFailure(env: AppEnv, error: unknown) {
  try {
    const { reportScheduledTaskFailure } = await import("~/lib/cron-failure-alert.server");
    await reportScheduledTaskFailure(env, "first_brief_delivery", error);
  } catch {
    // Observability must never fail the first-brief path.
  }
}

export interface FirstBriefScanInput {
  watchlist: WatchlistRecord;
  events: WatchEventRecord[];
  adsSeen: number;
  observations: Array<{
    ad_id: string | null;
    landing_page_url?: string | null;
  }>;
  userDeliveryProfile: DeliveryProfile;
}

export interface FirstBriefFileResult {
  filed: boolean;
  delivered: boolean;
  digestRunId: string | null;
  reason:
    | "filed"
    | "already_filed"
    | "no_evidence"
    | "missing_profile"
    | "create_failed"
    | "delivery_failed";
}

/**
 * Files the in-session first brief from the activation-scan baseline and
 * sends it on the existing digest email path. Failures never fail the scan.
 * Idempotent on (user, watchlist createdAt period).
 */
export async function maybeFileAndDeliverFirstBrief(
  env: AppEnv,
  input: FirstBriefScanInput,
): Promise<FirstBriefFileResult> {
  try {
    return await fileAndDeliverFirstBrief(env, input);
  } catch (error) {
    await reportFailure(env, error);
    return {
      filed: false,
      delivered: false,
      digestRunId: null,
      reason: "create_failed",
    };
  }
}

async function fileAndDeliverFirstBrief(
  env: AppEnv,
  input: FirstBriefScanInput,
): Promise<FirstBriefFileResult> {
  const existing = await findExistingFirstBrief(env, input.watchlist.userId);
  if (existing && hasEvidenceLinkedItem(existing.items)) {
    const delivered = await deliverFirstBrief(env, {
      digestRunId: existing.id,
      watchlist: input.watchlist,
      userDeliveryProfile: input.userDeliveryProfile,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
      items: existing.items.map((item) => ({
        eventId: String(item.metadata.eventId ?? ""),
        watchlistId: item.watchlistId,
        watchlistName: item.watchlistName,
        eventType: item.eventType,
        title: item.title,
        summary: item.summary,
        metadata: item.metadata,
      })),
    });
    return {
      filed: true,
      delivered,
      digestRunId: existing.id,
      reason: "already_filed",
    };
  }

  const ads = await loadAdsForObservations(env, input.observations);
  const events = toFirstBriefEvents(input.events);
  const digestItems = buildFirstBriefDigestItems({
    watchlistId: input.watchlist.id,
    watchlistName: input.watchlist.name,
    events,
    ads,
  }).map((item) => {
    const sourceEvent = input.events.find((event) => event.id === item.metadata.eventId);
    return {
      ...item,
      metadata: {
        ...(sourceEvent ? digestMetadataForEvent(sourceEvent, undefined, null) : {}),
        ...item.metadata,
      },
    };
  });

  if (digestItems.length === 0 || !hasEvidenceLinkedItem(digestItems)) {
    return {
      filed: false,
      delivered: false,
      digestRunId: null,
      reason: "no_evidence",
    };
  }

  const { periodStart, periodEnd } = firstBriefPeriod(input.watchlist.createdAt);
  const summary = {
    kind: FIRST_BRIEF_KIND,
    totalEvents: digestItems.length,
    adsSeen: input.adsSeen,
    watchlistId: input.watchlist.id,
  };
  const { createDigestRun, getDigest } = await data();
  const claim = await createDigestRun(
    env,
    input.watchlist.userId,
    periodStart,
    periodEnd,
    summary,
    { returnClaim: true, items: digestItems },
  );

  const digest = await getDigest(env, claim.digestRunId);
  if (!digest || !hasEvidenceLinkedItem(digest.items)) {
    return {
      filed: false,
      delivered: false,
      digestRunId: claim.digestRunId,
      reason: "create_failed",
    };
  }

  const delivered = await deliverFirstBrief(env, {
    digestRunId: digest.id,
    watchlist: input.watchlist,
    userDeliveryProfile: input.userDeliveryProfile,
    periodStart: digest.periodStart,
    periodEnd: digest.periodEnd,
    items: digest.items.map((item) => ({
      eventId: String(item.metadata.eventId ?? ""),
      watchlistId: item.watchlistId,
      watchlistName: item.watchlistName,
      eventType: item.eventType,
      title: item.title,
      summary: item.summary,
      metadata: item.metadata,
    })),
  });

  return {
    filed: true,
    delivered,
    digestRunId: digest.id,
    reason: claim.created ? "filed" : "already_filed",
  };
}

async function findExistingFirstBrief(env: AppEnv, userId: string) {
  const { listDigests } = await data();
  const digests = await listDigests(env, userId);
  return digests.find((digest) => isFirstBriefDigest(digest)) ?? null;
}

async function loadAdsForObservations(
  env: AppEnv,
  observations: FirstBriefScanInput["observations"],
): Promise<FirstBriefAd[]> {
  const adIds = observations
    .map((observation) => observation.ad_id)
    .filter((adId): adId is string => Boolean(adId));
  if (adIds.length === 0) {
    return observations
      .map((observation) => observation.landing_page_url)
      .filter((url): url is string => Boolean(url))
      .map((landingPageUrl, index) => ({
        metaAdId: `landing-${index}`,
        landingPageUrl,
        adSnapshotUrl: null,
      }));
  }
  const { listAdsByIds } = await data();
  const ads = await listAdsByIds(env, adIds);
  return ads.map((ad) => ({
    metaAdId: ad.metaAdId,
    landingPageUrl: ad.landingPageUrl,
    adSnapshotUrl: ad.adSnapshotUrl,
  }));
}

function toFirstBriefEvents(events: WatchEventRecord[]): FirstBriefEvent[] {
  return events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    title: event.title,
    summary: event.summary,
    proofCaptureId: event.proofCaptureId,
    adId: event.adId,
    createdAt: event.createdAt,
    confirmedAt: event.confirmedAt,
    metadata: (event.metadata ?? {}) as Record<string, unknown>,
  }));
}

async function deliverFirstBrief(
  env: AppEnv,
  input: {
    digestRunId: string;
    watchlist: WatchlistRecord;
    userDeliveryProfile: FirstBriefScanInput["userDeliveryProfile"];
    periodStart: string;
    periodEnd: string;
    items: Array<{
      eventId: string;
      watchlistId: string;
      watchlistName: string;
      eventType: string;
      title: string;
      summary: string;
      metadata?: Record<string, unknown>;
    }>;
  },
): Promise<boolean> {
  const profile = input.userDeliveryProfile;
  if (!profile?.email || profile.emailVerified !== true) {
    return false;
  }
  if (input.items.some((item) => !item.eventId)) {
    return false;
  }

  const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
  const delivery = await deliverWeeklyDigest(env, {
    userId: input.watchlist.userId,
    userName: profile.name ?? "Workspace owner",
    accountEmail: profile.email,
    digestRunId: input.digestRunId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    cadence: "weekly",
    lane: "customer",
    firstBrief: true,
    hasPreviousBrief: false,
    previousBriefItemCount: null,
  });
  return Array.isArray(delivery.details)
    ? delivery.details.some((attempt) => attempt.status === "sent")
    : delivery.attempts > 0;
}

/**
 * Catch-up path for the in-session first brief. Used by the dashboard and
 * the first-scan workflow after the activation scan has persisted, because
 * the scan runner itself is not the right place to add this side effect.
 */
export async function ensureFirstBriefForWorkspace(
  env: AppEnv,
  userId: string,
): Promise<FirstBriefFileResult> {
  try {
    const db = await data();
    const watchlists = await db.listWatchlists(env, userId, { includeInactive: true });
    const scanned = watchlists.find(
      (watchlist) => watchlist.isActive && Boolean(watchlist.lastScannedAt),
    );
    if (!scanned) {
      return {
        filed: false,
        delivered: false,
        digestRunId: null,
        reason: "no_evidence",
      };
    }
    const [runs, profile] = await Promise.all([
      db.getRecentSuccessfulRuns(env, scanned.id, 1),
      db.getUserDeliveryProfile(env, userId),
    ]);
    const run = runs[0];
    if (!run) {
      return {
        filed: false,
        delivered: false,
        digestRunId: null,
        reason: "no_evidence",
      };
    }
    const [events, observations] = await Promise.all([
      db.listWatchEventsForRun(env, scanned.id, run.id),
      db.listObservationsForRun(env, run.id),
    ]);
    return await maybeFileAndDeliverFirstBrief(env, {
      watchlist: scanned,
      events,
      adsSeen: observations.length,
      observations: observations.map((observation) => ({
        ad_id: observation.ad_id,
        landing_page_url: observation.landing_page_url ?? null,
      })),
      userDeliveryProfile: profile,
    });
  } catch (error) {
    await reportFailure(env, error);
    return {
      filed: false,
      delivered: false,
      digestRunId: null,
      reason: "create_failed",
    };
  }
}

export async function ensureFirstBriefForWatchlist(
  env: AppEnv,
  watchlistId: string,
): Promise<FirstBriefFileResult> {
  const { getWatchlist } = await data();
  const watchlist = await getWatchlist(env, watchlistId);
  if (!watchlist) {
    return {
      filed: false,
      delivered: false,
      digestRunId: null,
      reason: "no_evidence",
    };
  }
  return ensureFirstBriefForWorkspace(env, watchlist.userId);
}
