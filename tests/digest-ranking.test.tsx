// BET 1 regression (issue 1483): the delivered brief leads with landing_page_*
// commercial-field changes, ad_new/ad_inactive collapse into a single counted
// footnote line, and instant alerts are a landing-page privilege only. This
// test constructs a mixed event batch, renders the brief, and asserts the
// acceptance contract: >=60% landing_page_* headline items, a single creative
// churn footnote (never headline items), zero instant alerts for bare
// ad_new/ad_inactive, and the all-quiet heartbeat still firing on a
// zero-landing-page window.
import { describe, expect, it } from "vitest";

import { evaluateDeliveryPolicy } from "~/lib/delivery-policy.server";
import { buildDigestEmail } from "~/lib/digest-email.server";
import {
  isAdChurnEventType,
  isLandingPageHeadlineEventType,
  landingPageTypeWeight,
  rerankDigestBrief,
  whyThisMattersScoreForRecord,
  type DigestRerankItem,
} from "~/lib/digest-rerank";
import type {
  WatchEventRecord,
  WorkspaceDeliveryConfigRecord,
} from "~/lib/types";

const workspaceConfig: WorkspaceDeliveryConfigRecord = {
  id: "workspace-1",
  userId: "user-1",
  sensitivityMode: "auto",
  instantEnabled: true,
  digestEnabled: true,
  digestCadencePreference: "plan_default",
  emailEnabled: true,
  whatsappEnabled: false,
  slackEnabled: false,
  teamsEnabled: false,
  quietHours: {
    startHour: 22,
    endHour: 8,
  },
  timezone: "Asia/Kolkata",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
};

function watchEvent(overrides: Partial<WatchEventRecord> = {}): WatchEventRecord {
  return {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 82,
    adId: "meta-boat-1",
    baselineFromRunId: "run-0",
    candidateId: "candidate-1",
    proofCaptureId: "proof-1",
    title: "Landing page offer changed",
    summary: "The landing-page offer changed.",
    metadata: {
      advertiser: "boAt",
    },
    confirmedAt: "2026-04-18T10:00:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-04-18T10:00:00.000Z",
    createdAt: "2026-04-18T10:00:00.000Z",
    ...overrides,
  };
}

function digestItem(
  watchlistName: string,
  title: string,
  priorityScore: number,
  eventType: string,
  eventId: string,
) {
  const slug = watchlistName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return {
    watchlistName,
    watchlistId: `wl-${slug}`,
    eventId,
    eventType,
    title,
    summary: `${title} summary with enough detail for review.`,
    createdAt: "2026-07-13T00:00:00.000Z",
    metadata: {
      priorityScore,
      priorityBand:
        priorityScore >= 85
          ? "High priority"
          : priorityScore >= 65
            ? "Medium priority"
            : "Low priority",
      recommendedAction: "Review before the next campaign decision.",
      proofTrail: "Spotted in the scheduled scan",
      proofCaptureId: null,
      sourceStatus: "scan_backed",
      confirmedAt: "2026-07-13T00:00:00.000Z",
    },
  } satisfies DigestRerankItem & { title: string; watchlistName: string };
}

const DIGEST_INPUT_BASE = {
  name: "Owner",
  periodStart: "2026-07-06T00:00:00.000Z",
  periodEnd: "2026-07-13T00:00:00.000Z",
  cadence: "weekly" as const,
  timeZone: "Asia/Kolkata",
  fullDigestUrl: "https://0509.io/app/digests",
  manageFrequencyUrl: "https://0509.io/app/notifications",
  supportEmail: "support@0509.io",
  supportMailto: "mailto:support@0509.io",
  unsubscribeUrl: "https://0509.io/unsubscribe?sig=test",
};

