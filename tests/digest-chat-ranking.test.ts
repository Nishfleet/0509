// BET 1 digest re-ranking on the chat channels (issue 2053). The email digest
// already leads with landing_page_* commercial-field changes and collapses
// ad_new/ad_inactive into a single counted footnote line. The Slack/Teams
// digest renderers previously listed items in stored order, so a digest
// delivered on the chat channels could still lead with "new ad" pings. This
// test pins the chat digest to the same ranked brief: landing-page changes
// headline (offer first), ad churn collapses to one counted line, and a pure
// ad-churn batch renders zero headline bullets.
import { describe, expect, it } from "vitest";

import {
  renderDigestSlackText,
  renderDigestTeamsText,
  type DigestDeliveryItem,
} from "~/lib/delivery.server";

function chatItem(
  watchlistName: string,
  title: string,
  eventType: string,
  priorityScore: number,
): DigestDeliveryItem {
  return {
    eventId: `ev-${watchlistName}-${eventType}-${priorityScore}`,
    watchlistId: `wl-${watchlistName.toLowerCase()}`,
    watchlistName,
    eventType,
    title,
    summary: `${title} summary.`,
    metadata: {
      priorityScore,
      priorityBand: priorityScore >= 85 ? "High priority" : "Medium priority",
      recommendedAction: "Review before the next campaign decision.",
      proofTrail: "Spotted in the scheduled scan",
    },
  };
}

function mixedBatch(): DigestDeliveryItem[] {
  // Churn items are listed first in stored order — the regression this pins.
  return [
    chatItem("Dot", "New ad creative", "ad_new", 95),
    chatItem("Wow", "New ad creative", "ad_new", 92),
    chatItem("Boat2", "Ad retired", "ad_inactive", 40),
    chatItem("Nykaa", "Landing page offer changed", "landing_page_offer_changed", 80),
    chatItem("Plum", "Landing page CTA changed", "landing_page_cta_changed", 75),
    chatItem("Mamaearth", "Landing page headline changed", "landing_page_headline_changed", 70),
  ];
}

const base = {
  periodStart: "2026-07-06T00:00:00.000Z",
  periodEnd: "2026-07-13T00:00:00.000Z",
  timeZone: "Asia/Kolkata",
} as const;

/** First index of a needle in the text, or Infinity when absent. */
function indexOf(text: string, needle: string): number {
  const idx = text.indexOf(needle);
  return idx < 0 ? Number.POSITIVE_INFINITY : idx;
}

/** Count of lines that surface a given title as a rendered item bullet. */
function bulletCount(text: string, title: string): number {
  return text.split("\n").filter((line) => line.includes(title)).length;
}

describe("chat digest re-ranking (issue 2053)", () => {
  it("leads the Slack brief with landing_page_* changes, offer first, and collapses churn", () => {
    const slack = renderDigestSlackText({ ...base, cadenceLabel: "weekly", items: mixedBatch() });

    // The landing offer surfaces before any churn item, even though the churn
    // items came first in stored order.
    expect(indexOf(slack, "Landing page offer changed")).toBeLessThan(
      indexOf(slack, "New ad creative"),
    );
    // Offer (weight 1000) leads CTA (800), which leads headline (600).
    expect(indexOf(slack, "Nykaa*: Landing page offer changed")).toBeLessThan(
      indexOf(slack, "Plum*: Landing page CTA changed"),
    );
    expect(indexOf(slack, "Plum*: Landing page CTA changed")).toBeLessThan(
      indexOf(slack, "Mamaearth*: Landing page headline changed"),
    );
    // Churn collapses into exactly one counted footnote line.
    expect(slack).toContain("2 new creatives, 1 retired — open the wall to see them.");
    // Churn titles never surface as rendered item bullets.
    expect(bulletCount(slack, "New ad creative")).toBe(0);
    expect(bulletCount(slack, "Ad retired")).toBe(0);
  });

  it("renders the same ranked/collapsed brief on Teams with its syntax", () => {
    const teams = renderDigestTeamsText({ ...base, cadenceLabel: "weekly", items: mixedBatch() });

    expect(indexOf(teams, "Landing page offer changed")).toBeLessThan(
      indexOf(teams, "New ad creative"),
    );
    expect(teams).toContain("2 new creatives, 1 retired — open the wall to see them.");
    expect(bulletCount(teams, "New ad creative")).toBe(0);
    // Teams bullets use **bold** watchlist labels.
    expect(teams).not.toContain("• **Dot");
  });

  it("collapses a pure ad-churn batch to a footnote with zero headline bullets", () => {
    const churnOnly = [
      chatItem("Dot", "New ad creative", "ad_new", 98),
      chatItem("Wow", "New ad creative", "ad_new", 90),
      chatItem("Boat2", "Ad retired", "ad_inactive", 44),
    ];
    const slack = renderDigestSlackText({ ...base, cadenceLabel: "daily", items: churnOnly });

    expect(slack).toContain("2 new creatives, 1 retired — open the wall to see them.");
    expect(bulletCount(slack, "New ad creative")).toBe(0);
    expect(bulletCount(slack, "Ad retired")).toBe(0);
  });
});