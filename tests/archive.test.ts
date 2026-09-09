import { describe, expect, it } from "vitest";

import {
  archiveEntriesFromOfferLedger,
  archiveEntriesFromWatchEvents,
  buildAdTenure,
  buildOfferHistorySeries,
  computeCaptureGaps,
  sortArchiveEntriesDesc,
  summarizeArchiveMonth,
  toPublicArchive,
  type ArchiveEntry,
  type DomainArchive,
} from "~/lib/archive";
import {
  ARCHIVE_SNAPSHOT_KIND,
  buildArchiveSnapshotPayload,
  isArchiveSnapshotPayload,
  sanitizeArchiveSnapshotPayload,
} from "~/lib/archive-snapshot";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import type { WatchEventRecord } from "~/lib/types";

const NOW = new Date("2026-09-09T12:00:00.000Z");

function ledgerEntry(overrides: Partial<OfferLedgerEntry>): OfferLedgerEntry {
  return {
    id: "snap-1",
    capturedAt: "2026-08-01T10:00:00.000Z",
    dateLabel: "1 Aug 2026",
    canonicalUrl: "https://brand.example/",
    headline: "Headline",
    ctaText: "Shop now",
    priceText: "₹499",
    formPresent: true,
    screenshotHref: "/artifacts/proof/shot-1",
    pageTextHref: "/artifacts/page-text/text-1",
    captureMethod: "landing_page_fetch",
    evidenceNote: null,
    transition: null,
    suppressedReason: null,
    runExtentLabel: null,
    ...overrides,
  };
}

function watchEvent(overrides: Partial<WatchEventRecord>): WatchEventRecord {
  return {
    id: "evt-1",
    watchlistId: "wl-1",
    runId: "run-1",
    eventType: "landing_page_cta_changed",
    status: "confirmed",
    importanceScore: 0,
    adId: null,
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: null,
    title: "CTA changed",
    summary: "The call to action changed.",
    metadata: {},
    confirmedAt: null,
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: null,
    createdAt: "2026-09-02T04:00:00.000Z",
    ...overrides,
  };
}

describe("archiveEntriesFromOfferLedger", () => {
  it("emits a first_capture row for the first dated state, with receipts and capture method", () => {
    const entries = archiveEntriesFromOfferLedger([ledgerEntry({})]);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.kind).toBe("first_capture");
    expect(entry.source).toBe("offer_ledger");
    expect(entry.fieldLabel).toBe("First capture");
    expect(entry.criticality).toBeNull();
    expect(entry.captureMethod).toBe("landing_page_fetch");
    expect(entry.afterScreenshotHref).toBe("/artifacts/proof/shot-1");
    expect(entry.pageTextHref).toBe("/artifacts/page-text/text-1");
    expect(entry.evidenceNote).toBeNull();
  });

  it("emits one row per changed field with the #1387 band and the baseline's before-screenshot", () => {
    const first = ledgerEntry({ id: "snap-1" });
    const second = ledgerEntry({
      id: "snap-2",
      capturedAt: "2026-08-10T10:00:00.000Z",
      dateLabel: "10 Aug 2026",
      priceText: "₹799",
      screenshotHref: "/artifacts/proof/shot-2",
      transition: {
        headline: null,
        ctaText: { before: "Shop now", after: "Get the kit" },
        priceText: { before: "₹499", after: "₹799" },
        formPresent: null,
      },
    });
    const entries = archiveEntriesFromOfferLedger([first, second]);
    const changes = entries.filter((entry) => entry.kind === "change");
    expect(changes.map((entry) => entry.fieldLabel)).toEqual(["CTA", "Price"]);

    const cta = changes.find((entry) => entry.fieldLabel === "CTA")!;
    expect(cta.changeMark).toEqual({ from: "Shop now", to: "Get the kit" });
    expect(cta.criticality?.band).toBe("material"); // cta-string-change
    expect(cta.beforeScreenshotHref).toBe("/artifacts/proof/shot-1");
    expect(cta.afterScreenshotHref).toBe("/artifacts/proof/shot-2");

    const price = changes.find((entry) => entry.fieldLabel === "Price")!;
    expect(price.criticality?.band).toBe("material"); // offerPrice field
    expect(price.changeMark).toEqual({ from: "₹499", to: "₹799" });
  });

  it("keeps a suppressed capture as a labelled row instead of a phantom change", () => {
    const entries = archiveEntriesFromOfferLedger([
      ledgerEntry({}),
      ledgerEntry({
        id: "snap-2",
        capturedAt: "2026-08-05T10:00:00.000Z",
        suppressedReason: "cookie banner / consent string",
      }),
    ]);
    const suppressed = entries.find((entry) => entry.kind === "suppressed");
    expect(suppressed?.fieldLabel).toBe("Capture suppressed");
    expect(suppressed?.evidenceNote).toBe(
      "Capture suppressed: cookie banner / consent string",
    );
    expect(suppressed?.criticality).toBeNull();
  });

  it("labels a capture that stored no artifacts instead of implying proof", () => {
    const entries = archiveEntriesFromOfferLedger([
      ledgerEntry({ screenshotHref: null, pageTextHref: null }),
    ]);
    expect(entries[0]?.evidenceNote).toBe(
      "No screenshot or page text stored for this capture",
    );
  });
});

