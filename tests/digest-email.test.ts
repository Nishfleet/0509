import { describe, expect, it } from "vitest";

import {
  buildDigestAccountabilityReason,
  DIGEST_REVIEWER_MISSING_LABEL,
  DIGEST_WORKSPACE_OWNER_ROLE_LABEL,
  resolveDigestReviewer,
} from "~/lib/change-intelligence";
import {
  buildDigestEmail,
  buildScanTroubleEmail,
  digestItemDeepLink,
  groupTopMovesByWatchlist,
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

	describe("named-owner brief accountability (2026-08-08)", () => {
		it("renders a materiality reason, one accountable reviewer, and one next action for price, CTA, and cosmetic changes", () => {
			const email = buildDigestEmail({
				name: "Owner",
				periodStart: "2026-06-01T00:00:00.000Z",
				periodEnd: "2026-06-08T00:00:00.000Z",
				cadence: "weekly",
				timeZone: "UTC",
				items: [
					{
						...digestItem("Nykaa", "Landing page offer changed", 95, "proof_backed"),
						eventType: "landing_page_offer_changed",
					},
					{
						...digestItem("boAt", "CTA changed", 80, "scan_backed"),
						eventType: "landing_page_cta_changed",
					},
					{
						...digestItem("Plum", "Headline changed", 55, "scan_backed"),
						eventType: "landing_page_headline_changed",
					},
				],
				fullDigestUrl: "https://0509.io/app/digests",
				manageFrequencyUrl: "https://0509.io/app/notifications",
				supportEmail: "support@0509.io",
				supportMailto: "mailto:support@0509.io",
				unsubscribeUrl: null,
			});

			expect(email.html).toContain("Accountability");
			expect(email.html).toContain("Why this matters:");
			expect(email.html).toContain(
				"3 changes across 3 competitors: 1 pricing or offer change, 1 CTA change, 1 headline change.",
			);
			expect(email.html).toContain(
				"Pricing and offer moves change the buying decision directly.",
			);
			expect(email.html).toContain("Next action:</strong> Review the changes in your brief.");
			expect(email.html).toContain("Accountable reviewer:</strong> Owner");
			expect(email.text).toContain("Why this matters:");
			expect(email.text).toContain("Next action: Review the changes in your brief.");
			expect(email.text).toContain("Accountable reviewer: Owner");
			// Per-item next actions stay untouched.
			expect(email.html).toContain("Suggested next action:");
		});

		it("keeps materiality reason and next action for all-quiet periods", () => {
			const email = buildDigestEmail(
				triageEmailInput({
					runs: 7,
					watchlistsChecked: 4,
					adsSeen: 128,
					triage: triage("all_quiet", {
						explanation:
							"Checks completed and nothing changed across the sources that ran.",
					}),
				}),
			);

			expect(email.html).toContain("Accountable reviewer:</strong> Owner");
			expect(email.text).toContain("Accountable reviewer: Owner");
			// Materiality reason and next action ride the shared triage vocabulary.
			expect(email.html).toContain(
				"Checks completed and nothing changed across the sources that ran.",
			);
			expect(email.html).toContain("We check again at the next scheduled scan.");
		});

		it("keeps materiality reason and next action for failed-check periods", () => {
			const email = buildDigestEmail(
				triageEmailInput({
					runs: 7,
					watchlistsChecked: 4,
					adsSeen: 128,
					triage: triage("evidence_failed", {
						explanation:
							"An evidence check couldn't finish, so nothing is confirmed yet.",
						nextAction:
							"We'll retry at the next scheduled check. If it persists, email support and we'll dig in.",
					}),
				}),
			);

			expect(email.html).toContain("Accountable reviewer:</strong> Owner");
			expect(email.text).toContain("Accountable reviewer: Owner");
			expect(email.text).toContain(
				"An evidence check couldn't finish, so nothing is confirmed yet.",
			);
			expect(email.text).toContain("We'll retry at the next scheduled check");
		});

		it("renders an explicit failure state instead of a generic digest when no owner identity is available", () => {
			const email = buildDigestEmail({
				...strategyEmailInput(),
				name: "",
				ownerLabel: null,
			});

			expect(email.html).toContain(
				"Accountable reviewer:</strong> Reviewer not recorded.",
			);
			expect(email.html).toContain(
				"No accountable owner could be confirmed for this workspace.",
			);
			expect(email.html).toContain("Contact support before relying on this brief.");
			expect(email.text).toContain("Accountable reviewer: Reviewer not recorded.");
			expect(email.text).toContain("Contact support before relying on this brief.");
			// Materiality and next action remain — only ownership is the failure.
			expect(email.html).toContain("Why this matters:");
			expect(email.html).toContain("Next action:");
		});

		it("names the reviewer on legacy all-quiet heartbeats and adds an explicit next action", () => {
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

			expect(email.html).toContain("Accountable reviewer:</strong> Owner");
			expect(email.text).toContain("Accountable reviewer: Owner");
			expect(email.text).toContain(
				"Next action: We check again at the next scheduled scan.",
			);
		});
	});
});

