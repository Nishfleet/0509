/**
 * The one archive renderer (issue #2173). The public `/timeline/:domain`
 * page, the signed-in competitor detail's Archive tab, and the frozen share
 * snapshot all render the same `DomainArchive` through this component, so a
 * row reads identically everywhere: when it was captured, how, what changed,
 * the #1387 criticality band, and the before/after receipts when stored.
 * Capture gaps render as gaps — never smoothed.
 */

import { Pill } from "~/components/pill";
import type {
  ArchiveEntry,
  ArchiveGap,
  DomainArchive,
} from "~/lib/archive";

function captureMethodLabel(method: string | null): string | null {
  if (!method) return null;
  const words = method.replaceAll("_", " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url.length > 60 ? `${url.slice(0, 57)}…` : url;
  }
}

function ArchiveMonthStrip({ archive }: { archive: DomainArchive }) {
  const summary = archive.monthSummary;
  if (!summary) return null;
  const bandBits = (
    [
      ["critical", summary.byBand.critical],
      ["material", summary.byBand.material],
      ["routine", summary.byBand.routine],
      ["cosmetic", summary.byBand.cosmetic],
    ] as const
  ).filter(([, count]) => count > 0);
  return (
    <section aria-label="What changed this month" className="f9-archive-month">
      <p className="f9-wk-kick">{`What changed in ${summary.monthLabel}`}</p>
      <p className="f9-archive-month-line">
        {summary.changeCount === 0
          ? "No changes captured this month."
          : `${summary.changeCount} ${summary.changeCount === 1 ? "change" : "changes"} captured`}
        {summary.byField.length > 0
          ? ` · ${summary.byField
              .map((row) => `${row.fieldLabel} ×${row.count}`)
              .join(" · ")}`
          : ""}
      </p>
      {bandBits.length > 0 ? (
        <p className="f9-archive-month-bands">
          {bandBits.map(([band, count]) => (
            <Pill key={band} state={band} variant="status">
              {`${band} ×${count}`}
            </Pill>
          ))}
        </p>
      ) : null}
    </section>
  );
}

function GapRow({ gap }: { gap: ArchiveGap }) {
  return (
    <li className="f9-archive-gap" data-gap-days={gap.days}>
      <p>
        {`No captures stored between ${gap.from.slice(0, 10)} and ${gap.to.slice(0, 10)} (${gap.days} days). The record resumes when the next capture lands.`}
      </p>
    </li>
  );
}

function EntryRow({ entry }: { entry: ArchiveEntry }) {
  const method = captureMethodLabel(entry.captureMethod);
  const hasDiffText = Boolean(entry.beforeValue || entry.afterValue);
  return (
    <li
      className={`f9-archive-entry is-${entry.kind}`}
      data-criticality-band={entry.criticality?.band ?? undefined}
      data-entry-source={entry.source}
      id={`archive-${entry.id}`}
    >
      <time className="f9-timeline-date" dateTime={entry.capturedAt}>
        {entry.dateLabel}
      </time>
      <div className="f9-timeline-body">
        <p className="f9-archive-entry-head">
          <span className="f9-archive-field">{entry.fieldLabel}</span>
          {entry.criticality ? (
            <Pill
              state={entry.criticality.band}
              title={`Criticality ${entry.criticality.score}/100`}
              variant="status"
            >
              {entry.criticality.band}
            </Pill>
          ) : null}
          {entry.eventStatus ? (
            <Pill variant="status">{entry.eventStatus.replaceAll("_", " ")}</Pill>
          ) : null}
        </p>
        {entry.changeMark ? (
          <p className="f9-archive-mark">
            <span className="f9-timeline-before">{entry.changeMark.from}</span>
            <span aria-hidden="true" className="f9-timeline-arrow">
              →
            </span>
            <span className="f9-timeline-after">{entry.changeMark.to}</span>
          </p>
        ) : hasDiffText ? (
          <p className="f9-archive-diff-text">
            {entry.beforeValue ? <span className="f9-timeline-before">{entry.beforeValue}</span> : null}
            {entry.beforeValue && entry.afterValue ? (
              <span aria-hidden="true" className="f9-timeline-arrow">
                →
              </span>
            ) : null}
            {entry.afterValue ? <span className="f9-timeline-after">{entry.afterValue}</span> : null}
          </p>
        ) : null}
        <p className="f9-archive-receipts">
          {entry.beforeScreenshotHref ? (
            <a href={entry.beforeScreenshotHref} rel="noreferrer">
              Before screenshot
            </a>
          ) : null}
          {entry.afterScreenshotHref ? (
            <a href={entry.afterScreenshotHref} rel="noreferrer">
              {entry.kind === "change" ? "After screenshot" : "Screenshot"}
            </a>
          ) : null}
          {entry.pageTextHref ? (
            <a href={entry.pageTextHref} rel="noreferrer">
              Page text
            </a>
          ) : null}
          {entry.sourceUrl ? (
            <a className="f9-timeline-source" href={entry.sourceUrl} rel="nofollow noreferrer">
              {`Source: ${shortUrl(entry.sourceUrl)}`}
            </a>
          ) : null}
        </p>
        <p className="f9-archive-how">
          {`Captured ${entry.dateLabel}`}
          {method ? ` · ${method}` : ""}
        </p>
        {entry.evidenceNote ? (
          <p className="f9-archive-note">{entry.evidenceNote}</p>
        ) : null}
      </div>
    </li>
  );
}

