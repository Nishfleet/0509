import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReportView } from "~/components/report-view";
import type { ReportDocument } from "~/lib/report";

const legacyReport = {
  kind: "report",
  reportId: "collection:legacy",
  resourceType: "collection",
  resourceId: "legacy",
  title: "Legacy client report",
  subtitle: "Saved before insight depth existed.",
  summary: "One saved proof item.",
  generatedAt: "2026-04-01T00:00:00.000Z",
  stats: [{ label: "Ads", value: "1" }],
  rows: [],
} as Omit<ReportDocument, "insightDepth"> as ReportDocument;

describe("ReportView", () => {
  it("does not show placeholder insight depth for legacy shared reports", () => {
    const markup = renderToStaticMarkup(
      createElement(ReportView, { report: legacyReport }),
    );

    expect(markup).not.toContain("Insight depth");
    expect(markup).not.toContain("Pending");
    expect(markup).toContain("f9-dash-state-empty");
    expect(markup).not.toContain("f9-empty-panel");
  });

  it("normalizes legacy system labels without rewriting customer-owned report text", () => {
    const report = {
      ...legacyReport,
      title: "Proofpoint watch",
      subtitle: "Proofpoint executive summary",
      summary: "Proofpoint proof review.",
      rows: [reportRow("row-proofpoint", "https://example.com/source")],
    };

    const markup = renderToStaticMarkup(
      createElement(ReportView, { report }),
    );

    expect(markup).toContain("Proofpoint watch");
    expect(markup).toContain("Proofpoint executive summary");
    expect(markup).toContain("Proofpoint proof review.");
    expect(markup).toContain("Verified evidence");
    expect(markup).toContain("Saved evidence");
    expect(markup).toContain("Evidence capture");
    expect(markup).not.toContain("Evidencepoint");
    expect(markup).not.toContain("Verified proof");
    expect(markup).not.toContain("Proof snapshot");
    expect(markup).not.toContain("Proof capture");
  });

  it("does not render non-http report source URLs as links", () => {
    const report = {
      ...legacyReport,
      rows: [
        reportRow("row-1", "javascript:alert(1)"),
        reportRow("row-2", "https://example.com/source"),
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(ReportView, { report }),
    );

    expect(markup).not.toContain("href=\"javascript:alert(1)\"");
    expect(markup).toContain("href=\"https://example.com/source\"");
  });

  it("leads proof reports with a decision summary and glossary", () => {
    const highPriorityRow = reportRow("row-high", "https://example.com/high");
    const report = {
      ...legacyReport,
      rows: [
        reportRow("row-low", "https://example.com/low"),
        {
          ...highPriorityRow,
          event: {
            ...highPriorityRow.event!,
            title: "Pricing page changed",
            summary: "The anchor price moved down before the weekend.",
            priorityScore: 93,
            priorityBand: "High priority",
            recommendedAction: "Today: brief a counter-offer.",
          },
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(ReportView, { report }),
    );

    expect(markup).toContain("Decision summary");
    expect(markup).toContain("Pricing page changed");
    expect(markup).toContain("Why it matters");
    expect(markup).toContain("High priority");
    expect(markup).toContain("Today: brief a counter-offer.");
    expect(markup).toContain("Source glossary");
    expect(markup).toContain("Evidence unavailable");
  });

  it("omits missing row fields entirely instead of rendering placeholder prose", () => {
    const sparseRow: ReportDocument["rows"][number] = {
      ...reportRow("row-sparse", "https://example.com/source"),
      advertiser: null,
      previewHeadline: "New offer",
      offer: null,
      cta: null,
      languageLabel: null,
      creativeText: null,
      translatedText: null,
      landingPage: { url: null, headline: null, captureLabel: null, capturedAt: null, signals: [] },
    };
    const report = { ...legacyReport, rows: [sparseRow] };

    const markup = renderToStaticMarkup(
      createElement(ReportView, { report }),
    );

    expect(markup).not.toMatch(/unavailable<\/dd>/i);
    expect(markup).not.toContain("Offer unavailable");
    expect(markup).not.toContain("CTA unavailable");
    expect(markup).not.toContain("Creative text unavailable");
    expect(markup).not.toContain("Translation unavailable");
    expect(markup).not.toContain("Landing page unavailable");
    expect(markup).not.toContain("<dt>Offer</dt>");
    expect(markup).not.toContain("<dt>URL</dt>");
    expect(markup).not.toContain("Landing page</p>");
    // The row still leads with what is known.
    expect(markup).toContain("New offer");
  });

  it("treats legacy placeholder snapshot values as missing", () => {
    const legacyPlaceholderRow: ReportDocument["rows"][number] = {
      ...reportRow("row-legacy", "https://example.com/source"),
      advertiser: "Ad context unavailable",
      previewHeadline: "Preview unavailable",
      offer: "Offer unavailable",
      cta: "CTA unavailable",
      languageLabel: "Language unavailable",
      creativeText: "Creative text unavailable",
      translatedText: "Translation unavailable",
      landingPage: {
        url: "Landing page unavailable",
        headline: "Landing page headline unavailable",
        captureLabel: "Not checked yet",
        capturedAt: null,
        signals: [
          { label: "CTA", value: "Not detected" },
          { label: "Price", value: "Not detected" },
        ],
      },
    };
    const report = { ...legacyReport, rows: [legacyPlaceholderRow] };

    const markup = renderToStaticMarkup(
      createElement(ReportView, { report }),
    );

    expect(markup).not.toContain("Offer unavailable");
    expect(markup).not.toContain("Ad context unavailable");
    expect(markup).not.toContain("Landing page unavailable");
    expect(markup).not.toContain("Not detected");
    expect(markup).not.toContain("Not checked yet");
  });

  it("does not describe saved collection proof as a no-action watchlist report", () => {
    const savedProofRow = { ...reportRow("row-collection", ""), event: undefined };
    const report = {
      ...legacyReport,
      rows: [savedProofRow],
    };

    const markup = renderToStaticMarkup(
      createElement(ReportView, { report }),
    );

    expect(markup).toContain("Saved evidence ready for review");
    expect(markup).toContain("1 saved evidence item packaged for review.");
    expect(markup).toContain("This is a curated evidence set, not a live change alert.");
    expect(markup).not.toContain("No client-ready change needs action");
  });
});

function reportRow(id: string, sourceUrl: string): ReportDocument["rows"][number] {
  return {
    id,
    advertiser: "Competitor",
    previewHeadline: "New offer",
    offer: "20% off",
    cta: "Shop now",
    formatLabel: "Image",
    languageLabel: "English",
    previewImageUrl: null,
    creativeText: "Creative",
    translatedText: "Creative",
    landingPage: { url: "", headline: "", captureLabel: "", capturedAt: null, signals: [] },
    analysisFields: [],
    tags: [],
    note: null,
    event: {
      typeLabel: "Offer",
      title: "New offer",
      summary: "A new offer launched.",
      createdAt: "2026-06-08T01:00:00.000Z",
      priorityScore: 82,
      priorityBand: "high",
      recommendedAction: "Review",
      proofTrail: "Proof capture",
      proofStatusLabel: "Verified proof",
      sourceTypeLabel: "Proof snapshot",
      sourceUrl,
      metaAdId: null,
    },
  };
}
