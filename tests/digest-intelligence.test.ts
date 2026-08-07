import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DesignedDigestBrief,
  DigestIntelligence,
  DigestMovementSummary,
  DigestProofPacket,
  resolveDigestDiffCaptures,
  resolveNewestMarkedDigestItem,
} from "~/components/digest-intelligence";

describe("DesignedDigestBrief", () => {
  const baseItem = {
    id: "item-1",
    title: "Offer changed",
    summary: "The competitor lowered the anchor price.",
    eventType: "landing_page_offer_changed",
    watchlistName: "Nykaa",
    createdAt: "2026-07-27T06:05:00.000Z",
    metadata: {
      from: "₹1,499",
      to: "₹1,199",
      priorityScore: 92,
      priorityBand: "High priority",
      proofCaptureId: "proof-1",
      confirmedAt: "2026-07-27T06:05:00.000Z",
    },
  };

  it("renders a diff only when both stored capture timestamps exist", () => {
    const complete = {
      ...baseItem,
      metadata: {
        ...baseItem.metadata,
        beforeCapturedAt: "2026-07-26T04:00:00.000Z",
      },
    };
    const markup = renderToStaticMarkup(
      createElement(DesignedDigestBrief, {
        id: "brief",
        periodStart: "2026-07-26T00:00:00.000Z",
        periodEnd: "2026-07-27T00:00:00.000Z",
        createdAt: "2026-07-27T07:00:00.000Z",
        items: [complete],
        allItems: [complete],
      }),
    );

    expect(markup).toContain("f9-wk-brief-change");
    expect(markup).toContain('dateTime="2026-07-26T04:00:00.000Z"');
    expect(markup).toContain('dateTime="2026-07-27T06:05:00.000Z"');
    expect(markup).toContain("This is the stored capture, not a re-render.");
  });

  it("degrades a from/to pair with one timestamp to one quiet line", () => {
    expect(resolveDigestDiffCaptures(baseItem)).toBeNull();
    const markup = renderToStaticMarkup(
      createElement(DesignedDigestBrief, {
        id: "brief",
        periodStart: "2026-07-26T00:00:00.000Z",
        periodEnd: "2026-07-27T00:00:00.000Z",
        createdAt: "2026-07-27T07:00:00.000Z",
        items: [baseItem],
        allItems: [baseItem],
      }),
    );

    expect(markup).not.toContain("f9-wk-brief-change");
    expect(markup).toContain("not two stored capture times");
    expect(markup.match(/f9-wk-brief-facts/g)).toHaveLength(1);
    expect(markup.match(/evidence unavailable/gi) ?? []).toHaveLength(0);
  });

  it("refuses a comparison when the supposed before capture is not earlier", () => {
    expect(
      resolveDigestDiffCaptures({
        ...baseItem,
        metadata: {
          ...baseItem.metadata,
          beforeCapturedAt: "2026-07-28T04:00:00.000Z",
        },
      }),
    ).toBeNull();
  });

  it("announces the newest complete comparison, not the first or highest-priority row", () => {
    const older = {
      ...baseItem,
      id: "older",
      metadata: {
        ...baseItem.metadata,
        priorityScore: 99,
        beforeCapturedAt: "2026-07-24T04:00:00.000Z",
        confirmedAt: "2026-07-25T04:00:00.000Z",
      },
    };
    const newest = {
      ...baseItem,
      id: "newest",
      metadata: {
        ...baseItem.metadata,
        priorityScore: 60,
        beforeCapturedAt: "2026-07-26T04:00:00.000Z",
        confirmedAt: "2026-07-27T04:00:00.000Z",
      },
    };
    const incomplete = {
      ...baseItem,
      id: "latest-but-incomplete",
      metadata: {
        ...baseItem.metadata,
        confirmedAt: "2026-07-28T04:00:00.000Z",
      },
    };

    expect(resolveNewestMarkedDigestItem([older, incomplete, newest])?.id).toBe("newest");
  });

  it("states an unread source once instead of repeating empty evidence labels", () => {
    const unread = {
      ...baseItem,
      metadata: {
        priorityScore: null,
        proofStatus: "failed",
      },
    };
    const markup = renderToStaticMarkup(
      createElement(DesignedDigestBrief, {
        id: "brief",
        periodStart: "2026-07-26T00:00:00.000Z",
        periodEnd: "2026-07-27T00:00:00.000Z",
        createdAt: "2026-07-27T07:00:00.000Z",
        items: [unread],
        allItems: [unread],
      }),
    );

    expect(markup.match(/We could not read this source on/g)).toHaveLength(1);
    expect(markup).not.toContain("Source unavailable");
  });
});