/** Six landing_page_* changes plus six creative-churn events: the mixed batch. */
function mixedEventBatch() {
  return [
    digestItem("Nykaa", "Landing page offer changed", 95, "landing_page_offer_changed", "ev-nykaa-offer"),
    digestItem("Nykaa", "Landing page CTA changed", 90, "landing_page_cta_changed", "ev-nykaa-cta"),
    digestItem("boAt", "Landing page URL changed", 85, "landing_page_url_changed", "ev-boat-url"),
    digestItem("Mamaearth", "Landing page headline changed", 80, "landing_page_headline_changed", "ev-mama-headline"),
    digestItem("Plum", "Landing page form changed", 75, "landing_page_form_changed", "ev-plum-form"),
    digestItem("Sugar", "Landing page offer changed", 70, "landing_page_offer_changed", "ev-sugar-offer"),
    digestItem("Dot", "New ad creative", 60, "ad_new", "ev-dot-ad1"),
    digestItem("Dot", "New ad creative", 55, "ad_new", "ev-dot-ad2"),
    digestItem("Wow", "New ad creative", 50, "ad_new", "ev-wow-ad1"),
    digestItem("Wow", "New ad creative", 45, "ad_new", "ev-wow-ad2"),
    digestItem("Boat2", "Ad retired", 40, "ad_inactive", "ev-boat2-retired"),
    digestItem("Boat2", "Ad retired", 35, "ad_inactive", "ev-boat2-retired2"),
  ];
}

