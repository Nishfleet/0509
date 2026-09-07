import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApprovedReportSnapshot,
  evaluateApprovedReportSnapshot,
  evaluateReportReadiness,
  isApprovedReportSnapshot,
  reportEvidenceFingerprint,
  REPORT_APPROVAL_REASON_CODES,
  REPORT_APPROVAL_MAX_AGE_MS,
} from "~/lib/report-approval";

const report = {
  kind: "report" as const,
  reportId: "shared-report",
  resourceType: "collection" as const,
  resourceId: "shared",
  title: "Board evidence",
  subtitle: "Latest saved evidence",
  summary: "One saved item.",
  generatedAt: "2026-07-15T08:00:00.000Z",
  stats: [],
  insightDepth: {
    topHooks: [],
    mediaMix: [],
    campaignDurations: [],
    metricProof: [],
    creativeTimeline: [],
    landingPageHistory: [],
  },
  rows: [
    {
      id: "row-1",
      advertiser: "Competitor",
      previewHeadline: "Board evidence",
      offer: null,
      cta: null,
      formatLabel: "Image",
      languageLabel: null,
      previewImageUrl: null,
      creativeText: null,
      translatedText: null,
      landingPage: {
        url: "https://example.com/evidence",
        headline: null,
        captureLabel: "Browser proof",
        capturedAt: "2026-07-15T07:55:00.000Z",
        signals: [],
      },
      analysisFields: [],
      tags: [],
      note: null,
      event: undefined,
    },
  ],
};

const verifiedWatchEvent = {
  typeLabel: "Offer",
  title: "Offer changed",
  summary: "Verified event.",
  createdAt: "2026-07-15T08:00:00.000Z",
  priorityScore: 80,
  priorityBand: "high",
  recommendedAction: "Review",
  proofTrail: "Saved evidence",
  proofStatusLabel: "Verified evidence",
  sourceTypeLabel: "Saved evidence",
  sourceUrl: null,
  metaAdId: null,
};

const watchlistReport = {
  ...report,
  reportId: "watchlist:watch-1",
  resourceType: "watchlist" as const,
  resourceId: "watch-1",
  rows: [{ ...report.rows[0], event: verifiedWatchEvent }],
};

afterEach(() => {
  vi.useRealTimers();
});

function reverseObjectKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseObjectKeyOrder);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, nested]) => [key, reverseObjectKeyOrder(nested)]),
  );
}

function legacyFingerprint(value: typeof report) {
  const { generatedAt: _generatedAt, ...content } = value;
  return stableJsonForTest(stripLegacyApprovalFieldsForTest(content));
}

function stripLegacyApprovalFieldsForTest(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripLegacyApprovalFieldsForTest);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
      if (
        [
          "reviewState",
          "evidenceState",
          "reviewedAt",
          "approvalExpiresAt",
          "evidenceFingerprint",
          "sharePurpose",
        ].includes(key)
      ) {
        return [];
      }
      const stripped = stripLegacyApprovalFieldsForTest(nested);
      return stripped === undefined ? [] : [[key, stripped]];
    }),
  );
}

