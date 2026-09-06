import type { AppEnv } from "~/lib/env.server";
import { parseReportId, type ReportDocument } from "~/lib/report";

export type OwnedReportDataSource = Pick<
  typeof import("~/lib/data.server"),
  | "getCollection"
  | "getLatestDigestRunSummaryForWatchlist"
  | "getWatchlist"
  | "listAdsByIds"
  | "listCollectionItems"
  | "listProofCapturePairsForEventIds"
  | "listWatchEvents"
>;

export interface LoadOwnedReportOptions {
  parallelWatchlistLookups?: boolean;
  requireActiveWatchlist?: boolean;
  verifyReportIdentity?: boolean;
}

export async function loadOwnedReportDocument(
  env: AppEnv,
  userId: string,
  reportId: string,
  data: OwnedReportDataSource,
  options: LoadOwnedReportOptions = {},
): Promise<ReportDocument | null> {
  const parsed = parseReportId(reportId);
  if (!parsed) return null;

  const { buildCollectionReport, buildWatchlistReport } = await import(
    "~/lib/report-builder.server"
  );

  let report: ReportDocument;
  if (parsed.resourceType === "collection") {
    const collection = await data.getCollection(env, parsed.resourceId, userId);
    if (!collection) return null;

    report = buildCollectionReport({
      collection,
      items: await data.listCollectionItems(env, collection.id),
    });
  } else {
    const watchlist = await data.getWatchlist(env, parsed.resourceId, userId);
    if (!watchlist || (options.requireActiveWatchlist && watchlist.isActive === false)) {
      return null;
    }

    const events = await data.listWatchEvents(env, watchlist.id, 60);
    const adIds = events
      .map((event) => event.adId)
      .filter((adId): adId is string => typeof adId === "string" && adId.length > 0);
    const loadAds = () => data.listAdsByIds(env, adIds);
    const loadSummary = () =>
      data.getLatestDigestRunSummaryForWatchlist(env, userId, watchlist.id);
    const loadProofCaptures = () =>
      data.listProofCapturePairsForEventIds(
        env,
        userId,
        events.map((event) => event.id),
        { includePrevious: false },
      );
    const [ads, proofCapturePairs, aiWeeklySummary] = options.parallelWatchlistLookups
      ? await Promise.all([loadAds(), loadProofCaptures(), loadSummary()])
      : [await loadAds(), await loadProofCaptures(), await loadSummary()];

    report = buildWatchlistReport({
      watchlist,
      events,
      adsById: new Map(ads.map((ad) => [ad.metaAdId, ad])),
      proofCapturesByEventId: new Map(
        proofCapturePairs.map((pair) => [pair.eventId, pair.current]),
      ),
      aiWeeklySummary,
    });
  }

  if (!options.verifyReportIdentity) return report;
  return report.reportId === reportId &&
    report.resourceType === parsed.resourceType &&
    report.resourceId === parsed.resourceId
    ? report
    : null;
}
