import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  alertMaterialityReason,
  digestConfidenceLabel,
  digestConfidenceLevel,
  digestFreshUntilLabel,
  digestMaterialityReason,
  digestNextAction,
  digestReviewerLabel,
} from "~/lib/change-intelligence";
import {
  buildDigestEmail,
  buildScanTroubleEmail,
  digestItemDeepLink,
  groupTopMovesByWatchlist,
  renderEmailAccountabilityBlock,
  type DigestEmailHeartbeat,
  type DigestEmailHeartbeatTriage,
} from "~/lib/digest-email.server";

describe("buildScanTroubleEmail", () => {
  it("names affected watchlists without claiming an active retry", () => {
    const email = buildScanTroubleEmail({
      watchlistNames: ["Nykaa", "boAt"],
      watchlistsUrl: "https://0509.io/app/watchlists",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: "https://0509.io/unsubscribe?sig=test",
    });

    expect(email.subject).toBe("2 competitor checks did not complete");
    expect(email.html).toContain("Nykaa");
    expect(email.html).toContain("boAt");
    expect(email.html).toContain("We'll try again at the next scheduled check");
    expect(email.html).not.toContain("Retries are already running automatically");
    expect(email.preheader).toBe(
      "We'll try again at the next scheduled check — open watchlists for status.",
    );
    expect(email.preheader).not.toContain("Retries are already running automatically");
    expect(email.text).toContain("We'll try again at the next scheduled check.");
    expect(email.text).not.toContain("Retries are already running automatically");
    expect(email.html).toContain("/app/watchlists");
    expect(email.text).toContain("Open watchlists: https://0509.io/app/watchlists");
  });
});

