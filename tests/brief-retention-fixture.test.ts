import { describe, expect, it } from "vitest";

import { deriveBriefRetentionFields } from "~/lib/brief-retention";
import {
  buildDigestEmail,
  type DigestEmailHeartbeat,
} from "~/lib/digest-email.server";
import { buildMarketDeskBrief } from "~/lib/market-desk-brief";
import type { DigestTrustItem } from "~/lib/proof-classification";
import type {
  DigestRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

/*
 * Brief-as-retention-loop fixture (lane 1, m4, 2026-08-20): one landing-page
 * change and one unchanged run threaded through the same period inputs the
 * orchestrator feeds — the filed events feed the Market Desk Brief and the
 * weekly digest email, and both surfaces must derive the same four retention
 * fields (material delta, owner, confidence, expiry) from data that is real
 * for that run. The changed run proves the retention frame on a delta; the
 * unchanged run proves the all-quiet heartbeat still names what was checked
 * and when it expires instead of silently dropping the frame.
 */

function watchlist(input: Partial<WatchlistRecord> = {}): WatchlistRecord {
  return {
    id: input.id ?? "watch-1",
    userId: "user-1",
    name: input.name ?? "Nykaa watch",
    targetType: input.targetType ?? "advertiser",
    trackingRole: input.trackingRole ?? "competitor",
    targetId: input.targetId ?? "https://www.nykaa.com",
    targetFingerprint: input.targetFingerprint ?? "fingerprint-1",
    targetLabel: input.targetLabel ?? "Nykaa",
    targetCountry: input.targetCountry ?? "in",
    isActive: input.isActive ?? true,
    lastScannedAt: input.lastScannedAt ?? "2026-08-14T03:00:00.000Z",
    createdAt: input.createdAt ?? "2026-08-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-08-01T00:00:00.000Z",
  };
}

function landingChangeEvent(
  input: Partial<WatchEventRecord> = {},
): WatchEventRecord {
  return {
    id: input.id ?? "event-change-1",
    watchlistId: input.watchlistId ?? "watch-1",
    runId: input.runId ?? "run-2026-08-14",
    eventType: input.eventType ?? "landing_page_offer_changed",
    status: input.status ?? "confirmed",
    importanceScore: input.importanceScore ?? 90,
    adId: input.adId ?? null,
    baselineFromRunId: input.baselineFromRunId ?? null,
    candidateId: input.candidateId ?? null,
    proofCaptureId: input.proofCaptureId ?? "proof-1",
    title: input.title ?? "Nykaa changed its landing page offer",
    summary:
      input.summary ??
      "Landing page offer changed from \"Flat 30% off\" to \"Flat 40% off\".",
    metadata: input.metadata ?? {
      proofCaptureId: "proof-1",
      sourceStatus: "proof_backed",
      beforeCreativeImageUrl: "https://proof.0509.io/before-1.png",
      afterCreativeImageUrl: "https://proof.0509.io/after-1.png",
      from: "Flat 30% off",
      to: "Flat 40% off",
      sourceUrl: "https://www.nykaa.com",
      capturedAt: "2026-08-14T03:00:00.000Z",
      confirmedAt: "2026-08-14T03:00:00.000Z",
    },
    confirmedAt: input.confirmedAt ?? "2026-08-14T03:00:00.000Z",
    suppressedAt: input.suppressedAt ?? null,
    invalidatedAt: input.invalidatedAt ?? null,
    lastEvaluatedAt: input.lastEvaluatedAt ?? "2026-08-14T03:00:00.000Z",
    createdAt: input.createdAt ?? "2026-08-14T03:00:00.000Z",
  };
}

function previousDigest(items: DigestRecord["items"] = []): DigestRecord {
  return {
    id: "prev-1",
    userId: "user-1",
    periodStart: "2026-08-03T00:00:00.000Z",
    periodEnd: "2026-08-10T00:00:00.000Z",
    createdAt: "2026-08-10T01:00:00.000Z",
    items,
    delivery: null,
  };
}

function previousDigestItem(): DigestRecord["items"][number] {
  return {
    id: "prev-item-1",
    digestRunId: "prev-1",
    watchlistId: "watch-1",
    watchlistName: "Nykaa",
    eventType: "landing_page_offer_changed",
    title: "Nykaa changed its landing page offer",
    summary: "Offer shifted from \"Flat 25% off\" to \"Flat 30% off\".",
    metadata: {
      proofCaptureId: "proof-0",
      sourceStatus: "proof_backed",
    },
    createdAt: "2026-08-10T01:00:00.000Z",
  };
}

function digestTrustItem(): DigestTrustItem {
  return {
    watchlistId: "watch-1",
    watchlistName: "Nykaa",
    eventId: "event-change-1",
    eventType: "landing_page_offer_changed",
    title: "Nykaa changed its landing page offer",
    summary: "Landing page offer changed from \"Flat 30% off\" to \"Flat 40% off\".",
    createdAt: "2026-08-14T03:00:00.000Z",
    metadata: {
      priorityScore: 90,
      priorityBand: "High priority",
      recommendedAction: "Review before the next campaign decision.",
      proofTrail: "Verified from a page snapshot",
      proofCaptureId: "proof-1",
      sourceStatus: "proof_backed",
      beforeCreativeImageUrl: "https://proof.0509.io/before-1.png",
      afterCreativeImageUrl: "https://proof.0509.io/after-1.png",
      from: "Flat 30% off",
      to: "Flat 40% off",
      sourceUrl: "https://www.nykaa.com",
      confirmedAt: "2026-08-14T03:00:00.000Z",
    },
  };
}

function weeklyEmailInput(
  items: DigestTrustItem[],
  options: {
    previousBriefItemCount?: number | null;
    hasPreviousBrief?: boolean | null;
    heartbeat?: DigestEmailHeartbeat | null;
  } = {},
) {
  return {
    name: "Priya",
    periodStart: "2026-08-10T00:00:00.000Z",
    periodEnd: "2026-08-14T03:00:00.000Z",
    items,
    heartbeat: options.heartbeat ?? null,
    cadence: "weekly" as const,
    timeZone: "UTC",
    fullDigestUrl: "https://0509.io/app/digests",
    manageFrequencyUrl: "https://0509.io/app/notifications",
    supportEmail: "support@0509.io",
    supportMailto: "mailto:support@0509.io",
    unsubscribeUrl: null,
    previousBriefItemCount: options.previousBriefItemCount ?? null,
    hasPreviousBrief: options.hasPreviousBrief ?? null,
    nextScanAt: "2026-08-21T03:00:00.000Z",
    nextScanLabel: "Fri 21 Aug, 3:00 am UTC",
  };
}

describe("brief retention fixture — one landing-page change and one unchanged run", () => {
  it("runs the changed run through event, brief, and email with the full retention frame", () => {
    const changedEvent = landingChangeEvent();
    const previousDigestRecord = previousDigest([previousDigestItem()]);
    const activeWatchlist = watchlist();

    const brief = buildMarketDeskBrief({
      watchlists: [activeWatchlist],
      recentEvents: [changedEvent],
      counterMoveFollowUps: [],
      digests: [previousDigestRecord],
      proofUsage: { used: 1, limit: 50, remaining: 49 },
      overnightStats: { runs: 1, watchlistsChecked: 1, adsSeen: 12 },
      successfulProofCount: 1,
      nextScanLabel: "Fri 21 Aug, 3:00 am UTC",
      plan: "starter",
      ownerName: "Priya",
      nextScanAt: "2026-08-21T03:00:00.000Z",
    });

    // The dashboard brief's delta is a first-brief baseline here: the
    // Market Desk input carries only the current digest, so no previous
    // brief comparison is on file — the retention frame must say so
    // instead of inventing a delta.
    expect(brief.state).toBe("changes");
    expect(brief.retention.delta).toContain("1 change filed");
    expect(brief.retention.delta).toContain("first brief on file");
    expect(brief.retention.owner).toBe("Priya");
    expect(brief.retention.confidence).toBe("high");
    expect(brief.retention.expiry).toContain(
      "Expires at the next check — Fri 21 Aug, 3:00 am UTC.",
    );
    expect(brief.retention.hasAllFields).toBe(false);

    const email = buildDigestEmail(
      weeklyEmailInput([digestTrustItem()], {
        previousBriefItemCount: 1,
        hasPreviousBrief: true,
      }),
    );

    expect(email.html).toContain("Brief retention");
    expect(email.html).toContain("Since last brief:");
    expect(email.html).toContain("Accountable reviewer:");
    expect(email.html).toContain("Priya");
    expect(email.html).toContain("High confidence");
    expect(email.html).toContain(
      "Expires at the next check — Fri 21 Aug, 3:00 am UTC.",
    );
    expect(email.text).toContain("Brief retention:");
    expect(email.text).toContain("Since last brief: 1 change filed");
  });

  it("runs the unchanged run through brief and email as an all-quiet heartbeat, never silence", () => {
    const activeWatchlist = watchlist();
    const previousDigestRecord = previousDigest([previousDigestItem()]);

    const brief = buildMarketDeskBrief({
      watchlists: [activeWatchlist],
      recentEvents: [],
      counterMoveFollowUps: [],
      digests: [previousDigestRecord],
      proofUsage: { used: 1, limit: 50, remaining: 49 },
      overnightStats: { runs: 1, watchlistsChecked: 1, adsSeen: 12 },
      successfulProofCount: 1,
      nextScanLabel: "Fri 21 Aug, 3:00 am UTC",
      plan: "starter",
      ownerName: "Priya",
      nextScanAt: "2026-08-21T03:00:00.000Z",
    });

    expect(brief.state).toBe("quiet");
    expect(brief.summary).toContain("All quiet");
    expect(brief.retention.delta).toContain("No filed changes this period");
    expect(brief.retention.owner).toBe("Priya");
    expect(brief.retention.expiry).toContain(
      "Expires at the next check — Fri 21 Aug, 3:00 am UTC.",
    );

    const email = buildDigestEmail(
      weeklyEmailInput([], {
        previousBriefItemCount: 1,
        hasPreviousBrief: true,
        heartbeat: {
          runs: 1,
          watchlistsChecked: 1,
          adsSeen: 12,
          triage: {
            status: "all_quiet",
            label: "All quiet",
            explanation: "Checks completed and nothing changed across the sources that ran.",
            checkedAt: "2026-08-14T03:00:00.000Z",
            checksCompleted: 1,
            suppressedChanges: 0,
            suppressionReasons: [],
            nextAction: "We check again at the next scheduled scan.",
            noActionLine: "No action needed — nothing new to act on.",
          },
        },
      }),
    );

    expect(email.subject).toContain("All quiet");
    expect(email.html).toContain("All quiet");
    expect(email.html).toContain("Brief retention");
    expect(email.html).toContain("Since last brief:");
    expect(email.html).toContain("Accountable reviewer:");
    expect(email.html).toContain("Priya");
    expect(email.html).toContain("Expiry:");
    expect(email.text).toContain("All quiet");
    expect(email.text).toContain("Brief retention:");
    expect(email.text).toContain("No filed changes this period");
  });

  it("keeps the retention fields consistent between brief and email for the same run", () => {
    const changedEvent = landingChangeEvent();
    const previousDigestRecord = previousDigest([previousDigestItem()]);
    const activeWatchlist = watchlist();

    const brief = buildMarketDeskBrief({
      watchlists: [activeWatchlist],
      recentEvents: [changedEvent],
      counterMoveFollowUps: [],
      digests: [previousDigestRecord],
      proofUsage: { used: 1, limit: 50, remaining: 49 },
      overnightStats: { runs: 1, watchlistsChecked: 1, adsSeen: 12 },
      successfulProofCount: 1,
      nextScanLabel: "Fri 21 Aug, 3:00 am UTC",
      plan: "starter",
      ownerName: "Priya",
      nextScanAt: "2026-08-21T03:00:00.000Z",
    });

    const email = buildDigestEmail(
      weeklyEmailInput([digestTrustItem()], {
        previousBriefItemCount: 1,
        hasPreviousBrief: true,
      }),
    );

    // The dashboard brief (no previous digest on file) and the email (with
    // one) differ only where truth differs: the email's delta compares to a
    // real previous brief, the dashboard's says first-brief baseline. Owner,
    // confidence, and expiry must still match.
    expect(email.html).toContain(brief.retention.owner);
    expect(email.html).toContain(brief.retention.expiry);
    expect(email.html).toContain(brief.retention.confidenceLabel);

    const derivedFromEmailItems = deriveBriefRetentionFields({
      items: [digestTrustItem()],
      previousBriefItemCount: 1,
      ownerName: "Priya",
      nextScanAt: "2026-08-21T03:00:00.000Z",
      nextScanLabel: "Fri 21 Aug, 3:00 am UTC",
    });
    expect(derivedFromEmailItems.owner).toBe(brief.retention.owner);
    expect(derivedFromEmailItems.confidence).toBe(brief.retention.confidence);
    expect(derivedFromEmailItems.expiry).toBe(brief.retention.expiry);
  });
});