describe("archiveEntriesFromWatchEvents", () => {
  it("maps a landing-page CTA event to a marked, banded change row", () => {
    const entries = archiveEntriesFromWatchEvents([
      watchEvent({
        metadata: { from: "Shop now", to: "Get the kit", landingPageUrl: "https://brand.example/" },
      }),
    ]);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.source).toBe("watch_event");
    expect(entry.fieldLabel).toBe("Call to action");
    expect(entry.changeMark).toEqual({ from: "Shop now", to: "Get the kit" });
    expect(entry.criticality?.band).toBe("material");
    expect(entry.eventStatus).toBe("confirmed");
    expect(entry.sourceUrl).toBe("https://brand.example/");
  });

  it("scores a website_page_added event as critical without stored from/to", () => {
    const entries = archiveEntriesFromWatchEvents([
      watchEvent({ eventType: "website_page_added" }),
    ]);
    expect(entries[0]?.criticality?.band).toBe("critical");
  });

  it("gives an ad_new event no band rather than a fabricated one", () => {
    const entries = archiveEntriesFromWatchEvents([
      watchEvent({ eventType: "ad_new" }),
    ]);
    expect(entries[0]?.criticality).toBeNull();
    expect(entries[0]?.evidenceNote).toBe("No screenshot stored for this change");
  });

  it("prefers the stored capture timestamp and the proof screenshot href", () => {
    const entries = archiveEntriesFromWatchEvents(
      [
        watchEvent({
          createdAt: "2026-09-02T04:00:00.000Z",
          metadata: { capturedAt: "2026-09-01T23:59:00.000Z" },
        }),
      ],
      { proofScreenshotHref: () => "/artifacts/proof/stored-shot" },
    );
    expect(entries[0]?.capturedAt).toBe("2026-09-01T23:59:00.000Z");
    expect(entries[0]?.afterScreenshotHref).toBe("/artifacts/proof/stored-shot");
    expect(entries[0]?.evidenceNote).toBeNull();
  });
});

describe("computeCaptureGaps", () => {
  it("shows a capture-free span as a gap, never smoothed", () => {
    const gaps = computeCaptureGaps([
      "2026-08-01T04:00:00.000Z",
      "2026-08-02T04:00:00.000Z",
      "2026-08-12T04:00:00.000Z",
    ]);
    expect(gaps).toEqual([
      { from: "2026-08-02T04:00:00.000Z", to: "2026-08-12T04:00:00.000Z", days: 10 },
    ]);
  });

  it("ignores spans inside the cadence tolerance and duplicate timestamps", () => {
    expect(
      computeCaptureGaps([
        "2026-08-01T04:00:00.000Z",
        "2026-08-01T04:00:00.000Z",
        "2026-08-02T04:00:00.000Z",
        "2026-08-04T04:00:00.000Z",
      ]),
    ).toEqual([]);
  });
});