describe("buildDigestEmail", () => {
  it("renders up to five top moves grouped by watchlist", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "Asia/Kolkata",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: "https://0509.io/unsubscribe?sig=test",
      items: [
        digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
        digestItem("Nykaa", "New ad detected", 90, "scan_backed", "ev-nykaa-2"),
        digestItem("boAt", "New ad detected", 85, "scan_backed"),
        digestItem("Mamaearth", "CTA changed", 70, "scan_backed"),
        digestItem("Plum", "Headline changed", 65, "scan_backed"),
        digestItem("Sugar", "Form changed", 60, "scan_backed"),
        digestItem("Dot", "Offer changed", 55, "scan_backed"),
        digestItem("Wow", "CTA changed", 50, "scan_backed"),
      ],
    });

    expect(email.subject).toBe("8 changes found, 8 worth action");
    expect(email.text).toContain("8 changes found, 8 worth action.");
    expect(email.html).toContain("Top moves");
    // Group headers with per-group counts (Nykaa has 2 of the top 5).
    expect(email.html).toContain("Nykaa");
    expect(email.html).toContain(" · 2 changes");
    expect(email.html).toContain("Landing page offer changed");
    expect(email.html).toContain("boAt");
    expect(email.html).toContain("Mamaearth");
    expect(email.html).toContain("Plum");
    // Cap at 5 — lower-priority Sugar/Dot/Wow omitted from top moves.
    expect(email.html).not.toContain("Sugar");
    expect(email.html).toContain("3 more changes are in the full brief");
    expect(email.html).toContain("Verified evidence");
    expect(email.html).toContain("Check-spotted");
    // WP-24: each top-move deep-links to the watchlist event row (HTML-escaped &).
    expect(email.html).toContain("/app/watchlists?watchlist=wl-nykaa&amp;event=ev-nykaa");
    expect(email.html).toContain("/app/watchlists?watchlist=wl-boat&amp;event=ev-boat");
    expect(email.text).toContain(
      "Review in Five to Nine: https://0509.io/app/watchlists?watchlist=wl-nykaa&event=ev-nykaa",
    );
    expect(email.text).toContain("View full brief: https://0509.io/app/digests");
    expect(email.text).toContain("Manage frequency: https://0509.io/app/notifications");
    expect(email.text).toContain("Unsubscribe: https://0509.io/unsubscribe?sig=test");
  });

  it("groups interleaved ranked items into one header per watchlist", () => {
    const items = [
      digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
      digestItem("boAt", "New ad detected", 90, "scan_backed"),
      digestItem("Nykaa", "CTA changed", 85, "scan_backed", "ev-nykaa-2"),
      digestItem("boAt", "Headline changed", 80, "scan_backed", "ev-boat-2"),
      digestItem("Nykaa", "Form changed", 75, "scan_backed", "ev-nykaa-3"),
    ];

    const groups = groupTopMovesByWatchlist(items as never);

    // One group per watchlist even though ranked items interleave.
    expect(groups.map((group) => group.watchlistName)).toEqual(["Nykaa", "boAt"]);
    // Rank order preserved inside each group.
    expect(groups[0].items.map((item) => item.title)).toEqual([
      "Landing page offer changed",
      "CTA changed",
      "Form changed",
    ]);
    expect(groups[1].items.map((item) => item.title)).toEqual([
      "New ad detected",
      "Headline changed",
    ]);

    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items,
    });

    // Exactly one header per watchlist in the rendered email.
    expect(email.html.match(/<strong>Nykaa<\/strong>/g)).toHaveLength(1);
    expect(email.html.match(/<strong>boAt<\/strong>/g)).toHaveLength(1);
    expect(email.html).toContain(" · 3 changes");
    expect(email.html).toContain(" · 2 changes");
  });

  it("builds digestItemDeepLink only when both ids exist", () => {
    expect(
      digestItemDeepLink({ eventId: "e1", watchlistId: "w1" }),
    ).toBe("https://0509.io/app/watchlists?watchlist=w1&event=e1");
    expect(digestItemDeepLink({ eventId: "e1", watchlistId: null as never })).toBeNull();
    expect(digestItemDeepLink({ eventId: "", watchlistId: "w1" })).toBeNull();
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
      manageFrequencyUrl: "https://0509.io/app/notifications",
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
      manageFrequencyUrl: "https://0509.io/app/notifications",
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
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
    });

    expect(email.subject).toBe(
      "All quiet: no competitor moves worth action this period (including your Monday brief)",
    );
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
      manageFrequencyUrl: "https://0509.io/app/notifications",
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

    // Group header + item title are escaped separately (no "Name: Title" join).
    expect(email.html).toContain("&lt;Nykaa&gt;");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("Safe &lt;b&gt;summary&lt;/b&gt;");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).not.toContain("Proof failed item");
    expect(email.html).not.toContain("Internal item");
    expect(email.html).not.toContain("Canary item");
    expect(email.html).toContain("2 excluded");
    expect(email.html).toContain("1 evidence unavailable");
    expect(email.html).not.toContain("1 proof failed");
  });

  it("renders creative thumbnails and before/after pairs when https urls are sourced", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        {
          ...digestItem("Nykaa", "Creative rotated", 95, "proof_backed"),
          metadata: {
            ...digestItem("Nykaa", "Creative rotated", 95, "proof_backed").metadata,
            beforeCreativeImageUrl: "https://cdn.example.com/before.jpg",
            afterCreativeImageUrl: "https://cdn.example.com/after.jpg?sig=\"x\"",
          },
        },
        {
          ...digestItem("boAt", "New ad detected", 85, "scan_backed"),
          metadata: {
            ...digestItem("boAt", "New ad detected", 85, "scan_backed").metadata,
            creativeImageUrl: "https://cdn.example.com/single.jpg",
          },
        },
        {
          ...digestItem("Mamaearth", "CTA changed", 70, "scan_backed"),
          metadata: {
            ...digestItem("Mamaearth", "CTA changed", 70, "scan_backed").metadata,
            creativeImageUrl: "http://insecure.example.com/skip.jpg",
          },
        },
      ],
    });

    expect(email.html).toContain('src="https://cdn.example.com/before.jpg"');
    expect(email.html).toContain("Before");
    expect(email.html).toContain("Now");
    expect(email.html).toContain('src="https://cdn.example.com/after.jpg?sig=&quot;x&quot;"');
    expect(email.html).toContain('src="https://cdn.example.com/single.jpg"');
    expect(email.html).not.toContain("http://insecure.example.com/skip.jpg");
    expect(email.html).not.toContain("image unavailable");
    expect(email.html).not.toContain("No creative");
    expect(email.text).toContain("Creative: before/after thumbnails attached in the HTML email.");
    expect(email.text).toContain("Creative thumbnail attached in the HTML email.");
    // Mamaearth item has only an insecure URL — text must omit creative notes for that item.
    expect(email.text).not.toMatch(/Mamaearth[\s\S]*Creative thumbnail/);
  });

  it("renders landing-page before/after screenshots as a labelled evidence card", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        {
          ...digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
          metadata: {
            ...digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed").metadata,
            from: "Starting at ₹499",
            to: "Starting at ₹799",
            sourceUrl: "https://nykaa.com/festive-glow",
            beforeCreativeImageUrl: "https://cdn.example.com/lp-before.png",
            afterCreativeImageUrl: "https://cdn.example.com/lp-after.png",
            beforeCapturedAt: "2026-06-07T04:00:00.000Z",
            capturedAt: "2026-06-08T04:00:00.000Z",
          },
        },
      ],
    });

    expect(email.html).toContain("Landing page evidence");
    expect(email.html).toContain("Offer / price changed");
    expect(email.html).toContain('src="https://cdn.example.com/lp-before.png"');
    expect(email.html).toContain('src="https://cdn.example.com/lp-after.png"');
    expect(email.html).toContain("https://nykaa.com/festive-glow");
    expect(email.html).toContain("Starting at ₹499");
    expect(email.html).toContain("Starting at ₹799");
    expect(email.text).toContain("Landing page evidence: Offer / price changed");
    expect(email.text).toContain("Source: https://nykaa.com/festive-glow");
    expect(email.html).not.toContain("Screenshot proof pending");
  });

  it("renders an explicit pending state — never a broken image — when one landing-page artifact is missing", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        {
          ...digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
          metadata: {
            ...digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed").metadata,
            beforeCreativeImageUrl: "https://cdn.example.com/lp-before.png",
          },
        },
      ],
    });

    expect(email.html).toContain("Landing page evidence");
    expect(email.html).toContain("Screenshot proof pending");
    expect(email.html).not.toContain("<img");
    expect(email.text).toContain("Screenshot proof pending");
  });

  it("treats invalid landing-page artifact URLs as pending proof, not stored proof", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        {
          ...digestItem("Nykaa", "Landing page headline changed", 95, "proof_backed"),
          eventType: "landing_page_headline_changed",
          metadata: {
            ...digestItem("Nykaa", "Landing page headline changed", 95, "proof_backed").metadata,
            beforeCreativeImageUrl: "http://insecure.example.com/lp-before.png",
            afterCreativeImageUrl: "not a url",
          },
        },
      ],
    });

    expect(email.html).toContain("Landing page evidence");
    expect(email.html).toContain("Screenshot proof pending");
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("http://insecure.example.com");
  });

  it("omits the landing-page card entirely when no artifact URLs are stored", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        {
          ...digestItem("Nykaa", "Landing page headline changed", 95, "proof_backed"),
          eventType: "landing_page_headline_changed",
          metadata: {
            ...digestItem("Nykaa", "Landing page headline changed", 95, "proof_backed").metadata,
            from: "A rewritten headline that is far too long for any short token mark",
            to: "Short headline",
          },
        },
      ],
    });

    expect(email.html).not.toContain("Landing page evidence");
    expect(email.html).not.toContain("Screenshot proof pending");
    expect(email.html).not.toContain("<img");
    expect(email.text).not.toContain("Landing page evidence");
  });

  it("keeps ad creative thumbnails unchanged beside the landing-page card", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        {
          ...digestItem("Nykaa", "Creative rotated", 95, "proof_backed"),
          metadata: {
            ...digestItem("Nykaa", "Creative rotated", 95, "proof_backed").metadata,
            beforeCreativeImageUrl: "https://cdn.example.com/before.jpg",
            afterCreativeImageUrl: "https://cdn.example.com/after.jpg",
          },
        },
        {
          ...digestItem("Nykaa", "Landing page offer changed", 90, "proof_backed"),
          metadata: {
            ...digestItem("Nykaa", "Landing page offer changed", 90, "proof_backed").metadata,
            beforeCreativeImageUrl: "https://cdn.example.com/lp-before.png",
            afterCreativeImageUrl: "https://cdn.example.com/lp-after.png",
          },
        },
      ],
    });

    expect(email.html).toContain('src="https://cdn.example.com/before.jpg"');
    expect(email.html).toContain("Landing page evidence");
    expect(email.html).toContain('src="https://cdn.example.com/lp-before.png"');
    expect(email.text).toContain("Creative: before/after thumbnails attached in the HTML email.");
    expect(email.text).toContain("Landing page evidence: Offer / price changed");
  });

  it("omits thumbnail markup entirely when no https creative url is present", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "daily",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed")],
    });

    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("Before");
    expect(email.html).not.toContain("Trends this period");
    expect(email.text).not.toContain("Creative thumbnail");
    expect(email.text).not.toContain("Trends this period");
    expect(email.html).not.toContain("unavailable");
  });

  it("surfaces sourced spend/reach bands and omits inventing metrics", () => {
    const withMetrics = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        {
          ...digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
          metadata: {
            ...digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed").metadata,
            observedSpend: "₹50k–₹100k",
            observedReach: "80k",
            observedImpressions: "100k to 150k",
          },
        },
      ],
    });

    expect(withMetrics.html).toContain("Spending in the ₹50k–₹100k band");
    expect(withMetrics.html).toContain("Impressions in the 100k–150k band");
    expect(withMetrics.html).toContain("Observed reach: 80k");
    expect(withMetrics.text).toContain("Spending in the ₹50k–₹100k band");

    const withoutMetrics = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed")],
    });

    expect(withoutMetrics.html).not.toContain("Spending in the");
    expect(withoutMetrics.html).not.toContain("Observed spend");
    expect(withoutMetrics.html).not.toContain("Observed reach");
    expect(withoutMetrics.html).not.toContain("Observed impressions");
    expect(withoutMetrics.html).not.toContain("unavailable");
    expect(withoutMetrics.text).not.toContain("Spending in the");
    expect(withoutMetrics.text).not.toContain("Observed spend");
  });

  it("folds trend rollups into weekly digests only", () => {
    const items = [
      digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
      {
        ...digestItem("Nykaa", "Offer changed again", 90, "proof_backed"),
        eventType: "landing_page_offer_changed",
        metadata: {
          ...digestItem("Nykaa", "Offer changed again", 90, "proof_backed").metadata,
          hook: "Routine-first bundle",
        },
      },
      {
        ...digestItem("boAt", "CTA changed", 80, "scan_backed"),
        eventType: "landing_page_cta_changed",
      },
      {
        ...digestItem("Mamaearth", "Another CTA", 75, "scan_backed"),
        eventType: "landing_page_cta_changed",
      },
      {
        ...digestItem("Plum", "CTA three", 70, "scan_backed"),
        eventType: "landing_page_cta_changed",
      },
    ];

    const weekly = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items,
    });

    expect(weekly.html).toContain("Trends this period");
    expect(weekly.html).toContain("Changed CTAs 3× this period");
    expect(weekly.html).toContain("Changed pricing 2× this period");
    expect(weekly.text).toContain("Trends this period:");
    expect(weekly.text).toContain("- Changed CTAs 3× this period");

    const daily = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-07T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "daily",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items,
    });

    expect(daily.html).not.toContain("Trends this period");
    expect(daily.text).not.toContain("Trends this period");
    expect(daily.html).not.toContain("<img");
  });

	it("renders the AI strategy paragraph escaped in html and text when present", () => {
		const paragraph =
			'Nykaa & boAt both leaned on <b>"festival"</b> pricing this week, while Mamaearth rotated its hero creative and left offers untouched.';
		const email = buildDigestEmail({
			...strategyEmailInput(),
			strategyParagraph: paragraph,
		});

		expect(email.html).toContain("AI summary of the week");
		expect(email.html).toContain(
			"Nykaa &amp; boAt both leaned on &lt;b&gt;&quot;festival&quot;&lt;/b&gt; pricing this week",
		);
		expect(email.html).not.toContain('<b>"festival"</b>');
		expect(email.text).toContain("AI summary of the week:");
		expect(email.text).toContain(paragraph);
		// Section order: paragraph sits between the date line and the priority box.
		expect(email.html.indexOf("AI summary of the week")).toBeLessThan(
			email.html.indexOf("Priority mix:"),
		);
	});

	it("is byte-identical without a paragraph — absence stays silent", () => {
		const withoutKey = buildDigestEmail(strategyEmailInput());
		const withNull = buildDigestEmail({ ...strategyEmailInput(), strategyParagraph: null });
		const withBlank = buildDigestEmail({ ...strategyEmailInput(), strategyParagraph: "   " });

		expect(withNull).toEqual(withoutKey);
		expect(withBlank).toEqual(withoutKey);
		expect(withNull.html).toBe(withoutKey.html);
		expect(withNull.text).toBe(withoutKey.text);
		expect(withoutKey.html).not.toContain("AI summary");
		expect(withoutKey.text).not.toContain("AI summary");
		expect(withoutKey.html).not.toContain("unavailable");
	});

  it("keeps heartbeat digests unaffected by a stray paragraph", () => {
		const heartbeatInput = {
			...strategyEmailInput(),
			items: [],
			heartbeat: { runs: 3, watchlistsChecked: 2, adsSeen: 42 },
		};
		const plain = buildDigestEmail(heartbeatInput);
		const withParagraph = buildDigestEmail({
			...heartbeatInput,
			strategyParagraph: "Should never appear in an all-quiet heartbeat.",
		});

		expect(withParagraph).toEqual(plain);
		expect(withParagraph.html).not.toContain("AI summary");
		expect(withParagraph.text).not.toContain("AI summary");
		expect(withParagraph.html).not.toContain("Should never appear");
	});

	it("keeps legacy heartbeat emails byte-identical without a triage record", () => {
		const legacy = buildDigestEmail({
			name: "Owner",
			periodStart: "2026-06-01T00:00:00.000Z",
			periodEnd: "2026-06-02T00:00:00.000Z",
			cadence: "daily",
			timeZone: "UTC",
			items: [],
			heartbeat: { runs: 3, watchlistsChecked: 2, adsSeen: 42 },
			fullDigestUrl: "https://0509.io/app/digests",
			manageFrequencyUrl: "https://0509.io/app/notifications",
			supportEmail: "support@0509.io",
			supportMailto: "mailto:support@0509.io",
			unsubscribeUrl: null,
		});

		expect(legacy.subject).toBe("All quiet: no competitor moves worth action today");
		expect(legacy.html).toContain("We ran 3 checks across 2 competitors");
		expect(legacy.html).not.toContain("No action needed");
		expect(legacy.text).not.toContain("Source: completed checks.");
	});
});

