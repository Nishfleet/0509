/**
 * Watchlists domain barrel. Product code should keep importing from
 * `~/lib/data.server` until later migration PRs; billing leaf callers may
 * import reconcile helpers from `watchlist-plan-reconcile.server` directly.
 */

export {
  listWatchlistsPage,
  listWatchlists,
  listActiveWatchlistsPage,
  listActiveWatchlists,
  getWatchlist,
  createWatchlistWithinLimit,
  createWatchlist,
  deleteUnscannedWatchlistCreatedByFailedAgentAction,
  updateWatchlist,
  setWatchlistActive,
  type CreateWatchlistInput,
  type CreateWatchlistWithinLimitResult,
} from "~/lib/data/watchlists-core.server";

export {
  listWebMentionTargets,
  listWebMentionObservations,
  syncWebMentionTargetsForUser,
} from "~/lib/data/watchlist-web-mentions.server";

export {
  buildWatchlistGrantReconcileStatements,
  buildWatchlistRevokeReconcileStatement,
  syncWatchlistMentionTargetsIfChanged,
  deactivateWatchlistsBeyondPlanLimit,
  reactivateWatchlistsUpToPlanLimit,
} from "~/lib/data/watchlist-plan-reconcile.server";

export {
  hasInFlightWatchlistRun,
  listWatchlistRunPairsForEventIds,
  listFirstScanRunStates,
  type FirstScanRunState,
  createWatchlistRun,
  finishWatchlistRun,
  getRecentSuccessfulRuns,
  buildCapacitySkipIdempotencyKey,
  recordWatchlistCapacitySkip,
  listWatchlistRuns,
  touchWatchlistScanned,
  isSoftScanFailure,
  countLeadingFailures,
  getSuccessfulRunStatsForUserBetween,
  countWatchlistRunsForUserSince,
  createAdObservation,
  listObservationsForRunPage,
  listObservationsForRun,
} from "~/lib/data/watchlist-runs.server";

export {
  legacyWatchEventImportanceScore,
  listWatchEvents,
  listWatchEventsByIds,
  listEventCandidates,
  listWatchEventsBetween,
  createWatchEvent,
  createEventCandidate,
} from "~/lib/data/watch-events.server";

export {
  getProofTargetByIdentity,
  upsertProofTarget,
  listProofCapturesForTarget,
  listProofCapturesForTargets,
  listProofCapturePairsForEventIds,
  listSuccessfulProofCapturesForAd,
  listLastSuccessfulProofCapturesForAds,
  listRecentProofCapturesForWatchlist,
  countProofCapturesForWatchlistSince,
  countProofCapturesForWorkspaceSince,
  getSuccessfulProofCaptureStatsForUser,
  listRecentWorkspaceProofCaptures,
  createProofCapture,
} from "~/lib/data/watchlist-proof.server";

export {
  getWatchlistDeliveryConfig,
  upsertWatchlistDeliveryConfig,
} from "~/lib/data/watchlist-delivery-config.server";

export type { ObservationRow } from "~/lib/data/watchlist-rows.server";
