import type { BrandChangeEvent } from "~/lib/brand-page.server";

/**
 * "What changed this week" — the day-by-day play-by-play timeline. Every row
 * maps 1:1 to a real ad that entered rotation on a real first-seen date, with
 * a real capture source. Renders ONLY when there is at least one such event;
 * the caller hides the whole section otherwise (never an empty card).
 *
 * `example` renders the same shape with a single clearly-labeled sample row for
 * the cache-miss teaching state — honest, since it is marked "Example".
 */
export function BrandChangeTimeline({
  events,
  example = false,
}: {
  events: BrandChangeEvent[];
  example?: boolean;
}) {
  if (events.length === 0) return null;

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
    </div>
  );
}