describe("zero-noise triage digest emails (2026-08-06)", () => {
	function triageEmailInput(heartbeat: DigestEmailHeartbeat) {
		return {
			name: "Owner",
			periodStart: "2026-06-01T00:00:00.000Z",
			periodEnd: "2026-06-08T00:00:00.000Z",
			cadence: "weekly" as const,
			timeZone: "UTC",
			items: [],
			heartbeat,
			fullDigestUrl: "https://0509.io/app/digests",
			manageFrequencyUrl: "https://0509.io/app/notifications",
			supportEmail: "support@0509.io",
			supportMailto: "mailto:support@0509.io",
			unsubscribeUrl: null,
		};
	}

	function triage(
		status: DigestEmailHeartbeatTriage["status"],
		overrides: Partial<DigestEmailHeartbeatTriage> = {},
	): DigestEmailHeartbeatTriage {
		return {
			status,
			label: "Label",
			explanation: "Explanation sentence.",
			checkedAt: "2026-06-08T04:00:00.000Z",
			checksCompleted: 7,
			suppressedChanges: 0,
			suppressionReasons: [],
			nextAction: "We check again at the next scheduled scan.",
			noActionLine: "No action needed — nothing new to act on.",
			...overrides,
		};
	}

	it("renders an all-quiet record with checked-at, source status, and no-action line", () => {
		const email = buildDigestEmail(
			triageEmailInput({
				runs: 7,
				watchlistsChecked: 4,
				adsSeen: 128,
				triage: triage("all_quiet"),
			}),
		);

		// Same honest subject family as the legacy all-quiet email.
		expect(email.subject).toBe(
			"All quiet: no competitor moves worth action this period (including your Monday brief)",
		);
		expect(email.html).toContain("Checked at");
		expect(email.html).toContain("Source: completed checks.");
		expect(email.html).toContain("No action needed — nothing new to act on.");
		expect(email.html).toContain("We check again at the next scheduled scan.");
		expect(email.text).toContain("Source: completed checks.");
		expect(email.text).not.toContain("proof-backed");
	});

	it("renders routine-only suppression with its reason instead of claiming all quiet", () => {
		const email = buildDigestEmail(
			triageEmailInput({
				runs: 7,
				watchlistsChecked: 4,
				adsSeen: 128,
				triage: triage("routine_only", {
					label: "Routine changes only",
					explanation:
						"We saw 3 routine changes and held the alert — each one repeats a change already reported this period.",
					suppressedChanges: 3,
					suppressionReasons: [
						"Repeat of a change already reported this period",
					],
					noActionLine: "No action needed — these are repeats, not new moves.",
					nextAction: "We alert on a change only when it's new.",
				}),
			}),
		);

		expect(email.subject).toBe("Routine changes only — nothing new to act on");
		expect(email.html).toContain("Routine changes only — nothing new to act on.");
		expect(email.html).toContain("held the alert");
		expect(email.html).toContain(
			"Held back: Repeat of a change already reported this period.",
		);
		expect(email.html).toContain("No action needed — these are repeats, not new moves.");
		expect(email.text).toContain("Held back: Repeat of a change already reported this period.");
		expect(email.html).not.toContain("All quiet: no competitor moves worth action");
		expect(email.subject).not.toContain("All quiet");
	});

	it("renders an evidence-failed period as evidence-failed, never as all quiet", () => {
		const email = buildDigestEmail(
			triageEmailInput({
				runs: 7,
				watchlistsChecked: 4,
				adsSeen: 128,
				triage: triage("evidence_failed", {
					label: "Evidence check failed",
					explanation:
						"An evidence check couldn't finish, so nothing is confirmed yet.",
					noActionLine: "No change is confirmed without proof.",
					nextAction:
						"We'll retry at the next scheduled check. If it persists, email support and we'll dig in.",
				}),
			}),
		);

		expect(email.subject).toBe("Some competitor checks couldn't finish");
		expect(email.text).toContain("We couldn't finish some competitor checks.");
		expect(email.html).toContain("We couldn&#039;t finish some competitor checks.");
		expect(email.text).toContain(
			"An evidence check couldn't finish, so nothing is confirmed yet.",
		);
		expect(email.text).not.toContain("provider timed out");
		expect(email.text).not.toContain("possible change was detected");
		expect(email.text).toContain("No change is confirmed without proof.");
		expect(email.text).toContain("We'll retry at the next scheduled check");
		expect(email.text).toContain("Source: evidence check failed.");
		expect(email.html).not.toContain("All quiet");
		expect(email.subject).not.toContain("All quiet");
	});

	it("renders proof-pending as evidence-pending, never as all quiet", () => {
		const email = buildDigestEmail(
			triageEmailInput({
				runs: 7,
				watchlistsChecked: 4,
				adsSeen: 128,
				triage: triage("evidence_pending", {
					label: "Evidence pending",
					explanation:
						"A possible change was detected, but its evidence check hasn't completed, so nothing is confirmed yet.",
					noActionLine: "No change is confirmed until its evidence lands.",
					nextAction:
						"We're retrying the evidence check. Open watchlists for status.",
				}),
			}),
		);

		expect(email.subject).toBe(
			"Some competitor changes are still waiting for evidence",
		);
		expect(email.text).toContain("Evidence is still pending on some changes.");
		expect(email.text).toContain("nothing is confirmed yet");
		expect(email.text).toContain("No change is confirmed until its evidence lands.");
		expect(email.text).toContain("Source: evidence pending.");
		expect(email.html).not.toContain("All quiet");
	});

	it("keeps meaningful price/CTA change items with their evidence and next action", () => {
		const email = buildDigestEmail({
			name: "Owner",
			periodStart: "2026-06-01T00:00:00.000Z",
			periodEnd: "2026-06-08T00:00:00.000Z",
			cadence: "weekly",
			timeZone: "UTC",
			items: [
				digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
				digestItem("boAt", "CTA changed", 80, "scan_backed"),
			],
			fullDigestUrl: "https://0509.io/app/digests",
			manageFrequencyUrl: "https://0509.io/app/notifications",
			supportEmail: "support@0509.io",
			supportMailto: "mailto:support@0509.io",
			unsubscribeUrl: null,
		});

		// SubjectForDigest leads with the top competitor name.
		expect(email.subject).toBe("Nykaa leads 2 competitor moves worth seeing");
		expect(email.html).toContain("Landing page offer changed");
		expect(email.html).toContain("CTA changed");
		expect(email.html).toContain("Verified evidence");
		expect(email.html).toContain("Suggested next action:");
		expect(email.text).toContain("Suggested next action:");
	});
});

