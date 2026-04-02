import type { ReportDocument } from "~/lib/report";

export function ReportView({ report }: { report: ReportDocument }) {
  return (
    <div className="report-layout">
      <section className="report-hero">
        <div>
          <p className="section-label">{report.resourceType} report</p>
          <h1>{report.title}</h1>
          <p className="muted-text">{report.subtitle}</p>
        </div>
        <div className="report-meta">
          <p className="section-label">Generated</p>
          <p>{new Date(report.generatedAt).toLocaleString("en-IN")}</p>
        </div>
      </section>

      <p className="report-summary">{report.summary}</p>

      <section className="report-stats" aria-label="Report summary">
        {report.stats.map((stat) => (
          <article className="report-stat-card" key={stat.label}>
            <p className="section-label">{stat.label}</p>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </section>

      <section className="report-list" aria-label="Report rows">
        {report.rows.map((row) => (
          <article className="report-card" key={row.id}>
            <div className="report-card-header">
              <div>
                <p className="section-label">{row.formatLabel}</p>
                <h2>{row.advertiser}</h2>
                <p className="muted-text">{row.previewHeadline}</p>
              </div>
              <div className="report-card-meta">
                <span className="badge">{row.languageLabel}</span>
                {row.event ? <span className="badge">{row.event.typeLabel}</span> : null}
              </div>
            </div>

            {row.previewImageUrl ? (
              <img
                alt={`${row.advertiser} creative preview`}
                className="report-preview"
                src={row.previewImageUrl}
              />
            ) : null}

            {row.event ? (
              <section className="report-event">
                <p className="section-label">Watch event</p>
                <h3>{row.event.title}</h3>
                <p>{row.event.summary}</p>
                <p className="muted-text">
                  {new Date(row.event.createdAt).toLocaleString("en-IN")}
                </p>
              </section>
            ) : null}

            <div className="report-columns">
              <section className="report-column">
                <p className="section-label">Ad summary</p>
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
                      <span className="badge" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                {row.note ? (
                  <div className="report-note">
                    <p className="section-label">Internal note</p>
                    <p>{row.note}</p>
                  </div>
                ) : null}
              </section>

              <section className="report-column">
                <p className="section-label">Landing page</p>
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
                      <p className="section-label">{signal.label}</p>
                      <strong>{signal.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {row.analysisFields.length > 0 ? (
              <section className="report-analysis">
                <p className="section-label">Analysis fields</p>
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
