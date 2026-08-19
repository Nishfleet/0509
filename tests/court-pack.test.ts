import { describe, expect, it } from "vitest";

import {
  COURT_PACK_EXCLUSION_REASON_CODES,
  evaluateCourtPackApprovalMetadata,
  numberCourtPackPlates,
  readCourtPackApprovalEntries,
  summarizeCourtPackCoverage,
  type CourtPackExclusion,
  type CourtPackReportSection,
} from "~/lib/court-pack";
import { REPORT_APPROVAL_MAX_AGE_MS } from "~/lib/report-approval";
import type { ReportDocument } from "~/lib/report";

const generatedAt = "2026-07-15T08:00:00.000Z";

function reportDocument(
  reportId: string,
  resourceType: "collection" | "watchlist",
  resourceId: string,
  title: string,
): ReportDocument {
  return {
    kind: "report",
    reportId,
    resourceType,
    resourceId,
    title,
    subtitle: `${title} subtitle`,
    summary: `${title} summary.`,
    generatedAt,
    stats: [{ label: "Rows", value: "1" }],
    insightDepth: {
      topHooks: [],
      mediaMix: [],
      campaignDurations: [],
      metricProof: [],
      creativeTimeline: [],
      landingPageHistory: [],
    },
    sourceCoverage: {
      totalInput: 1,
      included: 1,
      excluded: 0,
      note: "One saved item.",
      proofMix: {
        verifiedProof: 1,
        scanSpotted: 0,
        needsReview: 0,
        proofPending: 0,
        proofFailed: 0,
        excluded: 0,
        unknown: 0,
      },
      excludedCounts: {},
    },
    rows: [
      {
        id: "row-1",
        advertiser: "Acme",
        previewHeadline: "Proof",
        offer: null,
        cta: null,
        formatLabel: "Image",
        languageLabel: "English",
        previewImageUrl: null,
        creativeText: null,
        translatedText: null,
        landingPage: {
          url: "https://example.com/proof",
          headline: null,
          captureLabel: "Browser proof",
          capturedAt: "2026-07-15T07:55:00.000Z",
          signals: [],
        },
        analysisFields: [],
        tags: [],
        note: null,
        event: {
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
        },
      },
    ],
  };
}

function section(
  reportId: string,
  resourceType: "collection" | "watchlist",
  resourceId: string,
  title: string,
): CourtPackReportSection {
  return {
    reportId,
    resourceType,
    title,
    subtitle: `${title} subtitle`,
    summary: `${title} summary.`,
    generatedAt,
    reviewedAt: "2026-07-15T09:00:00.000Z",
    approvalExpiresAt: "2026-07-16T09:00:00.000Z",
    evidenceFingerprint: "sha256:fixture",
    report: reportDocument(reportId, resourceType, resourceId, title),
  };
}

describe("numberCourtPackPlates", () => {
  it("numbers included sections gap-free from 1..N", () => {
    const plates = numberCourtPackPlates([
      section("watchlist:a", "watchlist", "a", "Alpha"),
      section("collection:b", "collection", "b", "Beta"),
      section("watchlist:c", "watchlist", "c", "Gamma"),
    ]);

    expect(plates.map((plate) => plate.plateNumber)).toEqual([1, 2, 3]);
    expect(plates.map((plate) => plate.reportId)).toEqual([
      "collection:b",
      "watchlist:a",
      "watchlist:c",
    ]);
  });

  it("is stable across reloads for unchanged input", () => {
    const input = [
      section("watchlist:c", "watchlist", "c", "Gamma"),
      section("collection:b", "collection", "b", "Beta"),
      section("watchlist:a", "watchlist", "a", "Alpha"),
    ];
    const first = numberCourtPackPlates(input);
    const second = numberCourtPackPlates(input);
    expect(first).toEqual(second);
  });

  it("does not depend on the input section order", () => {
    const sections = [
      section("watchlist:a", "watchlist", "a", "Alpha"),
      section("collection:b", "collection", "b", "Beta"),
    ];
    const forward = numberCourtPackPlates(sections);
    const reversed = numberCourtPackPlates([...sections].reverse());
    expect(forward).toEqual(reversed);
  });

  it("keeps plate numbering gap-free when a section has no rows", () => {
    const emptyRows: CourtPackReportSection = {
      ...section("watchlist:x", "watchlist", "x", "Empty"),
      report: {
        ...reportDocument("watchlist:x", "watchlist", "x", "Empty"),
        rows: [],
      },
    };
    const plates = numberCourtPackPlates([
      section("watchlist:a", "watchlist", "a", "Alpha"),
      emptyRows,
      section("watchlist:z", "watchlist", "z", "Zulu"),
    ]);
    expect(plates.map((plate) => plate.plateNumber)).toEqual([1, 2]);
    expect(plates.map((plate) => plate.reportId)).toEqual([
      "watchlist:a",
      "watchlist:z",
    ]);
  });

  it("copies first-row proof fields verbatim and nulls absent ones", () => {
    const [plate] = numberCourtPackPlates([
      section("watchlist:a", "watchlist", "a", "Alpha"),
    ]);
    expect(plate).toMatchObject({
      plateNumber: 1,
      reportId: "watchlist:a",
      resourceType: "watchlist",
      title: "Alpha",
      advertiser: "Acme",
      headline: "Offer changed",
      proofStatusLabel: "Verified evidence",
      sourceUrl: null,
    });
    expect(plate.capturedAt).toBe("2026-07-15T07:55:00.000Z");
    expect(plate.event).not.toBeNull();
  });

  it("leaves proofStatusLabel null when the first row has no event", () => {
    const noEvent: CourtPackReportSection = {
      ...section("collection:c", "collection", "c", "Collection"),
      report: {
        ...reportDocument("collection:c", "collection", "c", "Collection"),
        rows: [
          {
            ...reportDocument("collection:c", "collection", "c", "Collection")
              .rows[0],
            event: undefined,
          },
        ],
      },
    };
    const [plate] = numberCourtPackPlates([noEvent]);
    expect(plate.proofStatusLabel).toBeNull();
    expect(plate.event).toBeNull();
  });
});

