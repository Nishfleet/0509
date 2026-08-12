import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CourtPackView } from "~/components/court-pack-view";
import { COURT_PACK_EXCLUSION_REASON_CODES, type CourtPack } from "~/lib/court-pack";

function reportDocument() {
  return {
    kind: "report" as const,
    reportId: "watchlist:watch-1",
    resourceType: "watchlist" as const,
    resourceId: "watch-1",
    title: "Nykaa watchlist",
    subtitle: "advertiser · Nykaa",
    summary: "2 verified-evidence watch events with linked ad context.",
    generatedAt: "2026-07-15T08:00:00.000Z",
    stats: [
      { label: "Events", value: "2" },
      { label: "Linked ads", value: "1" },
    ],
    insightDepth: {
      topHooks: [],
      mediaMix: [],
      campaignDurations: [],
      metricProof: [],
      creativeTimeline: [],
      landingPageHistory: [],
    },
    sourceCoverage: {
      totalInput: 3,
      included: 2,
      excluded: 1,
      note: "Excluded rows lack verified saved evidence.",
      proofMix: {
        verifiedProof: 2,
        scanSpotted: 0,
        needsReview: 0,
        proofPending: 0,
        proofFailed: 1,
        excluded: 0,
        unknown: 0,
      },
      excludedCounts: { proof_failed: 1 },
    },
    rows: [
      {
        id: "row-1",
        advertiser: "Nykaa",
        previewHeadline: "New offer",
        offer: "Buy one get one",
        cta: "Shop now",
        formatLabel: "Image",
        languageLabel: "English",
        previewImageUrl: null,
        creativeText: "A proven message.",
        translatedText: null,
        landingPage: {
          url: "https://nykaa.example/offer",
          headline: "Offer headline",
          captureLabel: "Browser proof",
          capturedAt: "2026-07-15T07:55:00.000Z",
          signals: [{ label: "CTA", value: "Shop now" }],
        },
        analysisFields: [{ label: "hook", value: "A proven message." }],
        tags: [],
        note: null,
        event: {
          typeLabel: "Offer",
          title: "Offer changed",
          summary: "The offer changed on the landing page.",
          createdAt: "2026-07-15T08:00:00.000Z",
          priorityScore: 80,
          priorityBand: "high",
          recommendedAction: "Review the new offer",
          proofTrail: "Saved evidence: browser capture",
          proofStatusLabel: "Verified evidence",
          sourceTypeLabel: "Saved evidence",
          sourceUrl: "https://evidence.example/capture/1",
          metaAdId: "ad-1",
        },
      },
      {
        id: "row-2",
        advertiser: "Nykaa",
        previewHeadline: "Second change",
        offer: null,
        cta: null,
        formatLabel: "Video",
        languageLabel: null,
        previewImageUrl: null,
        creativeText: null,
        translatedText: null,
        landingPage: {
          url: null,
          headline: null,
          captureLabel: null,
          capturedAt: null,
          signals: [],
        },
        analysisFields: [],
        tags: [],
        note: null,
        event: {
          typeLabel: "Creative",
          title: "Creative changed",
          summary: "The creative changed.",
          createdAt: "2026-07-15T08:30:00.000Z",
          priorityScore: 40,
          priorityBand: "medium",
          recommendedAction: "Review",
          proofTrail: "Saved evidence",
          proofStatusLabel: "Verified evidence",
          sourceTypeLabel: "Saved evidence",
          sourceUrl: null,
          metaAdId: null,
        },
      },
    ],
  };
}

function section() {
  return {
    reportId: "watchlist:watch-1",
    resourceType: "watchlist" as const,
    title: "Nykaa watchlist",
    subtitle: "advertiser · Nykaa",
    summary: "2 verified-evidence watch events with linked ad context.",
    generatedAt: "2026-07-15T08:00:00.000Z",
    reviewedAt: "2026-07-16T09:00:00.000Z",
    approvalExpiresAt: "2026-07-17T09:00:00.000Z",
    evidenceFingerprint: "sha256:abc123",
    report: reportDocument(),
  };
}

function fullPack(): CourtPack {
  return {
    roomId: "room-1",
    roomName: "Nykaa weekly desk",
    clientLabel: "Nykaa",
    preparedBy: "Acme Agency",
    branding: {
      brandName: "Acme Agency",
      brandWebsite: "https://acme.example",
      brandLogo: "data:image/png;base64,AAAA",
    },
    generatedAt: "2026-07-16T10:00:00.000Z",
    sections: [section()],
    plates: [
      {
        plateNumber: 1,
        reportId: "watchlist:watch-1",
        resourceType: "watchlist",
        resourceLabel: "Nykaa watchlist",
        title: "Nykaa watchlist",
        advertiser: "Nykaa",
        headline: "Offer changed",
        capturedAt: "2026-07-15T07:55:00.000Z",
        proofStatusLabel: "Verified evidence",
        sourceUrl: "https://evidence.example/capture/1",
        event: reportDocument().rows[0].event ?? null,
        analysisFields: reportDocument().rows[0].analysisFields,
        captureLabel: "Browser proof",
      },
    ],
    excluded: [
      {
        reportId: "watchlist:stale",
        resourceType: "watchlist",
        resourceLabel: "Stale watchlist report",
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.approvalExpired,
        reason: "This report approval has expired. Review the current evidence again.",
      },
    ],
    coverage: {
      approvedReports: 1,
      includedSections: 1,
      excluded: 1,
      excludedByReason: {
        no_approval: 0,
        approval_invalid: 0,
        approval_expired: 1,
        fingerprint_mismatch: 0,
        readiness_failed: 0,
        load_failed: 0,
      },
      plates: 1,
    },
    hasNothingToPack: false,
  };
}