describe("DigestProofPacket", () => {
  it("summarizes the highest-priority move into a client handoff packet", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestProofPacket, {
        items: [
          {
            title: "CTA changed",
            watchlistName: "Mamaearth",
            metadata: {
              priorityScore: 66,
              priorityBand: "Medium priority",
              recommendedAction: "Next review: compare the new CTA.",
              proofTrail: "Spotted in the scheduled scan · 20 Jun, 4:00 am UTC",
              sourceStatus: "scan_backed",
            },
          },
          {
            title: "Offer changed",
            watchlistName: "Nykaa",
            metadata: {
              priorityScore: 92,
              priorityBand: "High priority",
              recommendedAction: "Today: brief one counter-test.",
              proofTrail: "Verified from a page snapshot · 20 Jun, 5:09 am UTC",
              proofCaptureId: "proof-1",
              sourceStatus: "proof_backed",
            },
          },
        ],
      }),
    );

    expect(markup).toContain("Evidence and source details");
    expect(markup).toContain("2 changes packaged for handoff");
    expect(markup).toContain("Offer changed: Verified evidence attached. Review before sharing.");
    expect(markup).not.toContain("ready to send");
    expect(markup).toContain("Today: brief one counter-test.");
    expect(markup).toContain("1 verified evidence");
    expect(markup).toContain("1 check-spotted");
    expect(markup).toContain("2 competitors");
    expect(markup).toContain("1 high");
    expect(markup).toContain("Verified from a page snapshot");
  });

  it("keeps scan-backed-only packets internal until page proof exists", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestProofPacket, {
        items: [
          {
            title: "Headline changed",
            watchlistName: "Nykaa",
            metadata: {
              priorityScore: 72,
              priorityBand: "Medium priority",
              recommendedAction: "Next review: compare the new positioning.",
              proofTrail: "Spotted in the scheduled scan · 20 Jun, 4:00 am UTC",
              sourceStatus: "scan_backed",
            },
          },
        ],
      }),
    );

    expect(markup).toContain("Headline changed: Evidence needs review");
    expect(markup).toContain("add page evidence before sharing");
    expect(markup).toContain("1 check-spotted");
    expect(markup).not.toContain("verified evidence");
  });

  it("keeps a scan-backed top change internal even when another item has proof", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestProofPacket, {
        items: [
          {
            title: "Breaking offer changed",
            watchlistName: "Nykaa",
            metadata: {
              priorityScore: 96,
              priorityBand: "High priority",
              recommendedAction: "Today: review the offer before briefing the client.",
              proofTrail: "Spotted in the scheduled scan · 20 Jun, 4:00 am UTC",
              sourceStatus: "scan_backed",
            },
          },
          {
            title: "Footer copy changed",
            watchlistName: "Mamaearth",
            metadata: {
              priorityScore: 62,
              priorityBand: "Medium priority",
              recommendedAction: "Next review: compare footer positioning.",
              proofTrail: "Verified from a page snapshot · 20 Jun, 5:09 am UTC",
              proofCaptureId: "proof-2",
              sourceStatus: "proof_backed",
            },
          },
        ],
      }),
    );

    expect(markup).toContain("Breaking offer changed: Evidence needs review");
    expect(markup).toContain("add page evidence before sharing");
    expect(markup).toContain("1 verified evidence");
    expect(markup).toContain("1 check-spotted");
    expect(markup).toContain("Today: review the offer before briefing the client.");
    expect(markup).toContain("Spotted in the scheduled scan");
    expect(markup).not.toContain("Breaking offer changed: ready to send");
  });

  it("renders an honest empty packet before digest evidence exists", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestProofPacket, {
        items: [],
      }),
    );

    expect(markup).toContain("No action-worthy changes yet");
    expect(markup).toContain("No decision queued.");
    expect(markup).toContain("Source trail pending.");
  });

  it("keeps internal or canary rows out of the featured decision", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestProofPacket, {
        items: [
          {
            title: "Internal canary changed",
            watchlistName: "Internal",
            metadata: {
              priorityScore: 99,
              priorityBand: "High priority",
              recommendedAction: "Do not put this in the customer decision.",
              proofTrail: "Launch readiness canary.",
              kind: "launch_readiness_canary",
            },
          },
          {
            title: "Customer offer changed",
            watchlistName: "Nykaa",
            metadata: {
              priorityScore: 80,
              priorityBand: "Medium priority",
              recommendedAction: "Next review: brief the customer offer change.",
              proofTrail: "Verified from a page snapshot · 20 Jun, 5:09 am UTC",
              proofCaptureId: "proof-3",
              sourceStatus: "proof_backed",
            },
          },
        ],
      }),
    );

    expect(markup).toContain("Customer offer changed: Verified evidence attached. Review before sharing.");
    expect(markup).toContain("Next review: brief the customer offer change.");
    expect(markup).not.toContain("Do not put this in the customer decision.");
  });

  it("keeps sanitized share snapshot canary rows out of the featured decision", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestProofPacket, {
        items: [
          {
            title: "Share snapshot canary",
            watchlistName: "Internal",
            proofStatus: "canary_or_test",
            metadata: {
              eventStatus: "confirmed",
              priorityScore: 99,
              priorityBand: "High priority",
              recommendedAction: "Do not feature this shared snapshot row.",
              proofTrail: "Sanitized snapshot metadata.",
              sourceStatus: "proof_backed",
            },
          },
          {
            title: "Customer page changed",
            watchlistName: "Nykaa",
            proofStatus: "verified_proof",
            metadata: {
              priorityScore: 75,
              priorityBand: "Medium priority",
              recommendedAction: "Next review: use the customer page change.",
              proofTrail: "Verified from a page snapshot · 20 Jun, 5:09 am UTC",
              sourceStatus: "proof_backed",
            },
          },
        ],
      }),
    );

    expect(markup).toContain("Customer page changed: Verified evidence attached. Review before sharing.");
    expect(markup).toContain("Next review: use the customer page change.");
    expect(markup).not.toContain("Do not feature this shared snapshot row.");
  });
});