describe("shared digest accountability vocabulary (app + email)", () => {
  it("composes a non-empty materiality reason from price, CTA, and cosmetic items", () => {
    const reason = buildDigestAccountabilityReason({
      items: [
        { eventType: "landing_page_offer_changed", watchlistName: "Nykaa" },
        { eventType: "landing_page_cta_changed", watchlistName: "boAt" },
        { eventType: "landing_page_headline_changed", watchlistName: "Plum" },
      ],
    });

    expect(reason.materialityReason).toContain(
      "1 pricing or offer change, 1 CTA change, 1 headline change",
    );
    expect(reason.materialityReason).toContain("across 3 competitors");
    expect(reason.materialityReason.trim().length).toBeGreaterThan(0);
    expect(reason.nextAction).toBe("Review the changes in your brief.");
  });

  it("uses the triage explanation and next action verbatim for all-quiet and failed periods", () => {
    const quiet = buildDigestAccountabilityReason({
      items: [],
      triage: {
        status: "all_quiet",
        explanation: "Checks completed and nothing changed across the sources that ran.",
        nextAction: "We check again at the next scheduled scan.",
      },
    });
    expect(quiet.materialityReason).toBe(
      "Checks completed and nothing changed across the sources that ran.",
    );
    expect(quiet.nextAction).toBe("We check again at the next scheduled scan.");

    const failed = buildDigestAccountabilityReason({
      items: [],
      triage: {
        status: "evidence_failed",
        explanation: "An evidence check couldn't finish, so nothing is confirmed yet.",
        nextAction: "We'll retry at the next scheduled check.",
      },
    });
    expect(failed.materialityReason).toBe(
      "An evidence check couldn't finish, so nothing is confirmed yet.",
    );
    expect(failed.nextAction).toBe("We'll retry at the next scheduled check.");
  });

  it("keeps non-empty truthful values for a legacy empty digest without triage", () => {
    const reason = buildDigestAccountabilityReason({ items: [], triage: null });
    expect(reason.materialityReason.trim().length).toBeGreaterThan(0);
    expect(reason.nextAction.trim().length).toBeGreaterThan(0);
  });

  it("resolves the reviewer from trusted identity with the workspace-owner role fallback", () => {
    expect(resolveDigestReviewer({ ownerLabel: "Asha", recipientName: "Bob" }).label).toBe(
      "Asha",
    );
    expect(resolveDigestReviewer({ ownerLabel: null, recipientName: "Bob" }).label).toBe(
      "Bob",
    );
    expect(
      resolveDigestReviewer({
        ownerLabel: null,
        roleFallback: DIGEST_WORKSPACE_OWNER_ROLE_LABEL,
      }),
    ).toEqual({ label: DIGEST_WORKSPACE_OWNER_ROLE_LABEL, missing: false });
    // No trusted identity and no role fallback: explicit missing state.
    expect(
      resolveDigestReviewer({ ownerLabel: null, recipientName: "" }).missing,
    ).toBe(true);
    expect(
      resolveDigestReviewer({ ownerLabel: null, recipientName: "" }).label,
    ).toBe(DIGEST_REVIEWER_MISSING_LABEL);
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