describe("buildAdTenure", () => {
  it("computes first seen / last seen / running days against injected now", () => {
    const tenure = buildAdTenure(
      [
        {
          id: "ad-1",
          label: "Summer sale",
          firstSeenAt: "2026-08-01T00:00:00.000Z",
          lastSeenAt: "2026-09-08T00:00:00.000Z",
          isActive: true,
        },
        {
          id: "ad-2",
          label: "Old creative",
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastSeenAt: "2026-07-11T00:00:00.000Z",
          isActive: false,
        },
        {
          id: "ad-3",
          label: "No dates",
          firstSeenAt: null,
          lastSeenAt: null,
          isActive: true,
        },
      ],
      NOW,
    );
    const active = tenure.find((row) => row.id === "ad-1")!;
    expect(active.runningDays).toBe(39);
    expect(active.firstSeenLabel).toBe("1 Aug 2026");
    const inactive = tenure.find((row) => row.id === "ad-2")!;
    expect(inactive.runningDays).toBe(10);
    const undated = tenure.find((row) => row.id === "ad-3")!;
    expect(undated.runningDays).toBeNull();
    expect(undated.firstSeenLabel).toBeNull();
    // Longest-running first; undated last.
    expect(tenure.map((row) => row.id)).toEqual(["ad-1", "ad-2", "ad-3"]);
  });
});

describe("buildOfferHistorySeries", () => {
  it("groups the price/CTA/headline series per landing page", () => {
    const series = buildOfferHistorySeries([
      ledgerEntry({ id: "s1", canonicalUrl: "https://brand.example/" }),
      ledgerEntry({
        id: "s2",
        canonicalUrl: "https://brand.example/pricing",
        priceText: "₹999",
      }),
      ledgerEntry({
        id: "s3",
        canonicalUrl: "https://brand.example/",
        capturedAt: "2026-08-10T10:00:00.000Z",
        priceText: "₹799",
      }),
    ]);
    expect(series).toHaveLength(2);
    const home = series.find((row) => row.canonicalUrl === "https://brand.example/")!;
    expect(home.points.map((point) => point.priceText)).toEqual(["₹499", "₹799"]);
  });
});

describe("summarizeArchiveMonth", () => {
  const entry = (overrides: Partial<ArchiveEntry>): ArchiveEntry => ({
    id: "e1",
    kind: "change",
    source: "offer_ledger",
    capturedAt: "2026-09-03T10:00:00.000Z",
    dateLabel: "3 Sept 2026",
    fieldLabel: "Price",
    changeMark: null,
    beforeValue: null,
    afterValue: null,
    criticality: { score: 70, band: "material", reasons: ["price-token"] },
    beforeScreenshotHref: null,
    afterScreenshotHref: null,
    pageTextHref: null,
    captureMethod: "landing_page_fetch",
    evidenceNote: null,
    sourceUrl: null,
    eventStatus: null,
    ...overrides,
  });

  it("counts the current UTC month deterministically by field and band", () => {
    const summary = summarizeArchiveMonth(
      [
        entry({ id: "a", fieldLabel: "Price" }),
        entry({ id: "b", fieldLabel: "Price", capturedAt: "2026-09-05T10:00:00.000Z" }),
        entry({
          id: "c",
          fieldLabel: "Headline",
          criticality: { score: 40, band: "routine", reasons: ["text-diff"] },
        }),
        entry({ id: "d", kind: "first_capture", fieldLabel: "First capture", criticality: null }),
        entry({ id: "e", capturedAt: "2026-08-31T10:00:00.000Z" }), // last month — excluded
      ],
      NOW,
    );
    expect(summary).not.toBeNull();
    expect(summary!.monthKey).toBe("2026-09");
    expect(summary!.monthLabel).toBe("September 2026");
    expect(summary!.changeCount).toBe(3); // first_capture is not a change
    expect(summary!.byField).toEqual([
      { fieldLabel: "Price", count: 2 },
      { fieldLabel: "Headline", count: 1 },
    ]);
    expect(summary!.byBand).toEqual({ cosmetic: 0, routine: 1, material: 2, critical: 0 });
    expect(summary!.firstCapturedAt).toBe("2026-09-03T10:00:00.000Z");
    expect(summary!.lastCapturedAt).toBe("2026-09-05T10:00:00.000Z");
  });

  it("returns null when nothing was captured this month", () => {
    expect(summarizeArchiveMonth([entry({ capturedAt: "2026-08-01T10:00:00.000Z" })], NOW)).toBeNull();
  });
});

