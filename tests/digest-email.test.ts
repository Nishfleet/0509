import { describe, expect, it } from "vitest";

import { buildDigestEmail } from "~/lib/digest-email.server";

describe("buildDigestEmail", () => {
  it("renders a top-three decision brief with authored plain text", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "Asia/Kolkata",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/sources",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: "https://0509.io/unsubscribe?sig=test",
      items: [
        digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
        digestItem("boAt", "New ad detected", 85, "scan_backed"),
        digestItem("Mamaearth", "CTA changed", 70, "scan_backed"),
        digestItem("Plum", "Headline changed", 30, "scan_backed"),
      ],
    });

    expect(email.subject).toBe("4 changes found, 4 worth action");
    expect(email.text).toContain("4 changes found, 4 worth action.");
    expect(email.html).toContain("Top moves");
    expect(email.html).toContain("Nykaa: Landing page offer changed");
    expect(email.html).toContain("boAt: New ad detected");
    expect(email.html).toContain("Mamaearth: CTA changed");
    expect(email.html).not.toContain("Plum: Headline changed");
    expect(email.html).toContain("Verified proof");
    expect(email.html).toContain("Scan-spotted");
    expect(email.text).toContain("View full digest: https://0509.io/app/digests");
    expect(email.text).toContain("Manage frequency: https://0509.io/app/sources");
    expect(email.text).toContain("Unsubscribe: https://0509.io/unsubscribe?sig=test");
  });

  it("renders an all-quiet digest without claiming proof movement", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-02T00:00:00.000Z",
      cadence: "daily",
      timeZone: "UTC",
      items: [],
      heartbeat: { runs: 3, watchlistsChecked: 2, adsSeen: 42 },
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/sources",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
    });

    expect(email.subject).toBe("All quiet: no competitor moves worth action today");
    expect(email.html).toContain("All quiet");
    expect(email.text).toContain("3 checks across 2 competitors reviewed 42 ads");
    expect(email.text).not.toContain("proof-backed");
  });

  it("keeps watchlist names header-safe in digest subjects", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/sources",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        digestItem(
          "Competitor\r\nBcc: attacker@example.com with a very long account label that should not own the header",
          "Landing page offer changed",
          95,
          "proof_backed",
        ),
      ],
    });

    expect(email.subject).not.toMatch(/[\r\n\u0000-\u001f\u007f]/);
    expect(email.subject.length).toBeLessThanOrEqual(140);
    expect(email.subject).toContain("Competitor Bcc: attacker@example.com");
  });

  it("uses period-aware all-quiet copy for weekly digests", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      items: [],
      heartbeat: { runs: 7, watchlistsChecked: 4, adsSeen: 128 },
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/sources",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
    });

    expect(email.subject).toBe("All quiet: no competitor moves worth action this period");
    expect(email.html).toContain("All quiet: no competitor moves worth action this period.");
    expect(email.text).toContain("All quiet: no competitor moves worth action this period.");
    expect(email.subject).not.toContain("today");
  });

  it("omits unsafe items from top moves and escapes untrusted text", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/sources",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        {
          watchlistName: "<Nykaa>",
          eventType: "ad_new",
          title: "<script>alert(1)</script>",
          summary: "Safe <b>summary</b>",
          createdAt: "2026-06-08T00:00:00.000Z",
          metadata: {
            priorityScore: 90,
            priorityBand: "High priority",
            recommendedAction: "Review the change.",
            proofTrail: "Verified from a page snapshot",
            sourceStatus: "proof_backed",
            proofCaptureId: "proof-1",
          },
        },
        {
          watchlistName: "Failed",
          eventType: "ad_new",
          title: "Proof failed item",
          summary: "Should not be a top move.",
          metadata: { eventStatus: "proof_failed", sourceStatus: "proof_failed" },
        },
        {
          watchlistName: "Internal",
          eventType: "ad_new",
          title: "Internal item",
          summary: "Should not be a top move.",
          metadata: { internalOnly: true },
        },
        {
          watchlistName: "Canary",
          eventType: "ad_new",
          title: "Canary item",
          summary: "Should not be a top move.",
          metadata: { kind: "launch_readiness_canary" },
        },
      ],
    });

    expect(email.html).toContain("&lt;Nykaa&gt;: &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("Safe &lt;b&gt;summary&lt;/b&gt;");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).not.toContain("Proof failed item");
    expect(email.html).not.toContain("Internal item");
    expect(email.html).not.toContain("Canary item");
    expect(email.html).toContain("2 excluded");
    expect(email.html).toContain("1 proof failed");
  });
});

function digestItem(
  watchlistName: string,
  title: string,
  priorityScore: number,
  sourceStatus: "proof_backed" | "scan_backed",
) {
  return {
    watchlistName,
    eventType: "ad_new",
    title,
    summary: `${title} summary with enough detail for review.`,
    createdAt: "2026-06-08T00:00:00.000Z",
    metadata: {
      priorityScore,
      priorityBand: priorityScore >= 85 ? "High priority" : priorityScore >= 65 ? "Medium priority" : "Low priority",
      recommendedAction: "Review before the next campaign decision.",
      proofTrail: sourceStatus === "proof_backed" ? "Verified from a page snapshot" : "Spotted in the scheduled scan",
      proofCaptureId: sourceStatus === "proof_backed" ? "proof-1" : null,
      sourceStatus,
      confirmedAt: "2026-06-08T00:00:00.000Z",
    },
  };
}