function stableJsonForTest(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonForTest).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonForTest(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

describe("report approval persistence", () => {
  it("keeps fingerprints fixed-size for large reports", () => {
    const largeReport = {
      ...report,
      rows: Array.from({ length: 256 }, (_, index) => ({
        ...report.rows[0],
        id: `row-${index}`,
        creativeText: `${index}:${"large-evidence-payload".repeat(256)}`,
      })),
    };

    const fingerprint = reportEvidenceFingerprint(largeReport);

    expect(JSON.stringify(largeReport).length).toBeGreaterThan(1_000_000);
    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(fingerprint).toHaveLength(71);
  });

  it("is deterministic across key order and regenerated timestamps", () => {
    const reordered = reverseObjectKeyOrder({
      ...report,
      generatedAt: "2026-07-15T09:00:00.000Z",
    }) as typeof report;

    expect(reportEvidenceFingerprint(reordered)).toBe(
      reportEvidenceFingerprint(report),
    );
  });

  it("changes when stable report evidence changes", () => {
    expect(
      reportEvidenceFingerprint({
        ...report,
        rows: [{ ...report.rows[0], creativeText: "Changed evidence" }],
      }),
    ).not.toBe(reportEvidenceFingerprint(report));
  });

  it("honors unchanged legacy approvals only for their existing review window", () => {
    vi.useFakeTimers();
    const reviewedAt = "2026-07-15T09:00:00.000Z";
    vi.setSystemTime(new Date(reviewedAt));
    const approved = createApprovedReportSnapshot(report, reviewedAt)!;
    const legacyApproved = {
      ...approved,
      evidenceFingerprint: legacyFingerprint(report),
    };

    expect(isApprovedReportSnapshot(legacyApproved)).toBe(true);
    expect(
      isApprovedReportSnapshot({
        ...legacyApproved,
        rows: [{ ...legacyApproved.rows[0], creativeText: "Changed evidence" }],
      }),
    ).toBe(false);

    vi.setSystemTime(
      new Date(Date.parse(reviewedAt) + REPORT_APPROVAL_MAX_AGE_MS),
    );
    expect(isApprovedReportSnapshot(legacyApproved)).toBe(false);
  });

  it("survives the same JSON round trip used by D1 snapshots", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T09:00:00.000Z"));
    const approved = createApprovedReportSnapshot(report)!;
    const persisted = JSON.parse(JSON.stringify(approved));

    expect(approved).not.toBeNull();
    expect(isApprovedReportSnapshot(persisted)).toBe(true);
  });

  it("invalidates approval after a material evidence change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T09:00:00.000Z"));
    const approved = createApprovedReportSnapshot(report)!;

    expect(
      isApprovedReportSnapshot({
        ...approved,
        title: "Changed after approval",
      }),
    ).toBe(false);
    expect(
      evaluateApprovedReportSnapshot({
        ...approved,
        title: "Changed after approval",
      }),
    ).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.fingerprintMismatch,
    });
  });

  it("supports draft to reviewed to stale to re-review with a new fingerprint", () => {
    vi.useFakeTimers();
    const reviewedAt = "2026-07-15T09:00:00.000Z";
    vi.setSystemTime(new Date(reviewedAt));
    expect(
      evaluateApprovedReportSnapshot({ ...report, reviewState: "draft" }),
    ).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.invalidApproval,
    });
    const approved = createApprovedReportSnapshot(report, reviewedAt)!;
    expect(evaluateApprovedReportSnapshot(approved)).toEqual({ ok: true });

    const changedReport = {
      ...report,
      rows: [{ ...report.rows[0], note: "New client context" }],
    };
    const staleSnapshot = { ...approved, ...changedReport };
    expect(evaluateApprovedReportSnapshot(staleSnapshot)).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.fingerprintMismatch,
    });

    vi.setSystemTime(new Date("2026-07-15T09:05:00.000Z"));
    const reReviewed = createApprovedReportSnapshot(
      changedReport,
      "2026-07-15T09:05:00.000Z",
    )!;
    expect(isApprovedReportSnapshot(reReviewed)).toBe(true);
    expect(reReviewed.evidenceFingerprint).not.toBe(
      approved.evidenceFingerprint,
    );
  });

  it.each([
    ["title", { title: "Changed" }],
    ["row id", { rows: [{ ...report.rows[0], id: "row-2" }] }],
    ["resource id", { resourceId: "other-resource" }],
    [
      "source coverage",
      {
        sourceCoverage: {
          totalInput: 2,
          included: 2,
          excluded: 0,
          note: "Two verified items.",
          proofMix: {
            verifiedProof: 2,
            scanSpotted: 0,
            needsReview: 0,
            proofPending: 0,
            proofFailed: 0,
            excluded: 0,
            unknown: 0,
          },
          excludedCounts: {},
        },
      },
    ],
  ])("invalidates approval after a material %s change", (_change, change) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T09:00:00.000Z"));
    const approved = createApprovedReportSnapshot(report)!;

    expect(isApprovedReportSnapshot({ ...approved, ...change })).toBe(false);
  });

  it("requires a verified scan-backed event for watchlist approval", () => {
    expect(evaluateReportReadiness(watchlistReport)).toEqual({ ok: true });
    expect(createApprovedReportSnapshot(watchlistReport)).not.toBeNull();

    const noCurrentEvent = {
      ...watchlistReport,
      rows: [{ ...watchlistReport.rows[0], event: undefined }],
    };
    expect(evaluateReportReadiness(noCurrentEvent)).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.noCurrentEvidence,
    });
    expect(createApprovedReportSnapshot(noCurrentEvent)).toBeNull();

    const unverifiedEvent = {
      ...watchlistReport,
      rows: [
        {
          ...watchlistReport.rows[0],
          event: { ...verifiedWatchEvent, proofStatusLabel: "Needs review" },
        },
      ],
    };
    expect(evaluateReportReadiness(unverifiedEvent)).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.evidenceUnverified,
    });
  });

  it("requires an explicit captured source before a collection can be approved", () => {
    const uncapturedCollection = {
      ...report,
      rows: [
        {
          ...report.rows[0],
          landingPage: {
            ...report.rows[0].landingPage,
            url: null,
            headline: null,
            captureLabel: null,
            capturedAt: null,
          },
        },
      ],
    };

    expect(evaluateReportReadiness(uncapturedCollection)).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.noCurrentEvidence,
    });
    expect(createApprovedReportSnapshot(uncapturedCollection)).toBeNull();
  });

  it("returns stable recovery codes for empty and stale freshness states", () => {
    expect(evaluateReportReadiness({ ...report, rows: [] })).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.noCurrentEvidence,
    });
    expect(
      evaluateReportReadiness({ ...report, generatedAt: "not-a-date" }),
    ).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.freshnessUnverified,
    });
  });

  it("rejects an approved payload with an unknown report resource type", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T09:00:00.000Z"));
    const approved = createApprovedReportSnapshot(report)!;

    expect(
      isApprovedReportSnapshot({ ...approved, resourceType: "unknown" }),
    ).toBe(false);
    expect(
      evaluateApprovedReportSnapshot({ ...approved, resourceType: "unknown" }),
    ).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.invalidResource,
    });
    expect(
      evaluateApprovedReportSnapshot({ ...approved, resourceId: "   " }),
    ).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.invalidResource,
    });
    expect(
      evaluateReportReadiness({ ...report, resourceType: "unknown" } as never),
    ).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.invalidResource,
    });
  });

  it("expires approval at the bounded review window", () => {
    vi.useFakeTimers();
    const reviewedAt = "2026-07-15T09:00:00.000Z";
    vi.setSystemTime(new Date(reviewedAt));
    const approved = createApprovedReportSnapshot(report, reviewedAt)!;
    vi.setSystemTime(
      new Date(Date.parse(reviewedAt) + REPORT_APPROVAL_MAX_AGE_MS),
    );

    expect(isApprovedReportSnapshot(approved)).toBe(false);
    expect(evaluateApprovedReportSnapshot(approved)).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.approvalExpired,
    });
  });

  it("accepts the review window immediately before expiry and rejects future review timestamps", () => {
    vi.useFakeTimers();
    const reviewedAt = "2026-07-15T09:00:00.000Z";
    vi.setSystemTime(new Date(reviewedAt));
    const approved = createApprovedReportSnapshot(report, reviewedAt)!;
    vi.setSystemTime(
      new Date(Date.parse(reviewedAt) + REPORT_APPROVAL_MAX_AGE_MS - 1),
    );
    expect(isApprovedReportSnapshot(approved)).toBe(true);

    vi.setSystemTime(new Date(reviewedAt));
    const futureReviewed = createApprovedReportSnapshot(
      report,
      "2026-07-15T10:00:00.000Z",
    );
    expect(futureReviewed).not.toBeNull();
    expect(
      evaluateApprovedReportSnapshot({
        ...approved,
        reviewedAt: "2026-07-15T10:00:00.000Z",
        approvalExpiresAt: "2026-07-16T10:00:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      reasonCode: REPORT_APPROVAL_REASON_CODES.approvalInFuture,
    });
  });

  it("rejects persisted approvals whose expiry was extended beyond the review window", () => {
    vi.useFakeTimers();
    const reviewedAt = "2026-07-15T09:00:00.000Z";
    vi.setSystemTime(new Date(reviewedAt));
    const approved = createApprovedReportSnapshot(report, reviewedAt)!;

    expect(
      isApprovedReportSnapshot({
        ...approved,
        approvalExpiresAt: new Date(
          Date.parse(reviewedAt) + REPORT_APPROVAL_MAX_AGE_MS + 1,
        ).toISOString(),
      }),
    ).toBe(false);
  });

  it("rejects watchlist claims without verified saved evidence", () => {
    const unverified = {
      ...report,
      resourceType: "watchlist" as const,
      rows: [
        {
          ...report.rows[0],
          event: {
            typeLabel: "Offer",
            title: "Offer changed",
            summary: "Offer changed.",
            createdAt: "2026-07-15T08:00:00.000Z",
            priorityScore: 80,
            priorityBand: "high",
            recommendedAction: "Review",
            proofTrail: "Scan observation",
            proofStatusLabel: "Needs review",
            sourceTypeLabel: "Scan-spotted",
            sourceUrl: null,
            metaAdId: null,
          },
        },
      ],
    };

    expect(createApprovedReportSnapshot(unverified)).toBeNull();
  });
});
