import { FourWeekLine } from "../components/four-week-line";
import { ReadThisFirst } from "../components/read-this-first";
import { StandingHeadline } from "../components/standing-headline";
import type { HomePanel } from "../lib/standing-present";

export function StandingHome({ home }: { home: HomePanel }) {
  return (
    <div className="max-w-full">
      {home.message ? <p>{home.message}</p> : null}
      {home.arrival ? <p>Next brief {home.arrival}</p> : null}
      <StandingHeadline
        brands={home.brands}
        why={home.why}
        whyIsJev={home.whyIsJev}
        updatedSinceBrief={home.updatedSinceBrief}
        paused={home.paused}
      />
      <FourWeekLine weeks={home.weeks} series={home.series} />
      <ReadThisFirst items={home.readFirst} />
      {home.freshness.length > 0 ? (
        <section aria-label="Sources">
          <h2>Sources</h2>
          <ul>
            {home.freshness.map((source) => (
              <li key={source.name}>{source.line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
