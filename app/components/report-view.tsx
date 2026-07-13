import type { ReportDocument } from "~/lib/report";
import { InsightDepthPanel } from "~/components/insight-depth-panel";
import { safeInsightDepthSummary } from "~/lib/insight-depth";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import { LocalTime } from "~/components/local-time";
import { ProofGlossary } from "~/components/proof-glossary";

function legacyReportLabelText(value: string) {
  return value
    .replace(/\bVerified proof\b/g, "Verified evidence")
    .replace(/\bProof unavailable\b/g, "Evidence unavailable")
    .replace(/\bProof snapshot\b/g, "Saved evidence")
    .replace(/\bProof capture\b/g, "Evidence capture")
    .replace(/\bproof capture\b/g, "evidence capture");
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

export function ReportView({ report }: { report: ReportDocument }) {
  const reportSnapshot = report as ReportDocument & { insightDepth?: unknown };
  const insightDepth = reportSnapshot.insightDepth
    ? safeInsightDepthSummary(reportSnapshot.insightDepth)
    : null;

  return (
    <div className="report-layout">
      <section className="report-hero">
        <div>
          <p className="f9-app-kicker">Evidence report</p>
          <h1>{report.title}</h1>
          <p className="f9-muted-copy">{report.subtitle}</p>
        </div>
        <div className="report-meta">
          <p className="f9-app-kicker">Generated</p>
          <p>
            <LocalTime iso={report.generatedAt} />
          </p>
        </div>
      </section>

      <p className="report-summary">{report.summary}</p>

      <ReportDecisionSummary report={report} />

      {report.sourceCoverage ? (
        <section className="f9-proof-packet" aria-label="Report source coverage">
          <div>
            <span className="f9-app-kicker">Evidence and source coverage</span>
            <h3>Client-ready evidence filter</h3>
            <p className="f9-muted-copy">{report.sourceCoverage.note}</p>
          </div>
          <dl className="proof-trail-list">
            <div>
              <dt>Verified evidence</dt>
              <dd>{report.sourceCoverage.proofMix.verifiedProof}</dd>
            </div>
            <div>
              <dt>Check-spotted</dt>
              <dd>{report.sourceCoverage.proofMix.scanSpotted}</dd>
            </div>
            <div>
              <dt>Needs review</dt>
              <dd>{report.sourceCoverage.proofMix.needsReview}</dd>
            </div>
            <div>
              <dt>Excluded</dt>
              <dd>{report.sourceCoverage.excluded}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="report-stats" aria-label="Report summary">
        {report.stats.map((stat) => (
          <article className="report-stat-card" key={stat.label}>
            <p className="f9-app-kicker">{stat.label}</p>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </section>

      <ProofGlossary />

      {insightDepth ? <InsightDepthPanel summary={insightDepth} /> : null}

      <section className="report-list" aria-label="Report rows">
        {report.rows.map((row) => (
          <ReportRowCard key={row.id} row={row} />
        ))}
      </section>
      {report.rows.length === 0 ? (
        <section className="f9-empty-panel">
          <h2>No client-ready evidence in this report</h2>
          <p>Only client-ready changes with saved evidence are included in source-backed reports.</p>
        </section>
      ) : null}
    </div>
  );
}

function ReportRowCard({ row }: { row: ReportDocument["rows"][number] }) {
  const advertiser = presentReportValue(row.advertiser);
  const previewHeadline = presentReportValue(row.previewHeadline);
  const languageLabel = presentReportValue(row.languageLabel);
  const heading = advertiser
    ? formatAdvertiserLabel(advertiser)
    : previewHeadline ?? row.event?.title ?? "Saved ad";
  const subheading = advertiser ? previewHeadline : null;

  const adSummaryFields = [
    { label: "Offer", value: presentReportValue(row.offer) },
    { label: "CTA", value: presentReportValue(row.cta) },
    { label: "Creative text", value: presentReportValue(row.creativeText) },
    { label: "Translated text", value: presentReportValue(row.translatedText) },
  ].filter((field): field is { label: string; value: string } => Boolean(field.value));
  const hasAdSummary = adSummaryFields.length > 0 || row.tags.length > 0 || Boolean(row.note);

  const landingPageUrl = presentReportValue(row.landingPage.url);
  const landingPageHeadline = presentReportValue(row.landingPage.headline);
  const captureLabel = presentReportValue(row.landingPage.captureLabel);
  const landingPageSignals = row.landingPage.signals
    .map((signal) => ({ label: signal.label, value: presentReportValue(signal.value) }))
    .filter((signal): signal is { label: string; value: string } => Boolean(signal.value));
  const hasLandingPage =
    Boolean(landingPageUrl || landingPageHeadline || captureLabel) ||
    landingPageSignals.length > 0;

  return (
    <article className="report-card">
      <div className="report-card-header">
        <div>
          <p className="f9-app-kicker">{row.formatLabel}</p>
          <h2>{heading}</h2>
          {subheading ? <p className="f9-muted-copy">{subheading}</p> : null}
        </div>
        <div className="report-card-meta">
          {languageLabel ? <span className="f9-status-pill">{languageLabel}</span> : null}
          {row.event ? <span className="f9-status-pill">{row.event.typeLabel}</span> : null}
        </div>
      </div>

      {row.previewImageUrl ? (
        <img
          alt={`${heading} creative preview`}
          className="report-preview"
          src={row.previewImageUrl}
        />
      ) : null}

      {row.event ? (
        <section className="report-event">
          <p className="f9-app-kicker">Competitor change</p>
          <h3>{row.event.title}</h3>
          <p>{row.event.summary}</p>
          <dl className="proof-trail-list">
            <div>
              <dt>Source status</dt>
              <dd>{legacyReportLabelText(row.event.proofStatusLabel)}</dd>
            </div>
            <div>
              <dt>Source type</dt>
              <dd>{legacyReportLabelText(row.event.sourceTypeLabel)}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                {row.event.priorityBand}
                {row.event.priorityScore === null ? "" : ` · ${row.event.priorityScore}/100`}
              </dd>
            </div>
            <div>
              <dt>Next move</dt>
              <dd>{row.event.recommendedAction}</dd>
            </div>
            <div>
              <dt>Source trail</dt>
              <dd>{legacyReportLabelText(row.event.proofTrail)}</dd>
            </div>
            {row.event.sourceUrl && isHttpUrl(row.event.sourceUrl) ? (
              <div>
                <dt>Source link</dt>
                <dd>
                  <a href={row.event.sourceUrl} rel="noreferrer" target="_blank">
                    Open source
                  </a>
                </dd>
              </div>
            ) : null}
            {row.event.metaAdId ? (
              <div>
                <dt>Meta ad ID</dt>
                <dd>{row.event.metaAdId}</dd>
              </div>
            ) : null}
          </dl>
          <p className="f9-muted-copy">
            <LocalTime iso={row.event.createdAt} />
          </p>
        </section>
      ) : null}

      {hasAdSummary || hasLandingPage ? (
        <div className="report-columns">
          {hasAdSummary ? (
            <section className="report-column">
              <p className="f9-app-kicker">Ad summary</p>
              {adSummaryFields.length > 0 ? (
                <dl className="report-field-list">
                  {adSummaryFields.map((field) => (
                    <div className="report-field" key={`${row.id}-summary-${field.label}`}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {row.tags.length > 0 ? (
                <div className="report-tag-list">
                  {row.tags.map((tag) => (
                    <span className="f9-status-pill" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}

              {row.note ? (
                <div className="report-note">
                  <p className="f9-app-kicker">Team note</p>
                  <p>{row.note}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          {hasLandingPage ? (
            <section className="report-column">
              <p className="f9-app-kicker">Landing page</p>
              <dl className="report-field-list">
                {landingPageUrl ? (
                  <div className="report-field">
                    <dt>URL</dt>
                    <dd>
                      {isHttpUrl(landingPageUrl) ? (
                        <a href={landingPageUrl} rel="noreferrer" target="_blank">
                          {landingPageUrl}
                        </a>
                      ) : (
                        landingPageUrl
                      )}
                    </dd>
                  </div>
                ) : null}
                {landingPageHeadline ? (
                  <div className="report-field">
                    <dt>Headline</dt>
                    <dd>{landingPageHeadline}</dd>
                  </div>
                ) : null}
                {captureLabel ? (
                  <div className="report-field">
                    <dt>Capture</dt>
                    <dd>
                      {captureLabel}
                      {row.landingPage.capturedAt ? (
                        <> · <LocalTime iso={row.landingPage.capturedAt} /></>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {landingPageSignals.length > 0 ? (
                <div className="report-signal-grid">
                  {landingPageSignals.map((signal) => (
                    <div className="report-signal-card" key={signal.label}>
                      <p className="f9-app-kicker">{signal.label}</p>
                      <strong>{signal.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      {row.analysisFields.length > 0 ? (
        <section className="report-analysis">
          <p className="f9-app-kicker">Evidence fields</p>
          <dl className="report-field-list">
            {row.analysisFields.map((field) => (
              <div className="report-field" key={`${row.id}-${field.label}`}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
                {field.sourceLabel ? (
                  <p className="report-field-meta">{field.sourceLabel}</p>
                ) : null}
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </article>
  );
}

function ReportDecisionSummary({ report }: { report: ReportDocument }) {
  const topEvent = report.rows
    .map((row) => row.event)
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .sort((a, b) => (b.priorityScore ?? -1) - (a.priorityScore ?? -1))[0] ?? null;

  if (!topEvent && report.resourceType === "collection") {
    return <CollectionDecisionSummary report={report} />;
  }

  if (!topEvent) {
    return (
      <section className="f9-proof-packet" aria-label="Report decision summary">
        <div>
          <span className="f9-app-kicker">Decision summary</span>
          <h3>No client-ready change needs action</h3>
          <p className="f9-muted-copy">{report.summary}</p>
        </div>
        <dl className="proof-trail-list">
          <div>
            <dt>What changed</dt>
            <dd>No verified report row is ready to act on.</dd>
          </div>
          <div>
            <dt>Next action</dt>
            <dd>Review source coverage or wait for the next source-backed report.</dd>
          </div>
        </dl>
      </section>
    );
  }

  const urgency = topEvent.priorityScore === null
    ? topEvent.priorityBand
    : `${topEvent.priorityBand} · ${topEvent.priorityScore}/100`;

  return (
    <section className="f9-proof-packet" aria-label="Report decision summary">
      <div>
        <span className="f9-app-kicker">Decision summary</span>
        <h3>{topEvent.title}</h3>
        <p className="f9-muted-copy">{topEvent.summary}</p>
      </div>
      <dl className="proof-trail-list">
        <div>
          <dt>What changed</dt>
          <dd>{topEvent.title}</dd>
        </div>
        <div>
          <dt>Why it matters</dt>
          <dd>{topEvent.summary}</dd>
        </div>
        <div>
          <dt>Urgency</dt>
          <dd>{urgency}</dd>
        </div>
        <div>
          <dt>Source status</dt>
          <dd>{legacyReportLabelText(topEvent.proofStatusLabel)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{legacyReportLabelText(topEvent.sourceTypeLabel)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd><LocalTime iso={topEvent.createdAt} /></dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>{topEvent.recommendedAction}</dd>
        </div>
      </dl>
    </section>
  );
}

function CollectionDecisionSummary({ report }: { report: ReportDocument }) {
  const rowCount = report.rows.length;
  const rowLabel = `${rowCount} saved evidence item${rowCount === 1 ? "" : "s"}`;
  const hasRows = rowCount > 0;

  return (
    <section className="f9-proof-packet" aria-label="Report decision summary">
      <div>
        <span className="f9-app-kicker">Decision summary</span>
        <h3>{hasRows ? "Saved evidence ready for review" : "No saved evidence rows yet"}</h3>
        <p className="f9-muted-copy">{report.summary}</p>
      </div>
      <dl className="proof-trail-list">
        <div>
          <dt>What changed</dt>
          <dd>{hasRows ? `${rowLabel} packaged for review.` : "No saved evidence is in this report."}</dd>
        </div>
        <div>
          <dt>Why it matters</dt>
          <dd>
            {hasRows
              ? "This is a curated evidence set, not a live change alert."
              : "The report is ready to fill once evidence is saved."}
          </dd>
        </div>
        <div>
          <dt>Urgency</dt>
          <dd>{hasRows ? "Review before sharing" : "No action needed"}</dd>
        </div>
        <div>
          <dt>Source status</dt>
          <dd>{hasRows ? "Saved evidence collection" : "Evidence unavailable"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{hasRows ? "Saved collection" : "No source rows"}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd><LocalTime iso={report.generatedAt} /></dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>{hasRows ? "Review the rows below, then share or export the report." : "Save evidence into this collection."}</dd>
        </div>
      </dl>
    </section>
  );
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