/** Entries (newest first) with capture gaps interleaved by time. */
function ArchiveRecord({ archive }: { archive: DomainArchive }) {
  const items: Array<
    | { sortKey: string; type: "entry"; entry: ArchiveEntry }
    | { sortKey: string; type: "gap"; gap: ArchiveGap }
  > = [
    ...archive.entries.map((entry) => ({
      sortKey: entry.capturedAt,
      type: "entry" as const,
      entry,
    })),
    ...archive.gaps.map((gap) => ({
      sortKey: gap.to,
      type: "gap" as const,
      gap,
    })),
  ].sort((left, right) => right.sortKey.localeCompare(left.sortKey));

  if (items.length === 0) {
    return (
      <p className="f9-timeline-empty">
        No captures stored yet. Once monitoring captures this competitor, the dated record lands
        here — and gaps in capture will show as gaps.
      </p>
    );
  }

  return (
    <ol className="f9-timeline-ledger f9-archive-ledger">
      {items.map((item) =>
        item.type === "gap" ? (
          <GapRow gap={item.gap} key={`gap-${item.gap.from}-${item.gap.to}`} />
        ) : (
          <EntryRow entry={item.entry} key={item.entry.id} />
        ),
      )}
    </ol>
  );
}

function ArchiveTenure({ archive }: { archive: DomainArchive }) {
  if (archive.adTenure.length === 0) return null;
  return (
    <section aria-label="Tracked ads" className="f9-archive-tenure">
      <p className="f9-wk-kick">Tracked ads</p>
      <ul className="f9-archive-tenure-list">
        {archive.adTenure.map((ad) => (
          <li key={ad.id}>
            <span className="f9-archive-tenure-label">{ad.label}</span>
            <span className="f9-archive-tenure-dates">
              {ad.firstSeenLabel ? `First seen ${ad.firstSeenLabel}` : "First seen not recorded"}
              {ad.lastSeenLabel ? ` · last seen ${ad.lastSeenLabel}` : ""}
              {ad.runningDays !== null
                ? ` · ${ad.isActive ? "running" : "ran"} ${ad.runningDays} ${ad.runningDays === 1 ? "day" : "days"}`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArchiveOfferHistory({ archive }: { archive: DomainArchive }) {
  if (archive.offerHistory.length === 0) return null;
  return (
    <section aria-label="Offer history" className="f9-archive-offers">
      <p className="f9-wk-kick">Offer history</p>
      {archive.offerHistory.map((series) => (
        <div className="f9-archive-offer-series" key={series.canonicalUrl}>
          <p className="f9-archive-offer-url">{shortUrl(series.canonicalUrl)}</p>
          <ol>
            {series.points.map((point) => (
              <li key={`${series.canonicalUrl}-${point.capturedAt}`}>
                <time dateTime={point.capturedAt}>{point.dateLabel}</time>
                {" — "}
                {point.headline}
                {point.ctaText ? ` · CTA: ${point.ctaText}` : ""}
                {point.priceText ? ` · ${point.priceText}` : ""}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

export function ArchiveLedger({
  archive,
  headingId = "archive-ledger-title",
}: {
  archive: DomainArchive;
  headingId?: string;
}) {
  return (
    <div className="f9-archive" data-archive-subject={archive.subject}>
      <ArchiveMonthStrip archive={archive} />
      <section aria-labelledby={headingId} className="f9-archive-record">
        <h2 className="f9-timeline-section-title" id={headingId}>
          The record
        </h2>
        <ArchiveRecord archive={archive} />
      </section>
      <ArchiveOfferHistory archive={archive} />
      <ArchiveTenure archive={archive} />
    </div>
  );
}
