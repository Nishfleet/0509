import type { ReactNode } from "react";

import type { ReportDocument, ReportEventSummary, ReportRow } from "~/lib/report";
import { LocalTime } from "~/components/local-time";
import { ProofGlossary } from "~/components/proof-glossary";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import {
  EvidencePlate,
  FactRail,
  QuietLineList,
  STORED_CAPTURE_NOTE,
  SpecimenEmptyState,
  formatPlateNumber,
  type FactRow,
  type QuietLineItem,
} from "~/components/evidence";

/**
 * The agency report as a deliverable — BL-009.
 *
 * Build brief: docs/design/EVIDENCE-DESK-BRIEF.md §6.10 (cover + three-number
 * headline strip + contents rail + "Our read" callout), §6.9 (numbered
 * evidence plates, referenced by number in the prose — R3 + R4), §4.4 (full
 * volume type), §8.4 ("how this was checked"). This is the artefact an agency
 * hands to a client, so it runs at FULL volume (DESIGN.md "One system, two
 * volumes") while the rest of the workspace stays at 0.7.
 *
 * It replaces 4,400px of stacked `MICRO-LABEL: value` rows (anti-reference A1)
 * with one document: an ink cover whose headline is the finding, exactly three
 * numbers, five numbered sections in one reading column, and the evidence as
 * numbered plates.
 */

function legacyReportLabelText(value: string) {
  return value
    .replace(/\bVerified proof\b/g, "Verified evidence")
    .replace(/\bProof unavailable\b/g, "Evidence unavailable")
    .replace(/\bProof snapshot\b/g, "Saved evidence")
    .replace(/\bProof capture\b/g, "Evidence capture")
    .replace(/\bproof capture\b/g, "evidence capture")
    .replace(/\bnon[- ]client[- ]ready\b/gi, "unreviewed")
    .replace(/\bclient[- ]ready\b/gi, "verified");
}

// Placeholder prose written into report snapshots before missing fields
// became null. Treat these exactly like absent data so old shared reports
// stop apologizing too.
const LEGACY_PLACEHOLDER_VALUES = new Set([
  "ad context unavailable",
  "preview unavailable",
  "offer unavailable",
  "cta unavailable",
  "language unavailable",
  "creative text unavailable",
  "translation unavailable",
  "landing page unavailable",
  "landing page headline unavailable",
  "not detected",
  "not checked yet",
]);

function presentReportValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return LEGACY_PLACEHOLDER_VALUES.has(trimmed.toLowerCase()) ? null : trimmed;
}

/** Brief §8.4 — every report ends with this sentence, verbatim. */
export const REPORT_METHOD_SENTENCE =
  "Where a number was not published by the source, this report says so rather than estimating it.";

export const REPORT_SECTIONS = [
  { id: "report-01", number: "01", title: "What we found" },
  { id: "report-02", number: "02", title: "The evidence" },
  { id: "report-03", number: "03", title: "What we recommend" },
  { id: "report-04", number: "04", title: "Every capture" },
  { id: "report-05", number: "05", title: "How this was checked" },
] as const;

/**
 * A 26ch note under each headline number (brief §6.10). Anything we cannot
 * describe honestly falls back to how the number was produced, never to a
 * claim about what it means.
 */
const HEADLINE_NUMBER_NOTES: Record<string, string> = {
  Ads: "Saved ads, each with its capture",
  Countries: "Countries these ads ran in",
  Platforms: "Where we saw them running",
  Events: "Changes we captured and kept",
  "Linked ads": "Changes with an ad attached",
  "Event types": "Kinds of change in the window",
  Excluded: "Left out for want of evidence",
};

const HEADLINE_NUMBER_FALLBACK_NOTE = "Counted from the captures below";

