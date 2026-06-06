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
});
