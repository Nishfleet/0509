import {
  deriveBriefRetentionFields,
  type BriefRetentionFields,
} from "~/lib/brief-retention";
import type { DigestRecord, WatchEventRecord, WatchlistRecord } from "~/lib/types";

export interface MarketDeskBriefFollowUp {
  title: string;
  ownerLabel?: string | null;
  channelLabel?: string | null;
  openCount?: number | null;
}

/** Same-session first value: latest first-scan run state per watchlist. */
export interface MarketDeskBriefFirstScanState {
  watchlistId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  errorCode?: string | null;
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
  /**
    * Brief-as-retention-loop (lane 1, 2026-08-14): workspace owner identity
    * the dashboard loader already has on hand, used to render the brief's
    * accountable reviewer field without inventing it from event text.
    */
  ownerName?: string | null;
  /**
    * ISO timestamp of the next scheduled scan after this brief, when one is
    * already known. Used to derive the brief's expiry field.
    */
  nextScanAt?: string | null;
  firstScanStates?: MarketDeskBriefFirstScanState[] | null;
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
  /**
   * Brief-as-retention-loop (lane 1, 2026-08-14): the four retention fields
   * the brief must always carry — material delta, owner, confidence, expiry.
   * The dashboard renders this frame directly below the brief summary.
   */
  retention: BriefRetentionFields;
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
  // "Moves found" is a proof claim. Only confirmed events may increment it —
  // detected events are provisional signals that invite review but must not
  // enter the confirmed count or drive the daily action as if proven.
  const confirmedChanges = recentEvents.filter((event) => event.status === "confirmed");
  const provisionalChanges = recentEvents.filter(
    (event) => event.status === "detected" || event.status === "proof_pending",
  );
  const failedChecks = recentEvents.filter((event) => event.status === "proof_failed");
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
          : provisionalChanges.length > 0
            ? `${provisionalChanges.length} possible ${provisionalChanges.length === 1 ? "change" : "changes"} still unproven`
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
      label: "Briefs sent",
      value: sentDigests,
      detail: sentDigests > 0
        ? "Email trail active"
        : isFreePlan
          ? "Weekly brief lands Monday"
          : "No digest sent yet",
    },
  ];
  const hasMetrics =
    competitorCount > 0 ||
    confirmedChanges.length > 0 ||
    input.successfulProofCount > 0 ||
    sentDigests > 0;
  // Brief-as-retention-loop (lane 1, 2026-08-14): every brief carries the
  // four retention fields derived from the same period inputs. The frame
  // stays truthful when items or previous-brief are absent — the helper
  // renders explicit unavailable copy instead of inventing content.
  const retention = deriveBriefRetentionFields({
    items: recentEvents,
    previousBrief: input.digests?.[1] ?? null,
    ownerName: input.ownerName ?? null,
    nextScanAt: input.nextScanAt ?? null,
    nextScanLabel: input.nextScanLabel,
    sourceDegraded: !sourceHealthy,
  });

  if (input.counterMoveFollowUps.length > 0) {
    const count = input.counterMoveFollowUps.length;
    return {
      state: "follow_up",
      kicker: "Brief",
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
      retention,
    };
  }

  if (confirmedChanges.length > 0) {
    const count = confirmedChanges.length;
    return {
      state: "changes",
      kicker: "Brief",
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
      retention,
    };
  }

  // Provisional-only state: something was spotted but nothing is proven yet.
  // The copy claims a check, not a move — a "move" needs stored proof.
  if (provisionalChanges.length > 0) {
    const count = provisionalChanges.length;
    return {
      state: "changes",
      kicker: "Brief",
      title: `${count} possible ${count === 1 ? "change" : "changes"} to check`,
      summary: "We spotted something but have not confirmed it with stored proof yet. Open the trail and check it before acting on it.",
      action: { href: "/app/watchlists", label: "Check the signals" },
      metrics,
      items: provisionalChanges.slice(0, 3).map((event) => ({
        label: event.eventType.replaceAll("_", " "),
        title: event.title,
        detail: event.summary,
      })),
      hasMetrics,
      retention,
    };
  }

  // A failed check can never fall through to a quiet claim: quiet is a
  // proof statement, and a failed check is missing exactly that proof.
  if (failedChecks.length > 0) {
    const count = failedChecks.length;
    return {
      state: "queued",
      kicker: "Brief",
      title: `${count} check${count === 1 ? "" : "s"} failed`,
      summary: "A recent check could not finish, so this period cannot be called quiet. We retry automatically; open the trail to see what failed.",
      action: { href: "/app/watchlists", label: "See what failed" },
      metrics,
      items: failedChecks.slice(0, 3).map((event) => ({
        label: event.eventType.replaceAll("_", " "),
        title: event.title,
        detail: event.summary,
      })),
      hasMetrics,
      retention,
    };
  }

  if (hasOvernightCheck) {
    if (!sourceHealthy) {
      return {
        state: "queued",
        kicker: "Brief",
        title: "Source access needs attention",
        summary: "The latest check cannot be treated as a quiet result while commercial source access is degraded or unavailable. Review Source access before relying on this brief.",
        action: { href: "/app/source-access", label: "Open Source access" },
        metrics,
        items: [],
        hasMetrics,
        retention,
      };
    }

    if (isFreePlan) {
      return {
        state: "quiet",
        kicker: "Brief",
        title: "Weekly check complete",
        summary: `We checked ${overnightScope} — nothing moved. The next weekly check runs Monday. Paid plans check every 3–6 hours and add instant alerts.`,
        action: { href: "/app/watchlists", label: "Review watchlists" },
        metrics,
        items: activeWatchlists.slice(0, 3).map((watchlist) => ({
          label: "Watched",
          title: watchlist.targetLabel,
          detail: watchlist.lastScannedAt ? "Checked this week" : "Waiting for its first weekly check",
        })),
        hasMetrics,
        retention,
      };
    }

    return {
      state: "quiet",
      kicker: "Brief",
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
      retention,
    };
  }

  if (hasOnlyPausedWatchlists) {
    return {
      state: "paused",
      kicker: "Brief",
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
      retention,
    };
  }

  if (activeCount > 0) {
    if (hasScanHistory) {
      if (isFreePlan) {
        return {
          state: "queued",
          kicker: "Brief",
          title: "Activation check complete",
          summary: "Your activation scan is complete. Free checks this competitor weekly and emails a weekly brief; paid plans check every 3–6 hours.",
          action: { href: "/app/billing?source=dashboard#plans", label: "View paid plans" },
          metrics,
          items: activeWatchlists.slice(0, 3).map((watchlist) => ({
            label: "Activated",
            title: watchlist.targetLabel,
            detail: "Activation scan complete",
          })),
          hasMetrics,
          retention,
        };
      }

      return {
        state: "queued",
        kicker: "Brief",
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
        retention,
      };
    }

    // No successful scan yet — the first-scan run states (when available)
    // make the queued claim live instead of static, so the signup session
    // knows the check is running now and that results land here.
    const stateByWatchlistId = new Map(
      (input.firstScanStates ?? []).map((state) => [state.watchlistId, state]),
    );
    const pendingOrRunning = activeWatchlists.some((watchlist) => {
      const state = stateByWatchlistId.get(watchlist.id);
      return state?.status === "pending" || state?.status === "running";
    });
    const runningNow = activeWatchlists.some((watchlist) =>
      stateByWatchlistId.get(watchlist.id)?.status === "running",
    );
    const itemDetail = (watchlist: WatchlistRecord) => {
      const state = stateByWatchlistId.get(watchlist.id);
      if (state?.status === "running") return "First scan running now — results land here";
      if (state?.status === "pending") return "First scan starts shortly";
      if (state?.status === "failed") return "First scan couldn't finish — open for next steps";
      if (state?.status === "skipped") return "First scan paused before results — open for details";
      return "First scan pending";
    };
    if (pendingOrRunning) {
      return {
        state: "queued",
        kicker: "Brief",
        title: runningNow
          ? (isFreePlan ? "Activation scan is running now" : "First sweep is running now")
          : (isFreePlan ? "Activation scan starts shortly" : "First sweep starts shortly"),
        summary: runningNow
          ? (isFreePlan
              ? `Your activation scan is running now — results and your first mini-brief land here automatically. After this, free checks this competitor weekly and emails a weekly brief; paid plans check every 3–6 hours.`
              : `Your first scan is running now — results and your first mini-brief land here automatically.`)
          : (isFreePlan
              ? `${activeCount} competitor${activeCount === 1 ? "" : "s"} ${activeCount === 1 ? "is" : "are"} ready. The activation scan starts automatically, and results land here the moment it completes.`
              : `${activeCount} competitor${activeCount === 1 ? "" : "s"} ${activeCount === 1 ? "is" : "are"} ready. The first scan starts automatically, and results land here the moment it completes.`),
        action: { href: "/app/watchlists", label: "Open watchlists" },
        metrics,
        items: activeWatchlists.slice(0, 3).map((watchlist) => ({
          label: runningNow ? "Scanning" : "Queued",
          title: watchlist.targetLabel,
          detail: itemDetail(watchlist),
        })),
        hasMetrics,
        retention,
      };
    }

    return {
      state: "queued",
      kicker: "Brief",
      title: isFreePlan ? "Activation scan is queued" : "First sweep is queued",
      summary: isFreePlan
        ? `${activeCount} competitor${activeCount === 1 ? "" : "s"} ${activeCount === 1 ? "is" : "are"} ready for the activation scan, then a weekly check. Paid plans check every 3–6 hours.`
        : `${activeCount} competitor${activeCount === 1 ? "" : "s"} ${activeCount === 1 ? "is" : "are"} ready. Scheduled checks run ${input.nextScanLabel}.`,
      action: { href: "/app/watchlists", label: "Open watchlists" },
      metrics,
      items: activeWatchlists.slice(0, 3).map((watchlist) => ({
        label: "Queued",
        title: watchlist.targetLabel,
        detail: itemDetail(watchlist),
      })),
      hasMetrics,
      retention,
    };
  }

  return {
    state: "empty",
    kicker: "Brief",
    title: "Build your brief",
    summary: isFreePlan
      ? "Add your first competitor — free watches it with a weekly check and a weekly email brief. Paid plans check every 3–6 hours."
      : "Add your first competitor or paste several at once, then Five to Nine turns daily checks into a source-backed brief.",
    action: { href: "/app#setup-checklist", label: "Add competitors" },
    metrics,
    items: [],
    hasMetrics,
    retention,
  };
}
