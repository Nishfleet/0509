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
