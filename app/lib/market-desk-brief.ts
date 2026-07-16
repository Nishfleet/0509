import type { DigestRecord, WatchEventRecord, WatchlistRecord } from "~/lib/types";

export interface MarketDeskBriefFollowUp {
  title: string;
  ownerLabel?: string | null;
  channelLabel?: string | null;
  openCount?: number | null;
}

export interface MarketDeskBriefInput {
  watchlists: WatchlistRecord[];
  recentEvents: WatchEventRecord[];
  counterMoveFollowUps: MarketDeskBriefFollowUp[];
  digests: DigestRecord[];
  proofUsage: {
    used?: number | null;
    limit?: number | null;
    remaining?: number | null;
  };
  overnightStats?: {
    runs?: number | null;
    watchlistsChecked?: number | null;
    adsSeen?: number | null;
  } | null;
  successfulProofCount: number;
  nextScanLabel: string;
  plan?: string;
  sourceStatus?: string;
}

export interface MarketDeskBriefMetric {
  label: string;
  value: number;
  detail: string;
}

export interface MarketDeskBriefItem {
  label: string;
  title: string;
  detail: string;
}

export interface MarketDeskBrief {
  state: "empty" | "queued" | "quiet" | "changes" | "follow_up" | "paused";
  kicker: string;
  title: string;
  summary: string;
  action: {
    href: string;
    label: string;
  };
  metrics: MarketDeskBriefMetric[];
  items: MarketDeskBriefItem[];
  hasMetrics: boolean;
}

