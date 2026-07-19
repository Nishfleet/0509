import { describe, expect, it } from "vitest";

import {
  buildDigestEmail,
  buildScanTroubleEmail,
  digestItemDeepLink,
} from "~/lib/digest-email.server";

describe("buildScanTroubleEmail", () => {
  it("names affected watchlists and points to retries + watchlists", () => {
    const email = buildScanTroubleEmail({
      watchlistNames: ["Nykaa", "boAt"],
      watchlistsUrl: "https://0509.io/app/watchlists",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: "https://0509.io/unsubscribe?sig=test",
    });

    expect(email.subject).toBe("We hit a problem checking your competitors");
    expect(email.html).toContain("Nykaa");
    expect(email.html).toContain("boAt");
    expect(email.html).toContain("Retries are already running automatically");
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
    expect(email.html).toContain("3 more changes are in the full digest");
    expect(email.html).toContain("Verified evidence");
    expect(email.html).toContain("Check-spotted");
    // WP-24: each top-move deep-links to the watchlist event row (HTML-escaped &).
    expect(email.html).toContain("/app/watchlists?watchlist=wl-nykaa&amp;event=ev-nykaa");
    expect(email.html).toContain("/app/watchlists?watchlist=wl-boat&amp;event=ev-boat");
    expect(email.text).toContain(
      "Review in Five to Nine: https://0509.io/app/watchlists?watchlist=wl-nykaa&event=ev-nykaa",
    );
    expect(email.text).toContain("View full digest: https://0509.io/app/digests");
    expect(email.text).toContain("Manage frequency: https://0509.io/app/notifications");
    expect(email.text).toContain("Unsubscribe: https://0509.io/unsubscribe?sig=test");
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