describe("named owner, materiality reason, and next action (E2 2026-08-08)", () => {
	function digestEmailInput(
		overrides: Partial<Parameters<typeof buildDigestEmail>[0]> = {},
	) {
		return {
			name: "Owner",
			periodStart: "2026-06-01T00:00:00.000Z",
			periodEnd: "2026-06-08T00:00:00.000Z",
			cadence: "weekly" as const,
			timeZone: "UTC",
			items: [digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed")],
			fullDigestUrl: "https://0509.io/app/digests",
			manageFrequencyUrl: "https://0509.io/app/notifications",
			supportEmail: "support@0509.io",
			supportMailto: "mailto:support@0509.io",
			unsubscribeUrl: null,
			...overrides,
		};
	}

	it("renders materiality reason, reviewer, and next action for a price change", () => {
		const email = buildDigestEmail(
			digestEmailInput({
				items: [
					{
						...digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
						eventType: "landing_page_offer_changed",
					},
				],
			}),
		);

		expect(email.html).toContain("<strong>Why this matters:</strong>");
		expect(email.html).toContain("pricing or offers moved (1 change)");
		expect(email.html).toContain("<strong>Accountable reviewer:</strong>");
		expect(email.html).toContain("Accountable reviewer:</strong> Owner");
		expect(email.html).toContain("<strong>Next action:</strong>");
		expect(email.html).toContain("Review the changes in this brief before your next campaign decision.");
		expect(email.text).toContain("Why this matters: This period matters because pricing or offers moved (1 change)");
		expect(email.text).toContain("Accountable reviewer: Owner");
		expect(email.text).toContain("Next action: Review the changes in this brief before your next campaign decision.");
	});

	it("names CTA movement as the materiality reason", () => {
		const email = buildDigestEmail(
			digestEmailInput({
				items: [
					{
						...digestItem("boAt", "CTA changed", 80, "scan_backed"),
						eventType: "landing_page_cta_changed",
					},
					{
						...digestItem("Mamaearth", "CTA changed", 70, "scan_backed"),
						eventType: "landing_page_cta_changed",
					},
				],
			}),
		);

		expect(email.html).toContain("landing page CTAs changed (2)");
		expect(email.text).toContain("This period matters because landing page CTAs changed (2)");
		expect(email.text).toContain("Accountable reviewer: Owner");
		expect(email.text).toContain("Next action:");
	});

	it("labels cosmetic-only periods without inventing pricing or CTA movement", () => {
		const email = buildDigestEmail(
			digestEmailInput({
				items: [
					{
						...digestItem("Plum", "Headline changed", 65, "scan_backed"),
						eventType: "landing_page_headline_changed",
					},
					{
						...digestItem("Sugar", "Form changed", 60, "scan_backed"),
						eventType: "landing_page_form_changed",
					},
					{
						...digestItem("Wow", "Creative copy", 55, "scan_backed"),
						eventType: "landing_page_headline_changed",
						metadata: {
							...digestItem("Wow", "Creative copy", 55, "scan_backed").metadata,
							kind: "creative_copy",
						},
					},
				],
			}),
		);

		// P2: creative copy stays cosmetic only when no material event type
		// backs it (an ad_new event with creative-copy metadata is a campaign
		// type, so this period deliberately carries no campaign event).
		expect(email.html).toContain("Cosmetic-only changes this period (3 headline, form, or creative updates)");
		expect(email.html).not.toContain("pricing or offers moved");
		expect(email.html).toContain("Accountable reviewer:</strong> Owner");
		expect(email.text).toContain("Accountable reviewer: Owner");
		expect(email.text).toContain("Next action:");
		expect(email.text).toContain("Review the changes in this brief before your next campaign decision.");
	});

	it("uses the shared triage explanation as the materiality reason for all-quiet periods", () => {
		const email = buildDigestEmail(
			digestEmailInput({
				items: [],
				heartbeat: {
					runs: 7,
					watchlistsChecked: 4,
					adsSeen: 128,
					triage: {
						status: "all_quiet",
						label: "All quiet",
						explanation: "Checks completed and nothing changed across the sources that ran.",
						checkedAt: "2026-06-08T04:00:00.000Z",
						checksCompleted: 7,
						suppressedChanges: 0,
						suppressionReasons: [],
						nextAction: "We check again at the next scheduled scan.",
						noActionLine: "No action needed — nothing new to act on.",
					},
				},
			}),
		);

		expect(email.html).toContain("Checks completed and nothing changed across the sources that ran.");
		expect(email.html).toContain("Accountable reviewer:</strong> Owner");
		expect(email.text).toContain("Why this matters: Checks completed and nothing changed across the sources that ran.");
		expect(email.text).toContain("Accountable reviewer: Owner");
		expect(email.text).toContain("Next action: We check again at the next scheduled scan.");
	});

	it("names the failed check as the materiality reason for failed-check periods", () => {
		const email = buildDigestEmail(
			digestEmailInput({
				items: [],
				heartbeat: {
					runs: 7,
					watchlistsChecked: 4,
					adsSeen: 128,
					triage: {
						status: "evidence_failed",
						label: "Evidence check failed",
						explanation:
							"An evidence check couldn't finish, so nothing is confirmed yet.",
						checkedAt: "2026-06-08T04:00:00.000Z",
						checksCompleted: 6,
						suppressedChanges: 0,
						suppressionReasons: [],
						nextAction:
							"We'll retry at the next scheduled check. If it persists, email support and we'll dig in.",
						noActionLine: "No change is confirmed without proof.",
					},
				},
			}),
		);

		expect(email.html).toContain(
			"An evidence check couldn&#039;t finish, so nothing is confirmed yet.",
		);
		expect(email.text).toContain(
			"Why this matters: An evidence check couldn't finish, so nothing is confirmed yet.",
		);
		expect(email.text).toContain(
			"Next action: We'll retry at the next scheduled check. If it persists, email support and we'll dig in.",
		);
		expect(email.text).toContain("Accountable reviewer: Owner");
	});

	it("states the completed-check facts for legacy quiet heartbeats without a triage", () => {
		const email = buildDigestEmail(
			digestEmailInput({
				items: [],
				heartbeat: { runs: 3, watchlistsChecked: 2, adsSeen: 42 },
			}),
		);

		expect(email.text).toContain(
			"Why this matters: No action-worthy movement across 2 competitors — 3 checks completed and 42 ads reviewed.",
		);
		expect(email.text).toContain("Accountable reviewer: Owner");
		expect(email.text).toContain("Next action: We check again at the next scheduled scan.");
	});

	it("falls back to the truthful Workspace owner label when the recipient name is blank", () => {
		const email = buildDigestEmail(
			digestEmailInput({
				name: "",
				items: [digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed")],
			}),
		);

		expect(email.html).toContain("<strong>Accountable reviewer:</strong> Workspace owner");
		expect(email.text).toContain("Accountable reviewer: Workspace owner");
	});

	it("never renders a generic digest for an empty period with no heartbeat — explicit failure state", () => {
		const email = buildDigestEmail(
			digestEmailInput({
				items: [],
				heartbeat: null,
			}),
		);

		expect(email.subject).toBe("Your brief is missing its period record");
		expect(email.html).toContain("This brief is missing its period record.");
		expect(email.html).toContain("No materiality record for this period");
		expect(email.html).toContain(
			"Contact support — this brief is missing its period record and cannot be reviewed as filed.",
		);
		expect(email.html).toContain("<strong>Accountable reviewer:</strong> Owner");
		expect(email.text).toContain("Why this matters: No materiality record for this period");
		expect(email.text).toContain("Next action: Contact support");
		expect(email.subject).not.toContain("0 changes found");
		expect(email.html).not.toContain("0 changes found");
	});

	it("carries the same three values in the scan-trouble notice", () => {
		const email = buildScanTroubleEmail({
			watchlistNames: ["Nykaa", "boAt"],
			watchlistsUrl: "https://0509.io/app/watchlists",
			manageFrequencyUrl: "https://0509.io/app/notifications",
			supportEmail: "support@0509.io",
			supportMailto: "mailto:support@0509.io",
			unsubscribeUrl: null,
		});

		expect(email.html).toContain("<strong>Why this matters:</strong>");
		expect(email.html).toContain("We couldn&#039;t complete checks for Nykaa, boAt in this period.");
		expect(email.html).toContain("<strong>Accountable reviewer:</strong> Workspace owner");
		expect(email.html).toContain("<strong>Next action:</strong>");
		expect(email.text).toContain("Why this matters: We couldn't complete checks for Nykaa, boAt in this period.");
		expect(email.text).toContain("Accountable reviewer: Workspace owner");
		expect(email.text).toContain(
			"Next action: We'll try again at the next scheduled check — you don't need to do anything now.",
		);
	});

	it("shares one truthful vocabulary between app and email surfaces", () => {
		const items = [
			{
				...digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
				eventType: "landing_page_offer_changed",
			},
		];
		expect(digestMaterialityReason({ items })).toBe(
			"This period matters because pricing or offers moved (1 change) — compare before your next campaign decision.",
		);
		expect(digestNextAction({ items })).toBe(
			"Review the changes in this brief before your next campaign decision.",
		);
		expect(digestReviewerLabel("Priya")).toBe("Priya");
		expect(digestReviewerLabel("")).toBe("Workspace owner");
		expect(digestReviewerLabel(null)).toBe("Workspace owner");
		expect(digestMaterialityReason({ items: [], triage: { status: "all_quiet", explanation: "Checks completed and nothing changed across the sources that ran." } })).toBe(
			"Checks completed and nothing changed across the sources that ran.",
		);
		expect(digestNextAction({ items: [], heartbeat: { runs: 3 } })).toBe(
			"We check again at the next scheduled scan.",
		);
	});

	it("derives an alert materiality reason from the shared event vocabulary (E2 alert increment)", () => {
		const offerChange = { eventType: "landing_page_offer_changed" };
		const headlineChange = { eventType: "landing_page_headline_changed" };
		const newAd = { eventType: "ad_new" };
		const urlChange = { eventType: "landing_page_url_changed" };

		expect(alertMaterialityReason({ events: [offerChange] })).toBe(
			"This alert matters because pricing or offers moved (1 change) — compare before your next campaign decision.",
		);
		expect(alertMaterialityReason({ events: [offerChange, newAd] })).toBe(
			"This alert matters because pricing or offers moved (1 change) and ads started or stopped (1) — compare before your next campaign decision.",
		);
		expect(alertMaterialityReason({ events: [urlChange] })).toBe(
			"This alert matters because destinations changed (1) — compare before your next campaign decision.",
		);
	});

	it("states provisional, baseline, and cosmetic-only alert truth explicitly", () => {
		const offerChange = { eventType: "landing_page_offer_changed" };
		const headlineChange = { eventType: "landing_page_headline_changed" };

		// Provisional alerts never claim a verified move.
		expect(alertMaterialityReason({ events: [offerChange], provisional: true })).toBe(
			"This alert is provisional — the change is not yet confirmed by a fresh proof capture, so verify the source before acting.",
		);
		// Baseline first-scan alerts are starting snapshots, not new moves.
		expect(alertMaterialityReason({ events: [offerChange], baseline: true })).toBe(
			"This alert is your starting snapshot — it anchors future alerts instead of marking a new competitor move.",
		);
		// Cosmetic-only alerts name what moved without inventing a decision weight.
		expect(alertMaterialityReason({ events: [headlineChange] })).toBe(
			"A tracked page changed its headline, form, or creative (1 update) — the competitor is iterating, and nothing in this alert touched pricing or CTA.",
		);
		// Never an empty reason, whatever the shape.
		expect(alertMaterialityReason({})).toBe(
			"This alert matters because a change was detected on a tracked competitor page — review the evidence before your next decision.",
		);
	});

	it("classifies offer-bearing creative copy as price movement, not cosmetic (P2)", () => {
		const offerCreativeCopy = {
			eventType: "landing_page_offer_changed",
			metadata: { kind: "creative_copy" },
		};
		// The explicit offer event type wins over the generic creative-copy
		// hint: a hook/offer rewrite on a known ad is pricing movement.
		expect(alertMaterialityReason({ events: [offerCreativeCopy] })).toBe(
			"This alert matters because pricing or offers moved (1 change) — compare before your next campaign decision.",
		);
		expect(digestMaterialityReason({ items: [offerCreativeCopy] })).toBe(
			"This period matters because pricing or offers moved (1 change) — compare before your next campaign decision.",
		);
	});

	it("classifies CTA-bearing creative copy as CTA movement (P2)", () => {
		const ctaCreativeCopy = {
			eventType: "landing_page_cta_changed",
			metadata: { kind: "creative_copy" },
		};
		expect(alertMaterialityReason({ events: [ctaCreativeCopy] })).toBe(
			"This alert matters because landing page CTA changed (1) — compare before your next campaign decision.",
		);
		expect(digestMaterialityReason({ items: [ctaCreativeCopy] })).toBe(
			"This period matters because landing page CTA changed (1) — compare before your next campaign decision.",
		);
	});

	it("classifies campaign-type creative copy as campaign movement (P2)", () => {
		const newAdCreativeCopy = {
			eventType: "ad_new",
			metadata: { kind: "creative_copy" },
		};
		// ad_new is a campaign event type, so creative-copy metadata on it can
		// never degrade the event to cosmetic.
		expect(alertMaterialityReason({ events: [newAdCreativeCopy] })).toBe(
			"This alert matters because ads started or stopped (1) — compare before your next campaign decision.",
		);
	});

	it("keeps creative copy cosmetic when no material event type backs it (P2)", () => {
		const headlineCreativeCopy = {
			eventType: "landing_page_headline_changed",
			metadata: { kind: "creative_copy" },
		};
		expect(alertMaterialityReason({ events: [headlineCreativeCopy] })).toBe(
			"A tracked page changed its headline, form, or creative (1 update) — the competitor is iterating, and nothing in this alert touched pricing or CTA.",
		);
		expect(digestMaterialityReason({ items: [headlineCreativeCopy] })).toBe(
			"Cosmetic-only changes this period (1 headline, form, or creative update) — no pricing or CTA movement, so there is nothing new to weigh for positioning.",
		);
	});

	it("keeps baselines as starting snapshots even though they ride the ad_new type (P2)", () => {
		const baselineEvent = { eventType: "ad_new", metadata: { kind: "baseline" } };
		expect(alertMaterialityReason({ events: [baselineEvent], baseline: true })).toBe(
			"This alert is your starting snapshot — it anchors future alerts instead of marking a new competitor move.",
		);
		// Classified cosmetic at the vocabulary level: never "ads started or
		// stopped" for a first-scan baseline.
		expect(digestMaterialityReason({ items: [baselineEvent] })).toBe(
			"Cosmetic-only changes this period (1 headline, form, or creative update) — no pricing or CTA movement, so there is nothing new to weigh for positioning.",
		);
	});
});

describe("brief confidence and freshness — the retention loop (E3 2026-08-11)", () => {
	function item(
		eventType: string,
		sourceStatus: "proof_backed" | "scan_backed",
		overrides: Record<string, unknown> = {},
	) {
		return {
			eventType,
			metadata: {
				sourceStatus,
				...(sourceStatus === "proof_backed" ? { proofCaptureId: "proof-1" } : {}),
				...overrides,
			},
		};
	}

	it("rates fully verified changes high", () => {
		const items = [
			item("landing_page_offer_changed", "proof_backed"),
			item("landing_page_cta_changed", "proof_backed"),
		];
		expect(digestConfidenceLevel({ items })).toBe("high");
		expect(digestConfidenceLabel({ items })).toBe(
			"High confidence — every filed change is verified against stored evidence.",
		);
	});

	it("rates check-spotted changes medium until evidence verifies them", () => {
		const items = [item("ad_new", "scan_backed")];
		expect(digestConfidenceLevel({ items })).toBe("medium");
		expect(digestConfidenceLabel({ items })).toBe(
			"Medium confidence — changes are check-spotted but not yet verified against stored evidence.",
		);
	});

	it("rates mixed verified and check-spotted changes medium", () => {
		const items = [
			item("landing_page_offer_changed", "proof_backed"),
			item("ad_new", "scan_backed"),
		];
		expect(digestConfidenceLevel({ items })).toBe("medium");
	});

	it("rates periods with unverified items low and names the count", () => {
		const items = [
			item("ad_new", "scan_backed", { status: "proof_pending" }),
			item("ad_new", "proof_backed"),
		];
		expect(digestConfidenceLevel({ items })).toBe("low");
		expect(digestConfidenceLabel({ items })).toBe(
			"Low confidence — 1 of 2 filed changes is not backed by verified evidence.",
		);
	});

	it("rates evidence-failed and evidence-pending periods low from the triage", () => {
		expect(
			digestConfidenceLabel({
				items: [],
				triage: { status: "evidence_failed", explanation: "An evidence check couldn't finish." },
			}),
		).toBe("Low confidence — an evidence check failed, so no change is confirmed this period.");
		expect(
			digestConfidenceLabel({
				items: [],
				triage: { status: "evidence_pending", explanation: "A possible change was detected." },
			}),
		).toBe("Low confidence — detected changes are still waiting on their evidence check.");
	});

	it("rates completed quiet and routine periods high for what was checked", () => {
		expect(
			digestConfidenceLabel({
				items: [],
				triage: { status: "all_quiet", explanation: "Checks completed and nothing changed." },
			}),
		).toBe("High confidence — checks completed across the sources that ran.");
		expect(
			digestConfidenceLabel({
				items: [],
				triage: { status: "routine_only", explanation: "Routine changes only." },
			}),
		).toBe("High confidence — checks completed across the sources that ran.");
	});

	it("rates completed legacy heartbeats high and not-run periods not rated", () => {
		expect(digestConfidenceLabel({ heartbeat: { runs: 3 } })).toBe(
			"High confidence — completed checks reviewed the sources that ran.",
		);
		expect(digestConfidenceLabel({ heartbeat: { runs: 3 }, triage: { status: "not_run" } })).toBe(
			"Not rated — no checks completed in this period, so nothing in this brief is confirmed.",
		);
	});

	it("renders the explicit failure state when no confidence record exists", () => {
		expect(digestConfidenceLevel({})).toBe("none");
		expect(digestConfidenceLabel({})).toBe(
			"No confidence record for this period — treat every claim in this brief as unverified.",
		);
	});

	it("names the next Monday 03:00 UTC check as the weekly brief's expiry", () => {
		// Filed Wednesday; the next weekly check is the coming Monday 03:00 UTC.
		expect(
			digestFreshUntilLabel({
				cadence: "weekly",
				after: "2026-07-15T09:14:00.000Z",
				timeZone: "UTC",
			}),
		).toBe("Fresh until the next weekly check, Mon 20 Jul, 3:00 am.");
	});

	it("uses the last completed check as the freshness anchor when known", () => {
		// Monday 04:00 UTC check: the same day's 03:00 slot already passed, so
		// the next weekly check is the following Monday.
		expect(
			digestFreshUntilLabel({
				cadence: "weekly",
				after: "2026-07-20T04:00:00.000Z",
				timeZone: "UTC",
			}),
		).toBe("Fresh until the next weekly check, Mon 27 Jul, 3:00 am.");
	});

	it("names the next 3-hour scan slot for daily digests", () => {
		expect(
			digestFreshUntilLabel({
				cadence: "daily",
				scanCadence: "every_3h",
				after: "2026-06-02T00:00:00.000Z",
				timeZone: "UTC",
			}),
		).toBe("Fresh until the next check, Tue 2 Jun, 3:00 am.");
	});

	it("names the next 6-hour scan slot for scout cadence", () => {
		expect(
			digestFreshUntilLabel({
				cadence: "weekly",
				scanCadence: "every_6h",
				after: "2026-06-08T04:00:00.000Z",
				timeZone: "UTC",
			}),
		).toBe("Fresh until the next check, Mon 8 Jun, 6:00 am.");
	});

	it("renders the explicit failure state when no next check is schedulable", () => {
		expect(
			digestFreshUntilLabel({
				cadence: "weekly",
				scanCadence: "none",
				after: "2026-06-08T04:00:00.000Z",
			}),
		).toBe("Freshness unavailable — no next check is scheduled on file for this brief.");
	});
});

describe("brief emails carry confidence and freshness (E3 2026-08-11)", () => {
	function briefEmailInput(
		overrides: Partial<Parameters<typeof buildDigestEmail>[0]> = {},
	) {
		return {
			name: "Owner",
			periodStart: "2026-06-01T00:00:00.000Z",
			periodEnd: "2026-06-08T00:00:00.000Z",
			cadence: "weekly" as const,
			scanCadence: "weekly" as const,
			timeZone: "UTC",
			items: [digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed")],
			fullDigestUrl: "https://0509.io/app/digests",
			manageFrequencyUrl: "https://0509.io/app/notifications",
			supportEmail: "support@0509.io",
			supportMailto: "mailto:support@0509.io",
			unsubscribeUrl: null,
			...overrides,
		};
	}

	it("carries confidence and the next-check expiry on a changes brief", () => {
		const email = buildDigestEmail(briefEmailInput());

		expect(email.html).toContain("<strong>Confidence:</strong>");
		expect(email.html).toContain(
			"High confidence — every filed change is verified against stored evidence.",
		);
		expect(email.html).toContain("<strong>Fresh until:</strong>");
		expect(email.html).toContain(
			"Fresh until the next weekly check, Mon 8 Jun, 3:00 am.",
		);
		expect(email.text).toContain(
			"Confidence: High confidence — every filed change is verified against stored evidence.",
		);
		expect(email.text).toContain(
			"Fresh until: Fresh until the next weekly check, Mon 8 Jun, 3:00 am.",
		);
	});

	it("states low confidence and the plan cadence's next check for an evidence-failed brief", () => {
		const email = buildDigestEmail(
			briefEmailInput({
				items: [],
				scanCadence: "every_3h",
				heartbeat: {
					runs: 6,
					watchlistsChecked: 2,
					adsSeen: 40,
					triage: {
						status: "evidence_failed",
						label: "Evidence check failed",
						explanation:
							"An evidence check couldn't finish, so nothing is confirmed yet.",
						checkedAt: "2026-06-08T04:00:00.000Z",
						checksCompleted: 6,
						suppressedChanges: 0,
						suppressionReasons: [],
						nextAction:
							"We'll retry at the next scheduled check. If it persists, email support and we'll dig in.",
						noActionLine: "No change is confirmed without proof.",
					},
				},
			}),
		);

		expect(email.html).toContain(
			"Low confidence — an evidence check failed, so no change is confirmed this period.",
		);
		expect(email.html).toContain(
			"Fresh until the next check, Mon 8 Jun, 6:00 am.",
		);
	});

	it("carries the honest quiet confidence on an all-quiet brief", () => {
		const email = buildDigestEmail(
			briefEmailInput({
				items: [],
				heartbeat: {
					runs: 7,
					watchlistsChecked: 4,
					adsSeen: 128,
					triage: {
						status: "all_quiet",
						label: "All quiet",
						explanation: "Checks completed and nothing changed across the sources that ran.",
						checkedAt: "2026-06-08T04:00:00.000Z",
						checksCompleted: 7,
						suppressedChanges: 0,
						suppressionReasons: [],
						nextAction: "We check again at the next scheduled scan.",
						noActionLine: "No action needed — nothing new to act on.",
					},
				},
			}),
		);

		expect(email.html).toContain(
			"High confidence — checks completed across the sources that ran.",
		);
		expect(email.html).toContain(
			"Fresh until the next weekly check, Mon 15 Jun, 3:00 am.",
		);
	});

	it("carries the explicit failure states on the missing-period-record brief", () => {
		const email = buildDigestEmail(
			briefEmailInput({ items: [], heartbeat: null }),
		);

		expect(email.html).toContain(
			"No confidence record for this period — treat every claim in this brief as unverified.",
		);
		expect(email.html).toContain(
			"Fresh until the next weekly check, Mon 8 Jun, 3:00 am.",
		);
		expect(email.text).toContain(
			"Confidence: No confidence record for this period — treat every claim in this brief as unverified.",
		);
	});

	it("keeps instant-alert accountability blocks free of confidence and freshness lines", () => {
		const block = renderEmailAccountabilityBlock({
			materialityReason: "A change was detected on a tracked competitor page.",
			reviewerLabel: "Workspace owner",
		});

		expect(block).toContain("<strong>Why this matters:</strong>");
		expect(block).toContain("<strong>Accountable reviewer:</strong>");
		expect(block).not.toContain("<strong>Confidence:</strong>");
		expect(block).not.toContain("<strong>Fresh until:</strong>");
	});
});

describe("authenticated briefs route accountability (E2 2026-08-08)", () => {
	type Props = { children?: ReactNode } & Record<string, unknown>;

	function component(tag: string) {
		return ({ children, ...props }: Props) => createElement(tag, props, children);
	}

	function mockDigestsRoute(loaderData: unknown) {
		vi.doMock("react-router", async () => {
			const actual = await vi.importActual<typeof import("react-router")>("react-router");
			return {
				...actual,
				Form: component("form"),
				Link: ({ children, to, ...props }: Props & { to?: string }) =>
					createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
				useActionData: () => null,
				useLoaderData: () => loaderData,
				useNavigation: () => ({ state: "idle", location: null }),
				useSearchParams: () => [new URLSearchParams(""), vi.fn()],
			};
		});

		vi.doMock("~/components/dashboard-page", () => ({
			DashboardPage: component("main"),
			DashboardPageHeader: ({ title, lead }: { title: string; lead?: string }) =>
				createElement("header", null, createElement("h1", null, title), lead),
		}));
		vi.doMock("~/components/dashboard-route-loading", () => ({
			DashboardRouteError: component("div"),
			DashboardRouteLoading: component("div"),
		}));
		vi.doMock("~/components/copy-button", () => ({ CopyButton: component("button") }));
		vi.doMock("~/components/local-time", () => ({
			LocalTime: ({ iso }: { iso: string }) => createElement("time", null, iso),
		}));
		vi.doMock("~/components/plan-limit-state", () => ({ PlanLimitState: component("div") }));
		vi.doMock("~/components/submit-button", () => ({ SubmitButton: component("button") }));
	}

	function digestFixture(
		items: Array<Record<string, unknown>>,
		summary: Record<string, unknown> | null,
		reviewerName: string | null,
	) {
		const digest = {
			id: "digest-1",
			periodStart: "2026-07-08T00:00:00.000Z",
			periodEnd: "2026-07-15T00:00:00.000Z",
			createdAt: "2026-07-15T09:14:00.000Z",
			items,
			summary,
			delivery: null,
		};
		return {
			digests: [digest],
			digestAttemptsByDigestId: { "digest-1": [] },
			selectedDigest: digest,
			selectedDigestAttempts: [],
			canAccessDigests: true,
			reviewerName,
			// E3 (2026-08-11): the loader resolves the plan scan cadence and the
			// filed period's digest cadence for the confidence/freshness rows.
			plan: "starter",
			scanCadence: "every_3h",
			selectedDigestCadence: "weekly",
		};
	}

	async function renderDigestsRoute(loaderData: unknown) {
		await mockDigestsRoute(loaderData);
		const { default: DigestsRoute } = await import("~/routes/app.digests");
		return renderToStaticMarkup(createElement(DigestsRoute));
	}

	beforeEach(() => vi.resetModules());
	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("renders materiality reason, reviewer, and next action for a price change brief", async () => {
		const markup = await renderDigestsRoute(
			digestFixture(
				[
					{
						id: "item-1",
						watchlistName: "Nykaa",
						eventType: "landing_page_offer_changed",
						title: "Landing page offer changed",
						summary: "The offer moved.",
						metadata: {
							priorityScore: 95,
							priorityBand: "High priority",
							recommendedAction: "Review before the next campaign decision.",
							proofTrail: "Verified from a page snapshot",
							sourceStatus: "proof_backed",
						},
					},
				],
				null,
				"Priya",
			),
		);

		expect(markup).toContain("Why this matters");
		expect(markup).toContain("pricing or offers moved (1 change)");
		expect(markup).toContain("Accountable reviewer");
		expect(markup).toContain("Priya");
		expect(markup).toContain("Next action");
		expect(markup).toContain("Review the changes in this brief before your next campaign decision.");
	});

	it("renders confidence and the next-check freshness on a price change brief (E3)", async () => {
		const markup = await renderDigestsRoute(
			digestFixture(
				[
					{
						id: "item-1",
						watchlistName: "Nykaa",
						eventType: "landing_page_offer_changed",
						title: "Landing page offer changed",
						summary: "The offer moved.",
						metadata: {
							priorityScore: 95,
							priorityBand: "High priority",
							recommendedAction: "Review before the next campaign decision.",
							proofTrail: "Verified from a page snapshot",
							proofCaptureId: "proof-1",
							sourceStatus: "proof_backed",
						},
					},
				],
				null,
				"Priya",
			),
		);

		expect(markup).toContain("Confidence");
		expect(markup).toContain(
			"High confidence — every filed change is verified against stored evidence.",
		);
		expect(markup).toContain("Fresh until");
		expect(markup).toContain("Fresh until the next check, Wed 15 Jul, 3:00 am.");
	});

	it("renders the quiet confidence and weekly freshness for an all-quiet brief (E3)", async () => {
		const markup = await renderDigestsRoute(
			digestFixture(
				[],
				{
					triage: {
						status: "all_quiet",
						label: "All quiet",
						explanation: "Checks completed and nothing changed across the sources that ran.",
						sourceStatus: "checked",
						checkedAt: "2026-07-15T04:00:00.000Z",
						checksCompleted: 7,
						changesCaptured: 0,
						suppressedChanges: 0,
						suppressionReasons: [],
						nextAction: "We check again at the next scheduled scan.",
						noActionLine: "No action needed — nothing new to act on.",
					},
				},
				"Priya",
			),
		);

		expect(markup).toContain(
			"High confidence — checks completed across the sources that ran.",
		);
		expect(markup).toContain("Fresh until the next check, Wed 15 Jul, 6:00 am.");
	});

	it("renders the confidence failure state when a brief has no period record (E3)", async () => {
		const markup = await renderDigestsRoute(
			digestFixture([], null, "Priya"),
		);

		expect(markup).toContain(
			"No confidence record for this period — treat every claim in this brief as unverified.",
		);
		expect(markup).toContain("Fresh until");
	});

	it("renders the explicit failure state when no owner identity is available", async () => {
		const markup = await renderDigestsRoute(
			digestFixture([], null, null),
		);

		expect(markup).toContain(
			"Reviewer not recorded — no workspace owner identity is on file.",
		);
		expect(markup).toContain("Why this matters");
		expect(markup).toContain("Next action");
	});

	it("renders the shared triage copy for an all-quiet brief", async () => {
		const markup = await renderDigestsRoute(
			digestFixture(
				[],
				{
					triage: {
						status: "all_quiet",
						label: "All quiet",
						explanation: "Checks completed and nothing changed across the sources that ran.",
						sourceStatus: "checked",
						checkedAt: "2026-07-15T04:00:00.000Z",
						checksCompleted: 7,
						changesCaptured: 0,
						suppressedChanges: 0,
						suppressionReasons: [],
						nextAction: "We check again at the next scheduled scan.",
						noActionLine: "No action needed — nothing new to act on.",
					},
				},
				"Priya",
			),
		);

		expect(markup).toContain("Checks completed and nothing changed across the sources that ran.");
		expect(markup).toContain("Priya");
		expect(markup).toContain("We check again at the next scheduled scan.");
	});

	it("renders the failed-check period as a visible failure record, never all quiet", async () => {
		const markup = await renderDigestsRoute(
			digestFixture(
				[],
				{
					triage: {
						status: "evidence_failed",
						label: "Evidence check failed",
						explanation:
							"An evidence check couldn't finish, so nothing is confirmed yet.",
						sourceStatus: "evidence_failed",
						checkedAt: null,
						checksCompleted: 6,
						changesCaptured: 0,
						suppressedChanges: 0,
						suppressionReasons: [],
						nextAction:
							"We'll retry at the next scheduled check. If it persists, email support and we'll dig in.",
						noActionLine: "No change is confirmed without proof.",
					},
				},
				"Priya",
			),
		);

		expect(markup).toContain(
			"An evidence check couldn&#x27;t finish, so nothing is confirmed yet.",
		);
		expect(markup).toContain("Priya");
		expect(markup).toContain("We&#x27;ll retry at the next scheduled check.");
	});
});

function strategyEmailInput() {
	return {
		name: "Owner",
		periodStart: "2026-06-01T00:00:00.000Z",
		periodEnd: "2026-06-08T00:00:00.000Z",
		cadence: "weekly" as const,
		timeZone: "UTC",
		fullDigestUrl: "https://0509.io/app/digests",
		manageFrequencyUrl: "https://0509.io/app/notifications",
		supportEmail: "support@0509.io",
		supportMailto: "mailto:support@0509.io",
		unsubscribeUrl: null,
		items: [digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed")],
	};
}

function digestItem(
  watchlistName: string,
  title: string,
  priorityScore: number,
  sourceStatus: "proof_backed" | "scan_backed",
  eventIdOverride?: string,
) {
  const slug = watchlistName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return {
    watchlistName,
    watchlistId: `wl-${slug}`,
    eventId: eventIdOverride ?? `ev-${slug}`,
    eventType: title.includes("offer")
      ? "landing_page_offer_changed"
      : title.includes("CTA")
        ? "landing_page_cta_changed"
        : "ad_new",
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

describe("buildDigestEmail — brief retention frame (lane 1)", () => {
  it("renders the four retention fields with previous-brief delta on the weekly brief", () => {
    const email = buildDigestEmail({
      name: "Priya",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
      ],
      previousBriefItemCount: 2,
      hasPreviousBrief: true,
      nextScanAt: "2026-06-15T03:00:00.000Z",
      nextScanLabel: "Mon 15 Jun, 3:00 am UTC",
    });

    expect(email.html).toContain("Brief retention");
    expect(email.html).toContain("Since last brief:");
    expect(email.html).toContain("Accountable reviewer:");
    expect(email.html).toContain("Confidence:");
    expect(email.html).toContain("Expiry:");
    expect(email.html).toContain("Priya");
    expect(email.html).toContain("1 change filed");
    expect(email.html).toContain("1 change fewer than the previous brief");
    expect(email.html).toContain("Expires at the next check");

    expect(email.text).toContain("Brief retention:");
    expect(email.text).toContain("Since last brief: 1 change filed");
    expect(email.text).toContain("Accountable reviewer: Priya");
    expect(email.text).toContain("Expiry: Expires at the next check");
  });

  it("renders the first-brief baseline delta when no previous brief is on file", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "UTC",
      fullDigestUrl: "https://0509.io/app/digests",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: null,
      items: [
        digestItem("Boat", "CTA changed", 80, "scan_backed"),
      ],
      hasPreviousBrief: false,
    });

    expect(email.html).toContain("first brief on file");
    expect(email.html).toContain("Expiry unset");
  });
});
