/**
 * Live monitoring-source rows for the /compare/* pages (issue #2188).
 *
 * Renders one row per competitor-monitoring source whose claim-table row is
 * live (`docs/customer-claim-audit-table.json`, `monitoringSource.status`),
 * with the wording taken from that row. When no source row is live the
 * block omits itself entirely — a /compare page never names a source the
 * claim table does not back. Never claims spend or impressions.
 *
 * The CTA follows the #2123 pattern: it lands on the free search preview
 * pre-filled with a tracked demo competitor, never the compared vendor's
 * own domain.
 */
import { Link } from "react-router";

import { FREE_PREVIEW_SEARCH_DOMAIN } from "~/lib/demo-brand-pages";
import { liveMonitoringSources } from "~/lib/monitoring-source-claims";

export function CompareLiveSources() {
  const sources = liveMonitoringSources();
  if (sources.length === 0) {
    return null;
  }
  return (
    <section className="ld-quiet" aria-label="More sources Five to Nine reads">
      <div className="ld-section-head">
        <span className="ld-kicker">Beyond the Meta Ad Library</span>
        <h2>Also read on every paid watch.</h2>
      </div>
      <ul className="f9-quiet-list" data-testid="compare-live-sources">
        {sources.map((source) => (
          <li
            key={source.sourceId}
            className="f9-quiet-list-item"
            data-source-id={source.sourceId}
          >
            <span className="f9-quiet-list-copy">
              <strong>{source.label}.</strong> {source.text}
            </span>
          </li>
        ))}
      </ul>
      <p className="ld-pricing-note">
        <Link to={`/search?website=${FREE_PREVIEW_SEARCH_DOMAIN}`}>
          Try the free preview on a tracked competitor
        </Link>{" "}
        — no account needed.
      </p>
    </section>
  );
}
