import type { ReportDocument } from "~/lib/report";
import { InsightDepthPanel } from "~/components/insight-depth-panel";
import { safeInsightDepthSummary } from "~/lib/insight-depth";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import { LocalTime } from "~/components/local-time";
import { ProofGlossary } from "~/components/proof-glossary";

export function ReportView({ report }: { report: ReportDocument }) {
  const reportSnapshot = report as ReportDocument & { insightDepth?: unknown };
  const insightDepth = reportSnapshot.insightDepth
    ? safeInsightDepthSummary(reportSnapshot.insightDepth)
    : null;

  return (
    <div className="report-layout">
      <section className="report-hero">
        <div>
          <p className="f9-app-kicker">Proof report</p>
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
            <span className="f9-app-kicker">Proof and source coverage</span>
            <h3>Client-ready evidence filter</h3>
            <p className="f9-muted-copy">{report.sourceCoverage.note}</p>
          </div>
          <dl className="proof-trail-list">
            <div>
              <dt>Verified proof</dt>
              <dd>{report.sourceCoverage.proofMix.verifiedProof}</dd>
            </div>
            <div>
              <dt>Scan-spotted</dt>
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
          <article className="report-card" key={row.id}>
            <div className="report-card-header">
              <div>
                <p className="f9-app-kicker">{row.formatLabel}</p>
                <h2>{formatAdvertiserLabel(row.advertiser)}</h2>
                <p className="f9-muted-copy">{row.previewHeadline}</p>
              </div>
              <div className="report-card-meta">
                <span className="f9-status-pill">{row.languageLabel}</span>
                {row.event ? <span className="f9-status-pill">{row.event.typeLabel}</span> : null}
              </div>
            </div>

            {row.previewImageUrl ? (
              <img
                alt={`${formatAdvertiserLabel(row.advertiser)} creative preview`}
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
                    <dt>Proof status</dt>
                    <dd>{row.event.proofStatusLabel}</dd>
                  </div>
                  <div>
                    <dt>Source type</dt>
                    <dd>{row.event.sourceTypeLabel}</dd>
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
                    <dt>Proof trail</dt>
                    <dd>{row.event.proofTrail}</dd>
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

            <div className="report-columns">
              <section className="report-column">
                <p className="f9-app-kicker">Ad summary</p>
                <dl className="report-field-list">
                  <div className="report-field">
                    <dt>Offer</dt>
                    <dd>{row.offer}</dd>
                  </div>
                  <div className="report-field">
                    <dt>CTA</dt>
                    <dd>{row.cta}</dd>
                  </div>
                  <div className="report-field">
                    <dt>Creative text</dt>
                    <dd>{row.creativeText}</dd>
                  </div>
                  <div className="report-field">
                    <dt>Translated text</dt>
                    <dd>{row.translatedText}</dd>
                  </div>
                </dl>

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

              <section className="report-column">
                <p className="f9-app-kicker">Landing page</p>
                <dl className="report-field-list">
                  <div className="report-field">
                    <dt>URL</dt>
                    <dd>
                      {isHttpUrl(row.landingPage.url) ? (
                        <a href={row.landingPage.url} rel="noreferrer" target="_blank">
                          {row.landingPage.url}
                        </a>
                      ) : (
                        row.landingPage.url
                      )}
                    </dd>
                  </div>
                  <div className="report-field">
                    <dt>Headline</dt>
                    <dd>{row.landingPage.headline}</dd>
                  </div>
                  <div className="report-field">
                    <dt>Capture</dt>
                    <dd>
                      {row.landingPage.captureLabel}
                      {row.landingPage.capturedAt ? (
                        <> · <LocalTime iso={row.landingPage.capturedAt} /></>
                      ) : null}
                    </dd>
                  </div>
                </dl>

                <div className="report-signal-grid">
                  {row.landingPage.signals.map((signal) => (
                    <div className="report-signal-card" key={signal.label}>
                      <p className="f9-app-kicker">{signal.label}</p>
                      <strong>{signal.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {row.analysisFields.length > 0 ? (
              <section className="report-analysis">
                <p className="f9-app-kicker">Proof fields</p>
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
        ))}
      </section>
      {report.rows.length === 0 ? (
        <section className="f9-empty-panel">
          <h2>No client-ready proof in this report</h2>
          <p>
            Suppressed, invalidated, proof-failed, internal, canary, and scan-only events are excluded
            from proof-backed reports by default.
          </p>
        </section>
      ) : null}
    </div>
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
            <dd>Review source coverage or wait for the next proof-backed report.</dd>
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
          <dt>Proof status</dt>
          <dd>{topEvent.proofStatusLabel}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{topEvent.sourceTypeLabel}</dd>
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
  const rowLabel = `${rowCount} saved proof item${rowCount === 1 ? "" : "s"}`;
  const hasRows = rowCount > 0;

  return (
    <section className="f9-proof-packet" aria-label="Report decision summary">
      <div>
        <span className="f9-app-kicker">Decision summary</span>
        <h3>{hasRows ? "Saved proof ready for review" : "No saved proof rows yet"}</h3>
        <p className="f9-muted-copy">{report.summary}</p>
      </div>
      <dl className="proof-trail-list">
        <div>
          <dt>What changed</dt>
          <dd>{hasRows ? `${rowLabel} packaged for review.` : "No saved proof is in this report."}</dd>
        </div>
        <div>
          <dt>Why it matters</dt>
          <dd>
            {hasRows
              ? "This is a curated proof set, not a live change alert."
              : "The report is ready to fill once proof is saved."}
          </dd>
        </div>
        <div>
          <dt>Urgency</dt>
          <dd>{hasRows ? "Review before sharing" : "No action needed"}</dd>
        </div>
        <div>
          <dt>Proof status</dt>
          <dd>{hasRows ? "Saved proof collection" : "Proof unavailable"}</dd>
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
          <dd>{hasRows ? "Review the rows below, then share or export the report." : "Save proof into this collection."}</dd>
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
