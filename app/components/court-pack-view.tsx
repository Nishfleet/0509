/**
 * Court Pack view — read-only, print-ready HTML renderer.
 *
 * Renders the already-approved `ReportDocument` content: numbered evidence
 * plates with the durable section/row/proof labels and trails, approval
 * context, exclusions, and optional validated workspace co-branding. No
 * forms, no mutations, no PDF/email/schedule/download affordances. The only
 * links rendered are report-data-sanctioned source URLs.
 */

import type {
  CourtPack,
  CourtPackPlate,
  CourtPackReportSection,
} from "~/lib/court-pack";
import type { ReportField, ReportRow } from "~/lib/report";

export function CourtPackView({ pack }: { pack: CourtPack }) {
  return (
    <section
      aria-label="Agency Court Pack"
      className="court-pack"
      data-testid="court-pack"
    >
      <CourtPackHeader pack={pack} />
      {pack.hasNothingToPack ? <CourtPackEmptyState /> : null}
      {pack.plates.map((plate) => {
        const section = pack.sections.find(
          (candidate) => candidate.reportId === plate.reportId,
        );
        return section ? (
          <CourtPackPlateView
            key={plate.reportId}
            plate={plate}
            section={section}
          />
        ) : null;
      })}
      {pack.excluded.length > 0 ? (
        <CourtPackExclusions exclusions={pack.excluded} />
      ) : null}
      <footer className="court-pack-footer">
        Five to Nine · Read-only HTML for browser printing
      </footer>
    </section>
  );
}

function CourtPackHeader({ pack }: { pack: CourtPack }) {
  return (
    <header className="court-pack-header">
      <p className="court-pack-kicker">Agency Court Pack</p>
      <h2>{pack.roomName}</h2>
      {pack.clientLabel ? <p>{pack.clientLabel}</p> : null}
      {pack.branding?.brandLogo ? (
        <img
          alt={pack.preparedBy ?? "Workspace logo"}
          className="court-pack-brand-logo"
          src={pack.branding.brandLogo}
        />
      ) : null}
      {pack.preparedBy ? (
        <p>Prepared by {pack.preparedBy}</p>
      ) : null}
    </header>
  );
}

function CourtPackEmptyState() {
  return (
    <div className="court-pack-empty" data-testid="court-pack-empty" role="status">
      <h3>No approved reports yet</h3>
      <p>
        Review and approve current report evidence to prepare this Court Pack.
      </p>
    </div>
  );
}

function CourtPackExclusions({
  exclusions,
}: {
  exclusions: CourtPack["excluded"];
}) {
  return (
    <section
      aria-labelledby="court-pack-exclusions"
      className="court-pack-exclusions"
      data-testid="court-pack-exclusions"
    >
      <h3 id="court-pack-exclusions">Excluded from verified evidence</h3>
      <ul>
        {exclusions.map((item) => (
          <li key={`${item.reportId}-${item.reasonCode}`}>
            {item.resourceLabel ?? item.reportId}: {item.reason} (
            {item.reasonCode})
          </li>
        ))}
      </ul>
    </section>
  );
}

function CourtPackPlateView({
  plate,
  section,
}: {
  plate: CourtPackPlate;
  section: CourtPackReportSection;
}) {
  return (
    <article
      className="court-pack-plate"
      data-testid={`court-pack-plate-${plate.plateNumber}`}
    >
      <h3>
        Evidence plate {plate.plateNumber}: {plate.title}
      </h3>
      {section.subtitle ? <p className="court-pack-plate-subtitle">{section.subtitle}</p> : null}
      {section.summary ? <p className="court-pack-plate-summary">{section.summary}</p> : null}
      <p className="court-pack-plate-approval">
        Approved {section.reviewedAt} · expires {section.approvalExpiresAt}
      </p>
      <CourtPackStats section={section} />
      <CourtPackCoverageSection section={section} />
      <ol className="court-pack-rows">
        {section.report.rows.map((row) => (
          <CourtPackRowView key={row.id} row={row} />
        ))}
      </ol>
    </article>
  );
}