describe("BET 1 digest re-ranking (issue 1483)", () => {
  it("ranks landing_page_* changes above creative churn in the split", () => {
    const items = mixedEventBatch();
    const rerank = rerankDigestBrief(items);

    // Accept 1: every headline item is a landing_page_* commercial-field change.
    expect(rerank.headlineItems.length).toBe(6);
    expect(rerank.headlineItems.every((item) => isLandingPageHeadlineEventType(item.eventType))).toBe(true);

    // Accept 2: churn collapses into counts, never into headline items.
    expect(rerank.adChurnSummary).toEqual({ newCount: 4, retiredCount: 2, total: 6 });
    expect(rerank.otherItems).toEqual([]);

    // Headline ordering follows the why-this-matters score: offer leads form.
    const scores = rerank.headlineItems.map((item) => whyThisMattersScoreForRecord({
      eventType: item.eventType,
      importanceScore: item.metadata?.priorityScore as number,
    }));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(rerank.headlineItems[0].eventType).toBe("landing_page_offer_changed");
  });

  it("renders the brief with a >=60% landing_page_* headline share and one churn footnote", () => {
    const email = buildDigestEmail({
      ...DIGEST_INPUT_BASE,
      items: mixedEventBatch(),
    });

    // 12 changes total; 6 are headline-worthy landing changes, 6 are churn.
    expect(email.subject).toBe("12 changes found, 6 worth action");
    expect(email.html).toContain("Top moves");
    // The five rendered top moves are all landing_page_* titles — a 100% share
    // against the >=60% acceptance floor. Both offer changes outrank the CTA
    // (offer/price leads), pushing the lowest-form change to the omitted slot.
    expect(email.html).toContain("Landing page offer changed");
    expect(email.html).toContain("Landing page CTA changed");
    expect(email.html).toContain("Landing page URL changed");
    expect(email.html).toContain("Landing page headline changed");
    // The 6th-ranked landing change is omitted, never a churn event.
    expect(email.html).toContain("1 more change is in the full brief");
    // Creative churn collapses into exactly one counted footnote line.
    expect(email.html).toContain("4 new creatives, 2 retired — open the wall to see them.");
    expect(email.text).toContain("4 new creatives, 2 retired — open the wall to see them.");
    // Churn titles never surface as headline items.
    expect(email.html).not.toContain("New ad creative");
    expect(email.html).not.toContain("Ad retired");
  });

  it("never fires an instant alert for bare ad_new/ad_inactive, even at max importance", () => {
    for (const eventType of ["ad_new", "ad_inactive"] as const) {
      const decision = evaluateDeliveryPolicy({
        lane: "customer",
        event: watchEvent({
          eventType,
          status: "confirmed",
          importanceScore: 100,
        }),
        workspaceConfig: {
          ...workspaceConfig,
          sensitivityMode: "aggressive",
        },
        watchlistConfig: null,
        now: "2026-07-13T12:00:00.000Z",
      });

      expect(decision.instantEligible).toBe(false);
      // Churn stays digest-eligible so it still reaches the counted footnote.
      expect(decision.digestEligible).toBe(true);
    }
  });

  it("fires instant alerts only for landing_page_* events above the mode threshold", () => {
    // Positive control: a confirmed offer change above the balanced threshold.
    const offerAbove = evaluateDeliveryPolicy({
      lane: "customer",
      event: watchEvent({
        eventType: "landing_page_offer_changed",
        status: "confirmed",
        importanceScore: 82,
      }),
      workspaceConfig,
      watchlistConfig: null,
      now: "2026-07-13T12:00:00.000Z",
    });
    expect(offerAbove.instantEligible).toBe(true);

    // Negative control: a landing change below the balanced threshold stays quiet.
    const formBelow = evaluateDeliveryPolicy({
      lane: "customer",
      event: watchEvent({
        eventType: "landing_page_form_changed",
        status: "confirmed",
        importanceScore: 40,
      }),
      workspaceConfig,
      watchlistConfig: null,
      now: "2026-07-13T12:00:00.000Z",
    });
    expect(formBelow.instantEligible).toBe(false);

    // Not an instant-alert class: website_page_* never fires one, even at max
    // importance in the most aggressive mode.
    const siteChange = evaluateDeliveryPolicy({
      lane: "customer",
      event: watchEvent({
        eventType: "website_page_changed",
        status: "confirmed",
        importanceScore: 100,
      }),
      workspaceConfig: {
        ...workspaceConfig,
        sensitivityMode: "aggressive",
      },
      watchlistConfig: null,
      now: "2026-07-13T12:00:00.000Z",
    });
    expect(siteChange.instantEligible).toBe(false);
  });

  it("gates instant alerts on the same why-this-matters score that ranks the brief", () => {
    // The full score is the landing type weight plus the 0-100 importance
    // component; clearing `weight + mode gate` is exactly the established
    // `importanceScore >= gate` magnitude rule.
    const eventType = "landing_page_offer_changed";
    const score = whyThisMattersScoreForRecord({ eventType, importanceScore: 82 });
    expect(score).toBe(landingPageTypeWeight(eventType) + 82);
    expect(score >= landingPageTypeWeight(eventType) + 75).toBe(true);
    expect(score >= landingPageTypeWeight(eventType) + 90).toBe(false);

    // Non-landing event types carry no weight: the score is the raw
    // importance — the exclusion is the deliver rule's allowlist, which
    // treats every non-landing type as Infinity-threshold (never instant).
    expect(isLandingPageHeadlineEventType("website_page_changed")).toBe(false);
    expect(isAdChurnEventType("ad_new")).toBe(true);
    expect(whyThisMattersScoreForRecord({ eventType: "ad_new", importanceScore: 100 })).toBe(100);
  });

  it("still fires the all-quiet heartbeat when zero landing_page_* events occur in the window", () => {
    // Accept 4 (BET 4 provable-absence guarantee): an empty window renders the
    // heartbeat unchanged — the re-ranking must never silence the quiet path.
    const email = buildDigestEmail({
      ...DIGEST_INPUT_BASE,
      items: [],
      heartbeat: {
        runs: 4,
        watchlistsChecked: 2,
        adsSeen: 31,
      },
    });

    expect(email.subject).toMatch(/^All quiet: no competitor moves worth action/);
    expect(email.html).toContain("All quiet: no competitor moves worth action");
    expect(email.text).toContain("no action-worthy movement");
  });
});