describe("summarizeCourtPackCoverage", () => {
  it("counts exclusions per reason without inventing ratios", () => {
    const excluded: CourtPackExclusion[] = [
      {
        reportId: "watchlist:a",
        resourceType: "watchlist",
        resourceLabel: null,
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.noApproval,
        reason: "Not approved yet.",
      },
      {
        reportId: "watchlist:b",
        resourceType: "watchlist",
        resourceLabel: null,
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.loadFailed,
        reason: "Could not load.",
      },
      {
        reportId: "watchlist:b",
        resourceType: "watchlist",
        resourceLabel: null,
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.loadFailed,
        reason: "Could not load.",
      },
    ];
    const plates = numberCourtPackPlates([
      section("watchlist:a", "watchlist", "a", "Alpha"),
    ]);
    const coverage = summarizeCourtPackCoverage({
      approvedReports: 4,
      includedSections: [section("watchlist:a", "watchlist", "a", "Alpha")],
      excluded,
      plates,
    });

    expect(coverage.approvedReports).toBe(4);
    expect(coverage.includedSections).toBe(1);
    expect(coverage.excluded).toBe(3);
    expect(coverage.plates).toBe(1);
    expect(coverage.excludedByReason.no_approval).toBe(1);
    expect(coverage.excludedByReason.load_failed).toBe(2);
    expect(coverage.excludedByReason.approval_expired).toBe(0);
    expect(coverage.excludedByReason.fingerprint_mismatch).toBe(0);
    expect(coverage.excludedByReason.readiness_failed).toBe(0);
    expect(coverage.excludedByReason.approval_invalid).toBe(0);
  });
});

describe("readCourtPackApprovalEntries", () => {
  it("returns {} for missing or non-object reportApprovals", () => {
    expect(readCourtPackApprovalEntries({})).toEqual({});
    expect(readCourtPackApprovalEntries({ reportApprovals: "nope" })).toEqual(
      {},
    );
    expect(readCourtPackApprovalEntries({ reportApprovals: [] })).toEqual({});
  });

  it("returns the raw entry record verbatim", () => {
    const entries = readCourtPackApprovalEntries({
      reportApprovals: { "watchlist:a": { evidenceFingerprint: "fp" } },
    });
    expect(entries["watchlist:a"]).toEqual({ evidenceFingerprint: "fp" });
  });
});

describe("evaluateCourtPackApprovalMetadata", () => {
  const now = Date.parse("2026-07-16T10:00:00.000Z");
  const reviewedAt = "2026-07-16T09:00:00.000Z";
  const approvalExpiresAt = new Date(
    Date.parse(reviewedAt) + REPORT_APPROVAL_MAX_AGE_MS,
  ).toISOString();
  const validEntry = {
    evidenceFingerprint: "sha256:abc",
    reviewedAt,
    approvalExpiresAt,
  };

  it("accepts a valid in-window approval", () => {
    const result = evaluateCourtPackApprovalMetadata(validEntry, now);
    expect(result).toEqual({ ok: true, metadata: validEntry });
  });

  it("rejects expired approvals as approval_expired", () => {
    const expired = {
      ...validEntry,
      approvalExpiresAt: new Date(now - 60_000).toISOString(),
    };
    const result = evaluateCourtPackApprovalMetadata(expired, now);
    expect(result).toMatchObject({ ok: false, reasonCode: "approval_expired" });
  });

  it("rejects malformed entries as approval_invalid", () => {
    expect(
      evaluateCourtPackApprovalMetadata(null, now),
    ).toMatchObject({ ok: false, reasonCode: "approval_invalid" });
    expect(
      evaluateCourtPackApprovalMetadata({ evidenceFingerprint: "fp" }, now),
    ).toMatchObject({ ok: false, reasonCode: "approval_invalid" });
    expect(
      evaluateCourtPackApprovalMetadata(
        { ...validEntry, reviewedAt: "not-a-date" },
        now,
      ),
    ).toMatchObject({ ok: false, reasonCode: "approval_invalid" });
    expect(
      evaluateCourtPackApprovalMetadata(
        { ...validEntry, evidenceFingerprint: "" },
        now,
      ),
    ).toMatchObject({ ok: false, reasonCode: "approval_invalid" });
  });

  it("rejects future reviewedAt and invalid windows as approval_invalid", () => {
    expect(
      evaluateCourtPackApprovalMetadata(
        { ...validEntry, reviewedAt: new Date(now + 60_000).toISOString() },
        now,
      ),
    ).toMatchObject({ ok: false, reasonCode: "approval_invalid" });
    expect(
      evaluateCourtPackApprovalMetadata(
        {
          ...validEntry,
          approvalExpiresAt: new Date(
            Date.parse(reviewedAt) + REPORT_APPROVAL_MAX_AGE_MS + 60_000,
          ).toISOString(),
        },
        now,
      ),
    ).toMatchObject({ ok: false, reasonCode: "approval_invalid" });
  });
});