describe("DigestMovementSummary", () => {
  it("uses the shared priority mix so priority bands count when scores are missing", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestMovementSummary, {
        items: [
          {
            watchlistName: "Nykaa",
            metadata: {
              priorityScore: null,
              priorityBand: "High priority",
            },
          },
          {
            watchlistName: "Mamaearth",
            metadata: {
              priorityScore: null,
              priorityBand: "Priority pending",
            },
          },
        ],
      }),
    );

    expect(markup).toContain("2 changes across 2 competitors");
    expect(markup).toContain("1 high · 0 medium · 1 low");
  });

  it("uses singular wording for one change from one competitor", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestMovementSummary, {
        items: [
          {
            watchlistName: "Nykaa",
            metadata: {
              priorityScore: 90,
              priorityBand: "High priority",
            },
          },
        ],
      }),
    );

    expect(markup).toContain("1 change across 1 competitor");
    expect(markup).not.toContain("1 changes");
    expect(markup).not.toContain("1 competitors");
  });
});

describe("DigestIntelligence", () => {
  it("uses stored snapshot proof status for item-level proof labels", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestIntelligence, {
        proofStatus: "canary_or_test",
        metadata: {
          eventStatus: "confirmed",
          sourceStatus: "proof_backed",
          priorityScore: 99,
          priorityBand: "High priority",
          recommendedAction: "Review",
          proofTrail: "Sanitized snapshot metadata.",
        },
      }),
    );

    expect(markup).toContain("Excluded from client report");
    expect(markup).not.toContain("Verified evidence");
  });
});

describe("readDigestSourceUrl", () => {
  it("skips unsafe source candidates and returns the first safe fallback", async () => {
    const { readDigestSourceUrl } = await import("~/routes/app.digests");

    expect(
      readDigestSourceUrl({
        sourceUrl: "javascript:alert(1)",
        proofUrl: "not a url",
        websiteUrl: "https://example.com/safe-source",
      }),
    ).toBe("https://example.com/safe-source");
    expect(readDigestSourceUrl({ sourceUrl: "mailto:support@example.com" })).toBeNull();
  });
});
