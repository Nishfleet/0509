import type { OfferLedgerEntry } from "~/lib/offer-timeline";

function formLabel(value: boolean | null): string {
  if (value === true) {
    return "Form present";
  }
  if (value === false) {
    return "No form";
  }
  return "Form unknown";
}

function sourceHostOf(canonicalUrl: string): string | null {
  try {
    return new URL(canonicalUrl).host;
  } catch {
    return null;
  }
}

function ChangeRow({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span className="f9-timeline-before">{before}</span>
        <span aria-hidden="true" className="f9-timeline-arrow">
          →
        </span>
        <span className="f9-timeline-after">{after}</span>
      </dd>
    </>
  );
}

export function OfferTimelineLedger({ entries }: { entries: OfferLedgerEntry[] }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <ol className="f9-timeline-ledger">
      {entries.map((entry) => {
        const sourceHost = sourceHostOf(entry.canonicalUrl);
        const hasReceipts = Boolean(
          entry.screenshotHref || entry.pageTextHref || sourceHost,
        );
        return (
          <li
            className="f9-timeline-entry"
            key={entry.id}
            id={`state-${entry.id}`}
          >
            <time className="f9-timeline-date" dateTime={entry.capturedAt.slice(0, 10)}>
              {entry.dateLabel}
            </time>
            <div className="f9-timeline-body">
              <p className="f9-timeline-headline">{entry.headline}</p>
              <p className="f9-timeline-fields">
                {entry.ctaText ? <span>{`CTA: ${entry.ctaText}`}</span> : null}
                {entry.priceText ? <span>{`Price: ${entry.priceText}`}</span> : null}
                <span>{formLabel(entry.formPresent)}</span>
              </p>
              {entry.transition ? (
                <dl className="f9-timeline-diff">
                  {entry.transition.headline ? (
                    <ChangeRow
                      label="Headline"
                      before={entry.transition.headline.before}
                      after={entry.transition.headline.after}
                    />
                  ) : null}
                  {entry.transition.ctaText ? (
                    <ChangeRow
                      label="CTA"
                      before={entry.transition.ctaText.before ?? "—"}
                      after={entry.transition.ctaText.after ?? "—"}
                    />
                  ) : null}
                  {entry.transition.priceText ? (
                    <ChangeRow
                      label="Price"
                      before={entry.transition.priceText.before ?? "—"}
                      after={entry.transition.priceText.after ?? "—"}
                    />
                  ) : null}
                  {entry.transition.formPresent ? (
                    <ChangeRow
                      label="Form"
                      before={formLabel(entry.transition.formPresent.before)}
                      after={formLabel(entry.transition.formPresent.after)}
                    />
                  ) : null}
                </dl>
              ) : (
                <p className="f9-timeline-initial">First offer on record.</p>
              )}
              {hasReceipts ? (
                <p className="f9-timeline-receipts">
                  {entry.screenshotHref ? (
                    <a href={entry.screenshotHref} rel="noreferrer">
                      {`Screenshot · ${entry.dateLabel}`}
                    </a>
                  ) : null}
                  {entry.pageTextHref ? (
                    <a href={entry.pageTextHref} rel="noreferrer">
                      {`Page text · ${entry.dateLabel}`}
                    </a>
                  ) : null}
                  {sourceHost ? (
                    <a
                      href={entry.canonicalUrl}
                      rel="nofollow noreferrer"
                      className="f9-timeline-source"
                    >
                      {`Source: ${sourceHost}`}
                    </a>
                  ) : null}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