function render(pack: CourtPack) {
  return renderToStaticMarkup(createElement(CourtPackView, { pack }));
}

describe("CourtPackView", () => {
  it("renders numbered evidence plates with the approved report content", () => {
    const markup = render(fullPack());

    expect(markup).toContain("Agency Court Pack");
    expect(markup).toContain("Nykaa weekly desk");
    expect(markup).toContain("Evidence plate 1: Nykaa watchlist");
    expect(markup).toContain("2 verified-evidence watch events");
    expect(markup).toContain("Buy one get one");
    expect(markup).toContain("Shop now");
    expect(markup).toContain("A proven message.");
    expect(markup).toContain("https://nykaa.example/offer");
    expect(markup).toContain("Offer changed");
    expect(markup).toContain("Review the new offer");
    expect(markup).toContain("Events");
    expect(markup).toContain("Source coverage");
    expect(markup).toContain("2 of 3 included · 1 excluded");
    expect(markup).toContain("Verified proof");
  });

  it("renders the durable proof labels and trails verbatim", () => {
    const markup = render(fullPack());

    expect(markup).toContain("Verified evidence");
    expect(markup).toContain("Saved evidence: browser capture");
    expect(markup).toContain("Saved evidence");
    expect(markup).toContain("Proof status");
    expect(markup).toContain("Proof trail");
    expect(markup).toContain("Observed at");
    expect(markup).toContain("Approved 2026-07-16T09:00:00.000Z");
    expect(markup).toContain("expires 2026-07-17T09:00:00.000Z");
  });

  it("renders validated co-branding and keeps Five to Nine attribution", () => {
    const markup = render(fullPack());

    expect(markup).toContain("Prepared by Acme Agency");
    expect(markup).toContain('src="data:image/png;base64,AAAA"');
    expect(markup).toContain("Five to Nine · Read-only HTML for browser printing");
  });

  it("renders no brand block when branding is absent", () => {
    const pack: CourtPack = { ...fullPack(), preparedBy: null, branding: null };
    const markup = render(pack);

    expect(markup).not.toContain("Prepared by");
    expect(markup).not.toContain("<img");
  });

  it("renders exclusions with their reason codes and never as plates", () => {
    const markup = render(fullPack());

    expect(markup).toContain("Excluded from verified evidence");
    expect(markup).toContain("Stale watchlist report");
    expect(markup).toContain("approval_expired");
    expect(markup).not.toContain("Evidence plate 2");
  });

  it("renders the honest approval empty state for zero approved reports", () => {
    const pack: CourtPack = {
      ...fullPack(),
      sections: [],
      plates: [],
      hasNothingToPack: true,
      coverage: {
        approvedReports: 0,
        includedSections: 0,
        excluded: 1,
        excludedByReason: {
          no_approval: 1,
          approval_invalid: 0,
          approval_expired: 0,
          fingerprint_mismatch: 0,
          readiness_failed: 0,
          load_failed: 0,
        },
        plates: 0,
      },
    };
    const markup = render(pack);

    expect(markup).toContain("No approved reports yet");
    expect(markup).toContain(
      "Review and approve current report evidence to prepare this Court Pack.",
    );
    expect(markup).not.toContain("Evidence plate");
    // Exclusions stay visible alongside the empty state.
    expect(markup).toContain("Excluded from verified evidence");
    expect(markup).toContain("approval_expired");
  });

  it("contains no PDF, email, schedule, or download affordance", () => {
    const markup = render(fullPack());

    expect(markup).not.toContain("mailto:");
    expect(markup).not.toContain("pdf");
    expect(markup).not.toContain("Download");
    expect(markup).not.toContain("Schedule");
    expect(markup).not.toContain("Send to client");
    expect(markup).not.toContain("Export");
  });

  it("is read-only: no forms, buttons, or inputs", () => {
    const markup = render(fullPack());

    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("method=");
  });

  it("links only report-sanctioned source URLs", () => {
    const markup = render(fullPack());

    expect(markup).toContain('href="https://evidence.example/capture/1"');
    expect(markup).not.toContain('href="https://acme.example"');
    expect(markup.match(/href=/g)).toHaveLength(1);
  });

  it("renders no anchors when the report carries no source URL", () => {
    const pack = fullPack();
    const noSourceEvent = {
      ...reportDocument(),
      rows: reportDocument().rows.map((row) => ({
        ...row,
        event: row.event ? { ...row.event, sourceUrl: null } : row.event,
      })),
    };
    pack.sections = [{ ...section(), report: noSourceEvent }];
    pack.plates = [
      { ...pack.plates[0], sourceUrl: null, event: noSourceEvent.rows[0].event ?? null },
    ];
    const markup = render(pack);

    expect(markup).not.toContain("href=");
  });
});