export interface ReportViewProps {
  report: ReportDocument;
  /** Cover byline — the agency that prepared this. */
  preparedBy?: string | null;
  /**
   * The client action card (brief §6.10) — Rank 1 "Send to client", Rank 2
   * "Download PDF". Rendered at the top of the contents rail so the report's
   * one primary action is never duplicated inside the document.
   */
  railActions?: ReactNode;
  /** Agency branding note under the rail. */
  brandingNote?: ReactNode;
}

export function ReportView({ report, preparedBy, railActions, brandingNote }: ReportViewProps) {
  const finding = resolveReportFinding(report);
  const captureWindow = resolveReportWindow(report);
  const preparedByName = preparedBy?.trim();
  const headlineNumbers = report.stats.slice(0, 3);
  const overflowNumbers = report.stats.slice(3);
  const plateCount = report.rows.length;

  return (
    <div className="f9-evidence-report" data-wk-volume="full">
      <div className="f9-evidence-report-main">
        <header className="f9-evidence-report-cover">
          <p className="f9-evidence-report-kicker f9-evidence-micro">
            {report.resourceType === "watchlist"
              ? "Competitor evidence report"
              : "Collection evidence report"}
            {captureWindow ? (
              <>
                {" · "}
                <LocalTime iso={captureWindow.start} mode="date" />
                {captureWindow.start === captureWindow.end ? null : (
                  <>
                    {" – "}
                    <LocalTime iso={captureWindow.end} mode="date" />
                  </>
                )}
              </>
            ) : null}
          </p>
          <h1 className="f9-evidence-report-headline">{finding.headline}</h1>
          <p className="f9-evidence-report-standfirst">{report.summary}</p>
          <dl className="f9-evidence-report-byline">
            {/* White-label: an agency's report carries the agency's name or no
                byline at all. Five to Nine never signs a document it did not
                prepare — the product credit lives in the shared page's
                powered-by footer, which the plan catalog governs. */}
            {preparedByName ? (
              <ReportBylineCell label="Prepared by" value={preparedByName} />
            ) : null}
            <ReportBylineCell label="Subject" value={report.title} />
            <ReportBylineCell
              label="Evidence"
              value={
                plateCount === 0
                  ? "No plates yet"
                  : `${plateCount} plate${plateCount === 1 ? "" : "s"}`
              }
            />
            <ReportBylineCell
              label="Generated"
              value={<LocalTime iso={report.generatedAt} />}
            />
          </dl>
        </header>

        {headlineNumbers.length > 0 ? (
          <section
            aria-label="Report headline numbers"
            className="f9-evidence-report-numbers"
            data-count={headlineNumbers.length}
          >
            {headlineNumbers.map((stat) => (
              <article className="f9-evidence-report-number" key={stat.label}>
                <p className="f9-evidence-report-number-key f9-evidence-micro">{stat.label}</p>
                <strong className="f9-evidence-report-number-value">{stat.value}</strong>
                <p className="f9-evidence-report-number-note">
                  {HEADLINE_NUMBER_NOTES[stat.label] ?? HEADLINE_NUMBER_FALLBACK_NOTE}
                </p>
              </article>
            ))}
          </section>
        ) : null}

        <section className="f9-evidence-report-section" id="report-01">
          <ReportSectionHeading number="01" title="What we found" />
          <aside className="f9-evidence-report-read">
            <p className="f9-evidence-micro">Our read</p>
            <p className="f9-evidence-report-read-verdict">{finding.verdict}</p>
          </aside>
          <p className="f9-evidence-report-prose">{describeWhatWeFound(report)}</p>
          <p className="f9-evidence-report-prose">{describePlateReference(plateCount)}</p>
          {report.aiWeeklySummary ? (
            <div className="f9-evidence-report-aside">
              <p className="f9-evidence-micro">
                AI weekly summary · week ending{" "}
                <LocalTime iso={report.aiWeeklySummary.periodEnd} mode="date" />
              </p>
              <p className="f9-evidence-report-prose">{report.aiWeeklySummary.paragraph}</p>
              <p className="f9-evidence-report-footnote">
                Written by AI from the stored digest. Every claim it makes is checkable against the
                plates below.
              </p>
            </div>
          ) : null}
        </section>

        <section
          aria-label="Report evidence plates"
          className="f9-evidence-report-section"
          id="report-02"
        >
          <ReportSectionHeading number="02" title="The evidence" />
          {plateCount > 0 ? (
            <div className="f9-evidence-report-plates">
              {report.rows.map((row, index) => (
                <ReportEvidencePlate key={row.id} number={index + 1} row={row} />
              ))}
            </div>
          ) : (
            <SpecimenEmptyState
              copy="Only a change with a stored capture is filed here. The next check that finds something opens plate 01, with the capture time it was taken from."
              headingLevel={3}
              headline="No plate is filed yet"
              stateLabel={`${report.title} · no verified evidence in this window`}
            />
          )}
        </section>

        <section className="f9-evidence-report-section" id="report-03">
          <ReportSectionHeading number="03" title="What we recommend" />
          <ReportMoves report={report} />
        </section>

        <section className="f9-evidence-report-section" id="report-04">
          <ReportSectionHeading number="04" title="Every capture" />
          <p className="f9-evidence-report-prose">
            The complete trail behind this report — every capture that made it in, with the time it
            was taken.
          </p>
          {plateCount > 0 ? (
            <QuietLineList items={buildCaptureTrail(report)} />
          ) : (
            <p className="f9-evidence-report-prose">
              No capture has been filed in this window yet.
            </p>
          )}
        </section>

        <section className="f9-evidence-report-section" id="report-05">
          <ReportSectionHeading number="05" title="How this was checked" />
          <FactRail rows={buildMethodRows(report, captureWindow, overflowNumbers)} title="Method" />
          {report.sourceCoverage ? (
            <p className="f9-evidence-report-prose">
              {legacyReportLabelText(report.sourceCoverage.note)}
            </p>
          ) : null}
          <p className="f9-evidence-report-prose">{REPORT_METHOD_SENTENCE}</p>
          {/* Brief §6.10: the glossary sits at the END of the document, out of
              the reading flow — it is reference material, not the report. */}
          <details className="f9-evidence-report-glossary">
            <summary className="f9-evidence-micro">Evidence labels</summary>
            <ProofGlossary audience="deliverable" />
          </details>
        </section>
      </div>

      <aside aria-label="Report contents and actions" className="f9-evidence-report-rail">
        {railActions ? <div className="f9-evidence-report-rail-actions">{railActions}</div> : null}
        <nav aria-label="Report contents" className="f9-evidence-report-contents">
          <p className="f9-evidence-micro">Contents</p>
          <ol>
            {REPORT_SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>
                  <span className="f9-evidence-report-contents-number">{section.number}</span>
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {brandingNote ? <div className="f9-evidence-report-rail-brand">{brandingNote}</div> : null}
      </aside>
    </div>
  );
}

function ReportSectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <h2 className="f9-evidence-report-section-heading">
      <span className="f9-evidence-report-section-number">{number}</span>
      <span>{title}</span>
    </h2>
  );
}

function ReportBylineCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="f9-evidence-report-byline-cell">
      <dt className="f9-evidence-micro">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * A plate says each thing exactly once. Without this discipline a watch event
 * with no linked ad — where the builder defaults `previewHeadline` to the
 * event title — printed the same sentence as the plate header, its heading,
 * a "stored capture" line and the capture-trail entry.
 *
 * Header = the artefact this plate shows (EvidencePlate's own contract).
 * Heading = the finding. Capture frame = only what we actually captured.
 */
export function resolveReportPlateContent(row: ReportRow) {
  const advertiser = presentReportValue(row.advertiser);
  const advertiserLabel = advertiser ? formatAdvertiserLabel(advertiser) : null;
  const previewHeadline = presentReportValue(row.previewHeadline);
  const eventTitle = presentReportValue(row.event?.title);

  const artefactKind =
    presentReportValue(row.event?.typeLabel) ??
    presentReportValue(row.formatLabel) ??
    "Ad creative";
  const title = advertiserLabel ? `${artefactKind} · ${advertiserLabel}` : artefactKind;

  // The advertiser already identifies an eventless saved ad in the header, so
  // it never also becomes the heading.
  const headline = eventTitle ?? (advertiserLabel ? null : previewHeadline);

  const captureLines = [
    previewHeadline === headline || previewHeadline === eventTitle ? null : previewHeadline,
    presentReportValue(row.offer),
    presentReportValue(row.cta),
    presentReportValue(row.creativeText),
    presentReportValue(row.translatedText),
    presentReportValue(row.landingPage.headline),
  ].filter((line): line is string => Boolean(line));

  // Verification qualifies the watch event's stored proof capture and matched
  // change, not OCR/readability of the linked ad creative shown in this frame.
  // Report building admits only events classified as verified proof. But the
  // external reader can only trust what they can inspect: a bare "Verified
  // evidence" stamp beside an empty frame asks them to trust an internal
  // classification, so when nothing visible backs the stamp the label says
  // exactly what was verified and what is missing.
  const plateHasVisibleCapture =
    Boolean(row.previewImageUrl) || captureLines.length > 0;
  // "Verified evidence" as a bare stamp requires something the reader can
  // open and inspect — a stored screenshot. Capture text alone keeps the
  // verification but says what is and is not stored, in plain words.
  const plateHasInspectableCapture = Boolean(row.previewImageUrl);
  const rawVerification = row.event
    ? legacyReportLabelText(row.event.proofStatusLabel)
    : "Saved evidence";
  const verification =
    row.event && !plateHasInspectableCapture && /verified/i.test(rawVerification)
      ? "We verified this change from the stored page capture. No screenshot is stored to show here."
      : rawVerification;

  return {
    advertiserLabel,
    artefactKind,
    title,
    headline,
    captureLines,
    subject: advertiserLabel ?? headline ?? previewHeadline ?? "Saved ad",
    verification,
    capturedAt: row.landingPage.capturedAt ?? row.event?.createdAt ?? null,
    // A capture note may only claim a capture exists when one does.
    hasCapture: plateHasVisibleCapture,
  };
}

function ReportEvidencePlate({ number, row }: { number: number; row: ReportRow }) {
  const plate = resolveReportPlateContent(row);

  return (
    <EvidencePlate
      capture={
        row.previewImageUrl ? (
          <img
            alt={`${plate.subject} — stored creative capture`}
            className="f9-evidence-mock-capture"
            referrerPolicy="no-referrer"
            src={row.previewImageUrl}
          />
        ) : null
      }
      captureLines={plate.captureLines}
      capturedAt={plate.capturedAt}
      facts={buildPlateFacts(row)}
      footnote={buildPlateFootnote(row, plate.hasCapture)}
      headingLevel={3}
      headline={plate.headline ?? undefined}
      number={number}
      title={plate.title}
      verification={plate.verification}
      why={row.event?.summary}
    />
  );
}

/**
 * Brief §6.6 — edited down to what an agency would quote, and a value we do
 * not have still renders as a row with an honest inline string. This is the
 * rule that deletes the six-box "Insight depth" grid (A2) from the report.
 */
function buildPlateFacts(row: ReportRow): FactRow[] {
  const event = row.event;
  const landingPageUrl = presentReportValue(row.landingPage.url);
  const rows: FactRow[] = [
    {
      key: "What changed",
      missingLabel: "a saved ad, not a change",
      value: event?.typeLabel ?? null,
    },
    {
      key: "First seen",
      missingLabel: "capture time not recorded",
      value: event ? <LocalTime iso={event.createdAt} /> : null,
    },
    {
      key: "Source status",
      missingLabel: "saved by hand",
      value: event ? legacyReportLabelText(event.proofStatusLabel) : null,
    },
    {
      key: "Source",
      missingLabel: "not published",
      value: event ? legacyReportLabelText(event.sourceTypeLabel) : null,
    },
    {
      key: "Source link",
      missingLabel: "none stored",
      value:
        event?.sourceUrl && isHttpUrl(event.sourceUrl) ? (
          <a
            className="f9-report-fact-link"
            href={event.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open the source
          </a>
        ) : null,
    },
    {
      key: "Still live at",
      missingLabel: "none stored",
      value:
        landingPageUrl && isHttpUrl(landingPageUrl) ? (
          <a
            className="f9-report-fact-link"
            href={landingPageUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open the page
          </a>
        ) : null,
    },
    {
      key: "Language",
      missingLabel: "Not detected",
      value: presentReportValue(row.languageLabel),
    },
    {
      key: "Urgency",
      missingLabel: "none scored",
      value: event
        ? event.priorityScore === null
          ? event.priorityBand
          : `${event.priorityBand} · ${event.priorityScore}/100`
        : null,
    },
  ];

  return rows;
}

function buildPlateFootnote(row: ReportRow, hasCapture: boolean) {
  const parts: string[] = [];
  if (row.event?.proofTrail) {
    parts.push(legacyReportLabelText(row.event.proofTrail));
  }
  const format = presentReportValue(row.formatLabel);
  if (format && format !== "unknown") {
    parts.push(`Format: ${format}`);
  }
  if (row.event?.metaAdId) {
    parts.push(`Meta ad ID ${row.event.metaAdId}`);
  }
  const captureLabel = presentReportValue(row.landingPage.captureLabel);
  if (captureLabel) {
    parts.push(captureLabel);
  }
  if (row.note) {
    parts.push(`Team note: ${row.note}`);
  }
  if (row.tags.length > 0) {
    parts.push(`Tagged ${row.tags.join(", ")}`);
  }
  // Never promise a stored capture on a plate that has none — the frame is
  // already saying "we could not read this one" (brief §8.1).
  if (hasCapture) {
    parts.push(STORED_CAPTURE_NOTE);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function ReportMoves({ report }: { report: ReportDocument }) {
  const moves: Array<{ plate: number; action: string }> = [];
  const seen = new Set<string>();
  report.rows.forEach((row, index) => {
    const action = row.event?.recommendedAction?.trim();
    if (!action || seen.has(action)) return;
    seen.add(action);
    moves.push({ plate: index + 1, action });
  });

  if (moves.length === 0) {
    return (
      <p className="f9-evidence-report-prose">
        {report.rows.length > 0
          ? "Nothing here needs a move today. Read the plates, then send this on."
          : "Nothing needs action from this window. The next check that finds something changes that."}
      </p>
    );
  }

  return (
    <ol className="f9-evidence-report-moves">
      {moves.map((move) => (
        <li key={`${move.plate}-${move.action}`}>
          <span className="f9-evidence-micro">Plate {formatPlateNumber(move.plate)}</span>
          <p>{move.action}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * The trail names the artefact each plate holds, not the finding — the finding
 * is already the plate's heading, and repeating it here is what made a
 * one-plate report read like an echo chamber.
 */
function buildCaptureTrail(report: ReportDocument): QuietLineItem[] {
  return report.rows.map((row, index) => {
    const plate = resolveReportPlateContent(row);
    return {
      id: row.id,
      stamp: plate.capturedAt ? (
        <LocalTime iso={plate.capturedAt} />
      ) : (
        "capture time not recorded"
      ),
      copy: `Plate ${formatPlateNumber(index + 1)} — ${plate.title}`,
    };
  });
}

function buildMethodRows(
  report: ReportDocument,
  window: { start: string; end: string } | null,
  overflowNumbers: ReportDocument["stats"],
): FactRow[] {
  const coverage = report.sourceCoverage;

  // Kept under the 8-row ceiling (brief §6.6) and ordered so the proof mix —
  // the numbers a client can audit — always survives the slice.
  return [
    // The report TYPE is already stamped on the cover kicker, so the rail
    // spends its first row on the thing the kicker cannot say: what was
    // watched.
    { key: "Subject", missingLabel: "not published", value: presentReportValue(report.subtitle) },
    {
      key: "Window",
      missingLabel: "a single capture",
      value: window ? (
        <>
          <LocalTime iso={window.start} mode="date" />
          {window.start === window.end ? null : (
            <>
              {" – "}
              <LocalTime iso={window.end} mode="date" />
            </>
          )}
        </>
      ) : null,
    },
    ...(coverage
      ? [
          { key: "Verified evidence", value: String(coverage.proofMix.verifiedProof) },
          { key: "Check-spotted", value: String(coverage.proofMix.scanSpotted) },
          { key: "Needs review", value: String(coverage.proofMix.needsReview) },
        ]
      : [{ key: "Evidence included", value: String(report.rows.length) }]),
    { key: "Generated", value: <LocalTime iso={report.generatedAt} /> },
    ...overflowNumbers.map((stat) => ({ key: stat.label, value: stat.value })),
  ];
}

export function resolveReportFinding(report: ReportDocument): {
  headline: string;
  verdict: string;
} {
  const topEvent = resolveTopEvent(report);

  if (topEvent) {
    return {
      headline: topEvent.title,
      // Mirrors ReportMoves: a blank recommended action is not a verdict, and
      // an empty accent block would read as a missing product promise.
      verdict:
        topEvent.recommendedAction?.trim() ||
        "We have not scored a next move on this one. The evidence is below — the call is yours.",
    };
  }

  if (report.resourceType === "collection") {
    return report.rows.length > 0
      ? {
          headline: "Saved evidence ready for review",
          verdict: "This is a curated evidence set, not a live change alert.",
        }
      : {
          headline: "Nothing saved here yet",
          verdict:
            "Anything you save from a search or a competitor shows up here with the capture that proves it.",
        };
  }

  return {
    headline: "Nothing changed in this window",
    verdict: "We checked and nothing moved. That is the finding, not a gap.",
  };
}

function resolveTopEvent(report: ReportDocument): ReportEventSummary | null {
  return (
    report.rows
      .map((row) => row.event)
      .filter((event): event is ReportEventSummary => Boolean(event))
      .sort((left, right) => (right.priorityScore ?? -1) - (left.priorityScore ?? -1))[0] ?? null
  );
}

function describeWhatWeFound(report: ReportDocument) {
  const count = report.rows.length;

  if (report.resourceType === "collection") {
    return count === 0
      ? "No saved evidence is in this report."
      : `${count} saved evidence item${count === 1 ? "" : "s"} packaged for review.`;
  }

  return count === 0
    ? "No change cleared the evidence bar in this window."
    : `${count} change${count === 1 ? "" : "s"} cleared the evidence bar in this window.`;
}

function describePlateReference(plateCount: number) {
  if (plateCount === 0) {
    return "There is no plate to read yet. The next check that clears the evidence bar opens plate 01.";
  }
  if (plateCount === 1) {
    return "The evidence is plate 01 below, stamped with the time the capture was taken.";
  }
  return `The evidence is plates 01–${formatPlateNumber(plateCount)} below, each stamped with the time its capture was taken.`;
}

/**
 * The window this report covers, taken only from capture timestamps we hold.
 * Never widened to look thorough (brief §8.1).
 */
function resolveReportWindow(report: ReportDocument): { start: string; end: string } | null {
  const stamps = report.rows
    .flatMap((row) => [row.event?.createdAt, row.landingPage.capturedAt])
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (stamps.length === 0) return null;

  return {
    start: new Date(Math.min(...stamps)).toISOString(),
    end: new Date(Math.max(...stamps)).toISOString(),
  };
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
