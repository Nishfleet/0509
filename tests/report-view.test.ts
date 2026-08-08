import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReportView } from "~/components/report-view";
import { UNREADABLE_CAPTURE_COPY } from "~/components/evidence";
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

    // Brief §6.6/A2: the six-box grid is replaced by honest fact rows.
    expect(markup).not.toContain("Insight depth");
    expect(markup).not.toContain("Pending");
    // §6.8: an empty report is a specimen panel with a reserved slot, never
    // a bare "No data" box.
    expect(markup).toContain("f9-evidence-specimen");
    expect(markup).toContain("No plate is filed yet");
    expect(markup).not.toContain("f9-empty-panel");
    expect(markup).not.toContain("f9-dash-state-empty");
  });

  it("normalizes legacy system labels without rewriting customer-owned report text", () => {
    const report = {
      ...legacyReport,
      title: "Proofpoint watch",
      subtitle: "Proofpoint executive summary",
      summary: "Proofpoint proof review.",
      rows: [reportRow("row-proofpoint", "https://example.com/source")],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

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

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).not.toContain("href=\"javascript:alert(1)\"");
    expect(markup).toContain("href=\"https://example.com/source\"");
    expect(markup).toContain('class="f9-report-fact-link"');
    expect(markup).not.toContain('style="');
    // The blocked URL still renders a row, honestly (brief §6.6).
    expect(markup).toContain("none stored");
  });

  it("treats a non-http landing page value as missing instead of displaying it", () => {
    const row = reportRow("row-landing", "https://example.com/source");
    const report = {
      ...legacyReport,
      rows: [
        {
          ...row,
          landingPage: {
            ...row.landingPage,
            url: "javascript:alert(1)",
          },
        },
      ],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).not.toContain("javascript:alert(1)");
    expect(markup).toContain("none stored");
  });

  it("opens on an ink cover whose headline is the finding, not 'Report for X'", () => {
    const highPriorityRow = reportRow("row-high", "https://example.com/high");
    const report = {
      ...legacyReport,
      resourceType: "watchlist" as const,
      title: "Okara",
      summary: "2 verified-evidence watch events.",
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
      createElement(ReportView, { report, preparedBy: "Northwind Growth" }),
    );

    // §6.10 cover: kicker, the finding as the headline, standfirst, byline.
    expect(markup).toContain("Competitor evidence report");
    expect(markup).toContain(
      '<h1 class="f9-evidence-report-headline">Pricing page changed</h1>',
    );
    expect(markup).not.toContain("Report for");
    expect(markup).toContain("2 verified-evidence watch events.");
    expect(markup).toContain("Prepared by");
    expect(markup).toContain("Northwind Growth");
    expect(markup).toContain("2 plates");

    // §6.10 "Our read": the verdict, before any number in section 01.
    expect(markup).toContain("Our read");
    expect(markup).toContain("Today: brief a counter-offer.");
    expect(markup.indexOf("Our read")).toBeLessThan(markup.indexOf("What we found</span>") + 400);

    // The old decision-summary / stacked-label block is gone.
    expect(markup).not.toContain("Decision summary");
    expect(markup).not.toContain("Why it matters");
    expect(markup).not.toContain("client-ready");
  });

  it("renders exactly three headline numbers and pushes the fourth into the method rail", () => {
    const report = {
      ...legacyReport,
      resourceType: "watchlist" as const,
      stats: [
        { label: "Events", value: "4" },
        { label: "Linked ads", value: "3" },
        { label: "Event types", value: "Offer, Creative" },
        { label: "Excluded", value: "2" },
      ],
      rows: [reportRow("row-1", "https://example.com/source")],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    // Three, because a 3-up band cannot produce the 3+1 orphan hole.
    expect(markup).toContain('data-count="3"');
    expect(markup.match(/f9-evidence-report-number"/g)).toHaveLength(3);
    expect(markup).toContain("Changes we captured and kept");
    // The fourth number is a fact row, not a fourth tile.
    expect(markup).toContain('<span class="f9-evidence-fact-key">Excluded</span>');
  });

  it("renders evidence as numbered plates and references them by number in the prose", () => {
    const report = {
      ...legacyReport,
      rows: [
        reportRow("row-1", "https://example.com/one"),
        reportRow("row-2", "https://example.com/two"),
      ],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).toContain("PLATE 01 —");
    expect(markup).toContain("PLATE 02 —");
    expect(markup).toContain("The evidence is plates 01–02 below");
    // §03 recommendations cite the plate they came from.
    expect(markup).toContain("Plate 01");
  });

  it("ends on 'how this was checked' with the standing honesty sentence, and keeps the glossary out of the reading flow", () => {
    const report = {
      ...legacyReport,
      rows: [reportRow("row-1", "https://example.com/source")],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).toContain("How this was checked");
    expect(markup).toContain(
      "Where a number was not published by the source, this report says so rather than estimating it.",
    );
    // The glossary is the last thing in the document, after section 05 opens —
    // never inlined between the summary and the evidence (current defect).
    expect(markup).toContain("Source glossary");
    expect(markup.indexOf("Source glossary")).toBeGreaterThan(markup.indexOf("PLATE 01"));
    expect(markup.indexOf("Source glossary")).toBeGreaterThan(
      markup.indexOf("How this was checked"),
    );
  });

  it("carries a contents rail and renders the client action card only when the caller supplies one", () => {
    const withoutActions = renderToStaticMarkup(
      createElement(ReportView, { report: legacyReport }),
    );
    expect(withoutActions).toContain("f9-evidence-report-contents");
    expect(withoutActions).toContain('href="#report-05"');
    expect(withoutActions).not.toContain("f9-evidence-report-rail-actions");

    const withActions = renderToStaticMarkup(
      createElement(ReportView, {
        report: legacyReport,
        preparedBy: "Agency Fixture Studio",
        railActions: createElement("button", { type: "button" }, "Send to client"),
      }),
    );
    expect(withActions).toContain("f9-evidence-report-rail-actions");
    expect(withActions).toContain("Send to client");
    expect(withActions).toContain("Agency Fixture Studio");
  });

  it("renders an absent landing-page URL as none stored", () => {
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

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).not.toContain("Offer unavailable");
    expect(markup).not.toContain("CTA unavailable");
    expect(markup).not.toContain("Creative text unavailable");
    expect(markup).not.toContain("Translation unavailable");
    expect(markup).not.toContain("Landing page unavailable");
    expect(markup).toMatch(
      /<span class="f9-evidence-fact-key">Still live at<\/span><span class="f9-evidence-fact-value is-missing">none stored<\/span>/,
    );
    expect(markup).toContain("f9-evidence-fact-value is-missing");
    // The row still leads with what is known.
    expect(markup).toContain("New offer");
  });

  it("renders an undetected language as Not detected", () => {
    const sparseRow: ReportDocument["rows"][number] = {
      ...reportRow("row-language", "https://example.com/source"),
      languageLabel: null,
    };

    const markup = renderToStaticMarkup(
      createElement(ReportView, { report: { ...legacyReport, rows: [sparseRow] } }),
    );

    expect(markup).toMatch(
      /<span class="f9-evidence-fact-key">Language<\/span><span class="f9-evidence-fact-value is-missing">Not detected<\/span>/,
    );
  });

  it("keeps unreadable-capture copy in the creative frame only", () => {
    const unreadableRow = unreadableReportRow("row-unreadable");

    const markup = renderToStaticMarkup(
      createElement(ReportView, {
        report: { ...legacyReport, rows: [unreadableRow] },
      }),
    );

    expect(markup).toContain(
      `<p class="f9-evidence-mock-empty">${UNREADABLE_CAPTURE_COPY}</p>`,
    );
    expect(markup.split(UNREADABLE_CAPTURE_COPY)).toHaveLength(2);
    expect(markup).not.toContain(
      `<span class="f9-evidence-fact-value is-missing">${UNREADABLE_CAPTURE_COPY}</span>`,
    );
  });

  it("keeps event verification when only the linked creative is unreadable", () => {
    const verifiedUnreadableRow = {
      ...unreadableReportRow("row-verified-unreadable"),
      landingPage: {
        url: "https://example.com/offer",
        headline: null,
        captureLabel: null,
        capturedAt: null,
        signals: [],
      },
    };

    const markup = renderToStaticMarkup(
      createElement(ReportView, {
        report: {
          ...legacyReport,
          resourceType: "watchlist",
          rows: [verifiedUnreadableRow],
        },
      }),
    );

    expect(markup).toContain("Verified evidence");
    expect(markup).toContain('href="https://example.com/offer"');
    expect(markup).toContain(
      `<p class="f9-evidence-mock-empty">${UNREADABLE_CAPTURE_COPY}</p>`,
    );
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

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).not.toContain("Offer unavailable");
    expect(markup).not.toContain("Ad context unavailable");
    expect(markup).not.toContain("Landing page unavailable");
    // Legacy signal placeholders remain omitted; the only surviving
    // "Not detected" is the honest Language fact-row fallback.
    expect(markup.match(/Not detected/g)).toHaveLength(1);
    expect(markup).toMatch(
      /<span class="f9-evidence-fact-key">Language<\/span><span class="f9-evidence-fact-value is-missing">Not detected<\/span>/,
    );
    expect(markup).not.toContain("Not checked yet");
  });

  it("does not describe saved collection evidence as a no-action watchlist report", () => {
    const savedProofRow = { ...reportRow("row-collection", ""), event: undefined };
    const report = { ...legacyReport, rows: [savedProofRow] };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).toContain("Saved evidence ready for review");
    expect(markup).toContain("1 saved evidence item packaged for review.");
    expect(markup).toContain("This is a curated evidence set, not a live change alert.");
    expect(markup).not.toContain("No client-ready change needs action");
  });

  it("states each event summary exactly once, on its own plate", () => {
    const report = {
      ...legacyReport,
      rows: [reportRow("row-signal", "https://example.com/source")],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).toContain("f9-evidence-why");
    expect(markup).not.toContain("Why it matters");
    expect(markup).not.toContain("Signal summary");
    expect(markup.match(/A new offer launched\./g)).toHaveLength(1);
  });

  /**
   * White-label regression. Five to Nine never signs a report it did not
   * prepare — the byline cell exists only when the workspace has an entitled
   * agency name.
   */
  it("omits the prepared-by byline entirely rather than signing with our own name", () => {
    const markup = renderToStaticMarkup(
      createElement(ReportView, { report: legacyReport }),
    );

    expect(markup).not.toContain("Prepared by");
    expect(markup).not.toMatch(/<dd>Five to Nine<\/dd>/);
    expect(markup).not.toContain("Five to Nine cannot show enough source evidence");
    expect(markup).toContain("Not enough source evidence was stored for a confident decision.");
    expect(markup).toContain("Subject");
    expect(markup).toContain("Evidence");
    expect(markup).toContain("Generated");

    const branded = renderToStaticMarkup(
      createElement(ReportView, { report: legacyReport, preparedBy: "  Northwind Growth  " }),
    );
    expect(branded).toContain("<dd>Northwind Growth</dd>");

    const blank = renderToStaticMarkup(
      createElement(ReportView, { report: legacyReport, preparedBy: "   " }),
    );
    expect(blank).not.toContain("Prepared by");
  });

  /**
   * A watch event with no linked ad defaults `previewHeadline` to the event
   * title. Before this, that one sentence printed as the plate header, the
   * plate heading, a "stored capture" line and the capture-trail entry.
   */
  it("states each sentence once per plate when the event has no linked ad", () => {
    const eventTitle = "Okara launched a new workflow offer";
    const report = {
      ...legacyReport,
      resourceType: "watchlist" as const,
      rows: [
        {
          ...reportRow("row-unlinked", "https://example.com/source"),
          advertiser: null,
          previewHeadline: eventTitle,
          offer: null,
          cta: null,
          creativeText: null,
          translatedText: null,
          event: {
            ...reportRow("row-unlinked", "")!.event!,
            typeLabel: "New ad",
            title: eventTitle,
          },
        },
      ],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    // Cover headline + plate heading. Nothing else repeats it: not the plate
    // header (which names the artefact), not the mock frame, not §04.
    expect(markup.match(new RegExp(eventTitle, "g")) ?? []).toHaveLength(2);
    expect(markup).toContain("PLATE 01 — New ad");
    expect(markup).toContain("Plate 01 — New ad");
    expect(markup).not.toContain(`<p class="f9-evidence-mock-line">${eventTitle}</p>`);
  });

  it("does not claim a stored capture on a plate that captured nothing", () => {
    const empty = {
      ...legacyReport,
      rows: [
        {
          ...reportRow("row-empty", "https://example.com/source"),
          advertiser: "Okara",
          previewHeadline: null,
          offer: null,
          cta: null,
          creativeText: null,
          translatedText: null,
          previewImageUrl: null,
          landingPage: { url: null, headline: null, captureLabel: null, capturedAt: null, signals: [] },
        },
      ],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report: empty }));

    expect(markup).toContain("We could not read this one.");
    expect(markup).not.toContain("This is the stored capture, not a re-render.");

    // …but it still says so on a plate that did capture something.
    const captured = { ...legacyReport, rows: [reportRow("row-full", "https://example.com/source")] };
    expect(renderToStaticMarkup(createElement(ReportView, { report: captured }))).toContain(
      "This is the stored capture, not a re-render.",
    );
  });

  it("still states a verdict when the top event carries no recommended action", () => {
    const row = reportRow("row-no-action", "https://example.com/source");
    const report = {
      ...legacyReport,
      resourceType: "watchlist" as const,
      rows: [{ ...row, event: { ...row.event!, recommendedAction: "   " } }],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).toContain("Our read");
    expect(markup).toContain("We have not scored a next move on this one.");
    expect(markup).not.toContain('<p class="f9-evidence-report-read-verdict"></p>');
  });

  it("renders the stored creative capture inside the plate's mock frame", () => {
    const report = {
      ...legacyReport,
      rows: [
        {
          ...reportRow("row-image", "https://example.com/source"),
          previewImageUrl: "https://cdn.example.com/creative.png",
        },
      ],
    };

    const markup = renderToStaticMarkup(createElement(ReportView, { report }));

    expect(markup).toContain("f9-evidence-mock-capture");
    expect(markup).toContain('src="https://cdn.example.com/creative.png"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
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

function unreadableReportRow(id: string): ReportDocument["rows"][number] {
  return {
    ...reportRow(id, "https://example.com/source"),
    previewHeadline: null,
    offer: null,
    cta: null,
    creativeText: null,
    translatedText: null,
    previewImageUrl: null,
    landingPage: {
      url: null,
      headline: null,
      captureLabel: null,
      capturedAt: null,
      signals: [],
    },
  };
}
