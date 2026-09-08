import type { BrandChangeEvent } from "~/lib/brand-page.server";
import type { AdChurnSummary } from "~/lib/digest-rerank";
import { adChurnFootnoteLine } from "~/lib/digest-rerank";

/**
 * "What changed this week" — the day-by-day play-by-play timeline. Every row
 * maps 1:1 to a real ad that entered rotation on a real first-seen date, with
 * a real capture source. Renders ONLY when there is at least one such event;
 * the caller hides the whole section otherwise (never an empty card).
 *
 * When `churn` is provided with a non-zero total, a single counted footnote
 * line is appended to the bottom of the timeline (e.g. "3 new creatives, 2
 * retired — open the wall to see them."). The footnote is the same one the
 * digest uses (#1897), so the digest and the /ads page cannot drift.
 *
 * `example` renders the same shape with a single clearly-labeled sample row for
 * the cache-miss teaching state — honest, since it is marked "Example".
 */
export function BrandChangeTimeline({
  events,
  example = false,
  churn = null,
}: {
  events: BrandChangeEvent[];
  example?: boolean;
  churn?: AdChurnSummary | null;
}) {
  // When neither an event row nor a churn footnote is available, the section
  // hides entirely. The caller is responsible for the surrounding <section> /
  // heading; this component only renders the timeline body itself.
  const churnFootnote = churn ? adChurnFootnoteLine(churn) : null;
  if (events.length === 0 && !churnFootnote) return null;

  return (
    <div className="f9-ads-timeline" data-example={example ? "true" : undefined}>
      {events.map((event) => (
        <div className="f9-ads-tl-row" key={event.id}>
          <span className={`f9-ads-tl-day${event.isToday ? " f9-ads-tl-day-today" : ""}`}>
            {event.dayLabel}
          </span>
          <span className="f9-ads-tl-what">
            <span className="f9-ads-tl-badge">{example ? "Example" : "New"}</span>
            <span className="f9-ads-tl-move">{event.move}</span>
            <span className="f9-ads-tl-why">{event.why}</span>
          </span>
          <span className="f9-ads-tl-src">{`[ ${event.source.toLowerCase()} ]`}</span>
        </div>
      ))}
      {churnFootnote ? (
        <div
          className="f9-ads-tl-row f9-ads-tl-row-churn"
          data-testid="brand-change-churn"
        >
          <span className="f9-ads-tl-day" aria-hidden="true" />
          <span className="f9-ads-tl-what f9-ads-tl-what-churn">
            <span className="f9-ads-tl-move f9-ads-tl-move-churn">{churnFootnote}</span>
          </span>
          <span className="f9-ads-tl-src" aria-hidden="true" />
        </div>
      ) : null}
    </div>
  );
}
