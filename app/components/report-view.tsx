import type { ReportDocument } from "~/lib/report";
import { InsightDepthPanel } from "~/components/insight-depth-panel";
import { safeInsightDepthSummary } from "~/lib/insight-depth";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import { LocalTime } from "~/components/local-time";

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

      <section className="report-stats" aria-label="Report summary">
        {report.stats.map((stat) => (
          <article className="report-stat-card" key={stat.label}>
            <p className="f9-app-kicker">{stat.label}</p>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </section>

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
                    <dd>{row.landingPage.url}</dd>
                  </div>
                  <div className="report-field">
                    <dt>Headline</dt>
                    <dd>{row.landingPage.headline}</dd>
                  </div>
                  <div className="report-field">
                    <dt>Capture</dt>
                    <dd>{row.landingPage.captureLabel}</dd>
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
    </div>
  );
}