function CourtPackStats({ section }: { section: CourtPackReportSection }) {
  if (section.report.stats.length === 0) {
    return null;
  }
  return (
    <dl className="court-pack-stats">
      {section.report.stats.map((stat) => (
        <div key={stat.label}>
          <dt>{stat.label}</dt>
          <dd>{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CourtPackCoverageSection({
  section,
}: {
  section: CourtPackReportSection;
}) {
  const coverage = section.report.sourceCoverage;
  if (!coverage) {
    return null;
  }
  return (
    <dl className="court-pack-coverage">
      <div>
        <dt>Source coverage</dt>
        <dd>
          {coverage.included} of {coverage.totalInput} included ·{" "}
          {coverage.excluded} excluded
        </dd>
      </div>
      {coverage.proofMix.verifiedProof > 0 ? (
        <div>
          <dt>Verified proof</dt>
          <dd>{coverage.proofMix.verifiedProof}</dd>
        </div>
      ) : null}
      {coverage.proofMix.scanSpotted > 0 ? (
        <div>
          <dt>Scan spotted</dt>
          <dd>{coverage.proofMix.scanSpotted}</dd>
        </div>
      ) : null}
      {coverage.proofMix.needsReview > 0 ? (
        <div>
          <dt>Needs review</dt>
          <dd>{coverage.proofMix.needsReview}</dd>
        </div>
      ) : null}
      {coverage.proofMix.proofPending > 0 ? (
        <div>
          <dt>Proof pending</dt>
          <dd>{coverage.proofMix.proofPending}</dd>
        </div>
      ) : null}
      {coverage.proofMix.proofFailed > 0 ? (
        <div>
          <dt>Proof failed</dt>
          <dd>{coverage.proofMix.proofFailed}</dd>
        </div>
      ) : null}
      {coverage.note ? <p className="court-pack-coverage-note">{coverage.note}</p> : null}
    </dl>
  );
}

function CourtPackRowView({ row }: { row: ReportRow }) {
  return (
    <li className="court-pack-row">
      {row.advertiser ? <h4>{row.advertiser}</h4> : null}
      {row.previewHeadline ? <p>{row.previewHeadline}</p> : null}
      {row.offer ? <p>Offer: {row.offer}</p> : null}
      {row.cta ? <p>CTA: {row.cta}</p> : null}
      <p>
        {row.formatLabel}
        {row.languageLabel ? ` · ${row.languageLabel}` : ""}
      </p>
      {row.creativeText ? <p className="court-pack-row-creative">{row.creativeText}</p> : null}
      <CourtPackLandingPage row={row} />
      {row.analysisFields.length > 0 ? (
        <CourtPackAnalysisFields fields={row.analysisFields} />
      ) : null}
      {row.event ? <CourtPackEventTrail row={row} /> : null}
    </li>
  );
}

function CourtPackLandingPage({ row }: { row: ReportRow }) {
  const landingPage = row.landingPage;
  if (
    !landingPage.url &&
    !landingPage.headline &&
    !landingPage.captureLabel &&
    !landingPage.capturedAt
  ) {
    return null;
  }
  return (
    <dl className="court-pack-landing">
      {landingPage.url ? (
        <div>
          <dt>Landing page</dt>
          <dd>{landingPage.url}</dd>
        </div>
      ) : null}
      {landingPage.headline ? (
        <div>
          <dt>Headline</dt>
          <dd>{landingPage.headline}</dd>
        </div>
      ) : null}
      {landingPage.captureLabel ? (
        <div>
          <dt>Capture</dt>
          <dd>{landingPage.captureLabel}</dd>
        </div>
      ) : null}
      {landingPage.capturedAt ? (
        <div>
          <dt>Captured at</dt>
          <dd>{landingPage.capturedAt}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function CourtPackAnalysisFields({ fields }: { fields: ReportField[] }) {
  return (
    <dl className="court-pack-analysis">
      {fields.map((field) => (
        <div key={field.label}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CourtPackEventTrail({ row }: { row: ReportRow }) {
  const event = row.event;
  if (!event) {
    return null;
  }
  return (
    <dl className="court-pack-event" data-testid="court-pack-event-trail">
      <div>
        <dt>Event</dt>
        <dd>
          {event.typeLabel}: {event.title}
        </dd>
      </div>
      {event.summary ? (
        <div>
          <dt>Summary</dt>
          <dd>{event.summary}</dd>
        </div>
      ) : null}
      {event.createdAt ? (
        <div>
          <dt>Observed at</dt>
          <dd>{event.createdAt}</dd>
        </div>
      ) : null}
      {event.priorityBand ? (
        <div>
          <dt>Priority</dt>
          <dd>{event.priorityBand}</dd>
        </div>
      ) : null}
      {event.recommendedAction ? (
        <div>
          <dt>Recommended action</dt>
          <dd>{event.recommendedAction}</dd>
        </div>
      ) : null}
      {event.proofStatusLabel ? (
        <div>
          <dt>Proof status</dt>
          <dd>{event.proofStatusLabel}</dd>
        </div>
      ) : null}
      {event.sourceTypeLabel ? (
        <div>
          <dt>Source type</dt>
          <dd>{event.sourceTypeLabel}</dd>
        </div>
      ) : null}
      {event.proofTrail ? (
        <div>
          <dt>Proof trail</dt>
          <dd>{event.proofTrail}</dd>
        </div>
      ) : null}
      {event.sourceUrl ? (
        <div>
          <dt>Source</dt>
          <dd>
            <a href={event.sourceUrl} rel="noreferrer" target="_blank">
              {event.sourceUrl}
            </a>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