describe("toPublicArchive — the public/private field split", () => {
  it("drops watch-event rows and strips account-scoped status", () => {
    const privateEntries = [
      ...archiveEntriesFromOfferLedger([ledgerEntry({})]),
      ...archiveEntriesFromWatchEvents([
        watchEvent({
          metadata: { from: "Shop now", to: "Get the kit" },
        }),
      ]),
    ];
    const archive: DomainArchive = {
      subject: "brand.example",
      generatedAt: NOW.toISOString(),
      entries: sortArchiveEntriesDesc(privateEntries),
      gaps: [],
      adTenure: [],
      offerHistory: [],
      monthSummary: summarizeArchiveMonth(privateEntries, NOW),
    };

    const publicArchive = toPublicArchive(archive, NOW);
    expect(publicArchive.entries.length).toBeGreaterThan(0);
    expect(publicArchive.entries.every((row) => row.source === "offer_ledger")).toBe(true);
    expect(publicArchive.entries.every((row) => row.eventStatus === null)).toBe(true);
    // The month summary recomputes from public rows only — the private event
    // (2026-09-02) must not leak into public counts.
    expect(publicArchive.monthSummary).toBeNull();
  });
});

describe("archive snapshot codec", () => {
  it("round-trips a frozen archive through JSON without losing rows", () => {
    const archive: DomainArchive = {
      subject: "Label wl-1",
      generatedAt: NOW.toISOString(),
      entries: sortArchiveEntriesDesc([
        ...archiveEntriesFromOfferLedger([ledgerEntry({})]),
        ...archiveEntriesFromWatchEvents([watchEvent({})]),
      ]),
      gaps: [{ from: "2026-08-02T04:00:00.000Z", to: "2026-08-12T04:00:00.000Z", days: 10 }],
      adTenure: buildAdTenure(
        [
          {
            id: "ad-1",
            label: "Summer sale",
            firstSeenAt: "2026-08-01T00:00:00.000Z",
            lastSeenAt: "2026-09-08T00:00:00.000Z",
            isActive: true,
          },
        ],
        NOW,
      ),
      offerHistory: buildOfferHistorySeries([ledgerEntry({})]),
      monthSummary: null,
    };
    const payload = buildArchiveSnapshotPayload(archive, {
      watchlistName: "Competitor watch",
      targetLabel: "brand.example",
    });

    const stored = JSON.parse(JSON.stringify(payload)) as unknown;
    expect(isArchiveSnapshotPayload(stored)).toBe(true);

    const sanitized = sanitizeArchiveSnapshotPayload(stored);
    expect(sanitized).not.toBeNull();
    expect(sanitized!.kind).toBe(ARCHIVE_SNAPSHOT_KIND);
    expect(sanitized!.watchlistName).toBe("Competitor watch");
    expect(sanitized!.frozenAt).toBe(NOW.toISOString());
    expect(sanitized!.archive.entries).toHaveLength(2);
    expect(sanitized!.archive.gaps).toEqual(archive.gaps);
    expect(sanitized!.archive.adTenure).toHaveLength(1);
    expect(sanitized!.archive.offerHistory).toHaveLength(1);
  });

  it("rejects malformed payloads instead of rendering them", () => {
    expect(sanitizeArchiveSnapshotPayload(null)).toBeNull();
    expect(sanitizeArchiveSnapshotPayload({ kind: "other" })).toBeNull();
    expect(
      sanitizeArchiveSnapshotPayload({ kind: ARCHIVE_SNAPSHOT_KIND, archive: {} }),
    ).toBeNull();
    const payload = buildArchiveSnapshotPayload(
      {
        subject: "x",
        generatedAt: NOW.toISOString(),
        entries: [],
        gaps: [],
        adTenure: [],
        offerHistory: [],
        monthSummary: null,
      },
      { watchlistName: "w", targetLabel: "t" },
    );
    const corrupted = JSON.parse(JSON.stringify(payload)) as {
      archive: { entries: unknown[] };
    };
    corrupted.archive.entries = [{ id: 42 }, { kind: "change" }, "junk"];
    const sanitized = sanitizeArchiveSnapshotPayload(corrupted);
    expect(sanitized).not.toBeNull();
    expect(sanitized!.archive.entries).toEqual([]);
  });
});