export function buildMarketDeskBrief(input: MarketDeskBriefInput): MarketDeskBrief {
  const watchlists = input.watchlists ?? [];
  const activeWatchlists = watchlists.filter((watchlist) => watchlist.isActive);
  const competitorCount = watchlists.length;
  const activeCount = activeWatchlists.length;
  const hasOnlyPausedWatchlists = competitorCount > 0 && activeCount === 0;
  const recentEvents = activeCount > 0 ? input.recentEvents ?? [] : [];
  const isFreePlan = input.plan === "free";
  const sourceHealthy = !input.sourceStatus || input.sourceStatus === "healthy";
  const confirmedChanges = recentEvents.filter((event) => event.status === "confirmed" || event.status === "detected");
  const sentDigests = (input.digests ?? []).filter((digest) => digest.delivery?.status === "sent").length;
  const overnightRuns = Math.max(0, Math.floor(input.overnightStats?.runs ?? 0));
  const overnightWatchlists = Math.max(0, Math.floor(input.overnightStats?.watchlistsChecked ?? 0));
  const overnightAdsSeen = Math.max(0, Math.floor(input.overnightStats?.adsSeen ?? 0));
  const hasOvernightCheck = overnightRuns > 0 || overnightWatchlists > 0;
  const overnightScope = overnightWatchlists > 0
    ? `${overnightWatchlists} competitor${overnightWatchlists === 1 ? "" : "s"}`
    : `${overnightRuns} scan${overnightRuns === 1 ? "" : "s"}`;
  const proofValue = input.proofUsage.used ?? input.successfulProofCount;
  const proofDetail = input.proofUsage.limit
    ? `${input.proofUsage.remaining ?? 0} left this month`
    : `${input.successfulProofCount} recent successes`;
  const hasScanHistory = activeWatchlists.some((watchlist) => Boolean(watchlist.lastScannedAt));
  const metrics = [
    {
      label: "Competitors watched",
      value: competitorCount,
      detail: competitorCount > 0
        ? (activeCount > 0 ? `${activeCount} active` : "All paused")
        : "Add your first competitors",
    },
    {
      label: "Moves found",
      value: confirmedChanges.length,
      detail: hasOnlyPausedWatchlists
        ? "Paused"
        : confirmedChanges.length > 0
          ? "Ready to review"
          : hasOvernightCheck
            ? "Quiet check complete"
            : isFreePlan
              ? "Waiting for activation scan"
              : "Waiting for first scan",
    },
    {
      label: "Evidence checks",
      value: proofValue,
      detail: proofDetail,
    },
    {
      label: "Digests sent",
      value: sentDigests,
      detail: sentDigests > 0
        ? "Email trail active"
        : isFreePlan
          ? "Paid plans include recurring monitoring"
          : "No digest sent yet",
    },
  ];
  const hasMetrics =
    competitorCount > 0 ||
    confirmedChanges.length > 0 ||
    input.successfulProofCount > 0 ||
    sentDigests > 0;

  if (input.counterMoveFollowUps.length > 0) {
    const count = input.counterMoveFollowUps.length;
    return {
      state: "follow_up",
      kicker: "Market Desk Brief",
      title: `${count} follow-up${count === 1 ? "" : "s"} to decide`,
      summary: "Source-backed response work is waiting. Review the open follow-ups before the response window closes.",
      action: { href: "/app/watchlists", label: "Review follow-ups" },
      metrics,
      items: input.counterMoveFollowUps.slice(0, 3).map((followUp) => ({
        label: "Decision",
        title: followUp.title,
        detail: [followUp.ownerLabel, followUp.channelLabel].filter(Boolean).join(" · ") || "Open follow-up",
      })),
      hasMetrics,
    };
  }

  if (confirmedChanges.length > 0) {
    const count = confirmedChanges.length;
    return {
      state: "changes",
      kicker: "Market Desk Brief",
      title: `${count} competitor move${count === 1 ? "" : "s"} to review`,
      summary: "A watched competitor changed. Open the source trail and decide whether to respond, ignore, or package it.",
      action: { href: "/app/watchlists", label: "Review moves" },
      metrics,
      items: confirmedChanges.slice(0, 3).map((event) => ({
        label: event.eventType.replaceAll("_", " "),
        title: event.title,
        detail: event.summary,
      })),
      hasMetrics,
    };
  }

  if (hasOvernightCheck) {
    if (!sourceHealthy) {
      return {
        state: "queued",
        kicker: "Market Desk Brief",
        title: "Source access needs attention",
        summary: "The latest check cannot be treated as a quiet result while commercial source access is degraded or unavailable. Review Source access before relying on this brief.",
        action: { href: "/app/source-access", label: "Open Source access" },
        metrics,
        items: [],
        hasMetrics,
      };
    }

    if (isFreePlan) {
      return {
        state: "quiet",
        kicker: "Market Desk Brief",
        title: "Activation check completed",
        summary: `One-time activation check completed across ${overnightScope}. Paid plans include recurring monitoring for future changes.`,
        action: { href: "/app/watchlists", label: "Review watchlists" },
        metrics,
        items: activeWatchlists.slice(0, 3).map((watchlist) => ({
          label: "Activated",
          title: watchlist.targetLabel,
          detail: watchlist.lastScannedAt ? "Activation scan complete" : "Activation scan pending",
        })),
        hasMetrics,
      };
    }

    return {
      state: "quiet",
      kicker: "Market Desk Brief",
      title: "Quiet check completed",
      summary: `All quiet - ${overnightAdsSeen} ad${overnightAdsSeen === 1 ? "" : "s"} checked across ${overnightScope}. Completed checks found no action-worthy movement.`,
      action: { href: "/app/watchlists", label: "Review watchlists" },
      metrics,
      items: activeWatchlists.slice(0, 3).map((watchlist) => ({
        label: "Watched",
        title: watchlist.targetLabel,
        detail: watchlist.lastScannedAt ? "Checked recently" : "Waiting for first successful scan",
      })),
      hasMetrics,
    };
  }

  if (hasOnlyPausedWatchlists) {
    return {
      state: "paused",
      kicker: "Market Desk Brief",
      title: "Tracking is paused",
      summary: "Resume a competitor watch when you want Five to Nine checking changes again.",
      action: { href: "/app/watchlists", label: "Resume watch" },
      metrics,
      items: watchlists.slice(0, 3).map((watchlist) => ({
        label: "Paused",
        title: watchlist.targetLabel,
        detail: "Not included in scans or briefs until resumed",
      })),
      hasMetrics,
    };
  }

  if (activeCount > 0) {
    if (hasScanHistory) {
      if (isFreePlan) {
        return {
          state: "queued",
          kicker: "Market Desk Brief",
          title: "Activation check complete",
          summary: "Your one-time activation scan is complete. Paid plans include recurring monitoring for future changes.",
          action: { href: "/app/billing?source=dashboard#plans", label: "View paid plans" },
          metrics,
          items: activeWatchlists.slice(0, 3).map((watchlist) => ({
            label: "Activated",
            title: watchlist.targetLabel,
            detail: "Activation scan complete",
          })),
          hasMetrics,
        };
      }

      return {
        state: "queued",
        kicker: "Market Desk Brief",
        title: "Watching for the next change",
        summary: "Your watchlist is ready. Refresh tracking to save evidence when the landing page or offer changes.",
        action: { href: "/app/watchlists", label: "Open watchlists" },
        metrics,
        items: activeWatchlists.slice(0, 3).map((watchlist) => ({
          label: "Watching",
          title: watchlist.targetLabel,
          detail: "Already has scan history",
        })),
        hasMetrics,
      };
    }

    return {
      state: "queued",
      kicker: "Market Desk Brief",
      title: isFreePlan ? "Activation scan is queued" : "First sweep is queued",
      summary: isFreePlan
        ? `${activeCount} competitor${activeCount === 1 ? "" : "s"} ${activeCount === 1 ? "is" : "are"} ready for one activation-only scan. Paid plans include recurring monitoring.`
        : `${activeCount} competitor${activeCount === 1 ? "" : "s"} ${activeCount === 1 ? "is" : "are"} ready. Scheduled checks run ${input.nextScanLabel}.`,
      action: { href: "/app/watchlists", label: "Open watchlists" },
      metrics,
      items: activeWatchlists.slice(0, 3).map((watchlist) => ({
        label: "Queued",
        title: watchlist.targetLabel,
        detail: watchlist.lastScannedAt ? "Already has scan history" : "First scan pending",
      })),
      hasMetrics,
    };
  }

  return {
    state: "empty",
    kicker: "Market Desk Brief",
    title: "Build your Market Desk",
    summary: isFreePlan
      ? "Add your first competitor for one activation-only scan. Paid plans include recurring monitoring and digests."
      : "Add your first competitor or paste several at once, then Five to Nine turns daily checks into a source-backed brief.",
    action: { href: "/app/onboard?resume=1", label: "Add competitors" },
    metrics,
    items: [],
    hasMetrics,
  };
}
