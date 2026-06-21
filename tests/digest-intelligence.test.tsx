import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DigestProofPacket } from "~/components/digest-intelligence";

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

    expect(markup).toContain("Proof packet");
    expect(markup).toContain("2 changes packaged for handoff");
    expect(markup).toContain("Offer changed: ready to send as a client or teammate brief");
    expect(markup).toContain("Today: brief one counter-test.");
    expect(markup).toContain("1 verified snapshot");
    expect(markup).toContain("1 scan-backed change");
    expect(markup).toContain("2 competitors");
    expect(markup).toContain("1 high-priority change");
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

    expect(markup).toContain("Headline changed: ready for internal review");
    expect(markup).toContain("add page proof before sending externally");
    expect(markup).toContain("1 scan-backed change");
    expect(markup).not.toContain("verified snapshot");
  });

  it("renders an honest empty packet before digest evidence exists", () => {
    const markup = renderToStaticMarkup(
      createElement(DigestProofPacket, {
        items: [],
      }),
    );

    expect(markup).toContain("No proof-backed changes yet");
    expect(markup).toContain("No decision queued.");
    expect(markup).toContain("Proof trail pending.");
  });
});
