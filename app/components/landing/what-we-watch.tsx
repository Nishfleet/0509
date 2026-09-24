import { LIVE_COVERAGE, PLAN_NOTE, WATCHED_ORIGINS } from "../../lib/coverage";
import { Pill } from "./pill";
import { eyebrow, Section } from "./section";

export function WhatWeWatch() {
  return (
    <Section
      id="what-we-watch"
      kicker="Public sources only"
      title="What we watch"
      lead={`We read ${WATCHED_ORIGINS}. A source that blocks us says so in the app. We never quietly drop it.`}
    >
      <dl className="border-line border-b">
        {LIVE_COVERAGE.map((group) => (
          <div
            key={group.kind}
            className="border-line grid gap-3 border-t py-5 sm:grid-cols-[12rem_1fr] sm:items-baseline sm:gap-6"
          >
            <dt className={`${eyebrow} text-ink-soft`}>{group.kind}</dt>
            <dd className="min-w-0">
              <ul className="flex flex-wrap gap-2">
                {group.sources.map((source) => (
                  <Pill
                    key={source.id}
                    label={source.label}
                    {...(source.plan === undefined ? {} : { note: PLAN_NOTE[source.plan] })}
                    highlight={source.instant === true}
                  />
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
