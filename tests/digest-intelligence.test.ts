import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DigestDecisionSummary, DigestIntelligence, DigestMovementSummary, DigestProofPacket } from "~/components/digest-intelligence";

describe("DigestDecisionSummary", () => {
  it("leads with the highest-priority customer decision", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestDecisionSummary, {
        items: [
          {
            title: "CTA changed",
            summary: "The competitor is pushing lead capture harder.",
            eventType: "landing_page_cta_changed",
            watchlistName: "Mamaearth",
            metadata: {
              priorityScore: 66,
              priorityBand: "Medium priority",
              recommendedAction: "Next review: compare the new CTA.",
              proofTrail: "Spotted in the scheduled scan",
              sourceStatus: "scan_backed",
              confirmedAt: "2026-06-20T04:00:00.000Z",
            },
            createdAt: "2026-06-20T04:00:00.000Z",
          },
          {
            title: "Offer changed",
            summary: "The competitor lowered the anchor price.",
            eventType: "landing_page_offer_changed",
            watchlistName: "Nykaa",
            metadata: {
              priorityScore: 92,
              priorityBand: "High priority",
              recommendedAction: "Today: brief one counter-test.",
              proofTrail: "Verified from a page snapshot",
              proofCaptureId: "proof-1",
              sourceStatus: "proof_backed",
              confirmedAt: "2026-06-20T05:09:00.000Z",
            },
            createdAt: "2026-06-20T05:09:00.000Z",
          },
        ],
      }),
    );

    expect(markup).toContain("Decision summary");
    expect(markup).toContain("Nykaa needs review");
    expect(markup).toContain("What changed");
    expect(markup).toContain("Offer changed");
    expect(markup).toContain("Why it matters");
    expect(markup).toContain("The competitor lowered the anchor price.");
    expect(markup).toContain("High priority");
    expect(markup).toContain("Verified proof");
    expect(markup).toContain("Proof snapshot");
    expect(markup).toContain("Today: brief one counter-test.");
  });

  it("uses evidence freshness from metadata before the digest packaging time", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestDecisionSummary, {
        items: [
          {
            title: "Offer changed",
            summary: "The competitor lowered the anchor price.",
            eventType: "landing_page_offer_changed",
            watchlistName: "Nykaa",
            metadata: {
              priorityScore: 92,
              priorityBand: "High priority",
              recommendedAction: "Today: brief one counter-test.",
              proofTrail: "Verified from a page snapshot",
              proofCaptureId: "proof-1",
              sourceStatus: "proof_backed",
              createdAt: "2026-06-20T04:00:00.000Z",
            },
            createdAt: "2026-06-25T10:00:00.000Z",
          },
        ],
      }),
    );

    expect(markup).toContain('dateTime="2026-06-20T04:00:00.000Z"');
    expect(markup).not.toContain('dateTime="2026-06-25T10:00:00.000Z"');
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

    expect(markup).toContain("Proof and source details");
    expect(markup).toContain("2 changes packaged for handoff");
    expect(markup).toContain("Offer changed: ready to send as a client or teammate digest");
    expect(markup).toContain("Today: brief one counter-test.");
    expect(markup).toContain("1 verified proof");
    expect(markup).toContain("1 scan-spotted");
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

    expect(markup).toContain("Headline changed: ready to review");
    expect(markup).toContain("add page proof before sharing");
    expect(markup).toContain("1 scan-spotted");
    expect(markup).not.toContain("verified proof");
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

    expect(markup).toContain("Breaking offer changed: ready to review");
    expect(markup).toContain("add page proof before sharing");
    expect(markup).toContain("1 verified proof");
    expect(markup).toContain("1 scan-spotted");
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
    expect(markup).toContain("Proof trail pending.");
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

    expect(markup).toContain("Customer offer changed: ready to send");
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

    expect(markup).toContain("Customer page changed: ready to send");
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
    expect(markup).not.toContain("Verified proof");
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
