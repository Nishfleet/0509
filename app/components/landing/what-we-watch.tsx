import { Pill } from "./pill";
import { eyebrow, Section } from "./section";

const GROUPS = [
  { kind: "Ads", sources: [{ label: "Meta" }, { label: "Google" }, { label: "TikTok" }, { label: "LinkedIn", note: "Starter and up" }, { label: "Reddit" }] },
  {
    kind: "Site changes",
    sources: [{ label: "Homepage" }, { label: "Pricing page" }, { label: "Every page we find", note: "Starter and up" }],
  },
  { kind: "Mentions", sources: [{ label: "News" }, { label: "Hacker News" }, { label: "Reddit" }, { label: "Medium" }, { label: "YouTube" }] },
  { kind: "Hiring", sources: [{ label: "Public job boards" }] },
  {
    kind: "Your own site",
    sources: [{ label: "Every change you ship" }, { label: "Breakage alerts", note: "Starter and up", live: true }],
  },
] as const;

export function WhatWeWatch() {
  return (
    <Section
      id="what-we-watch"
      kicker="Public sources only"
      title="What we watch"
      lead="The ad libraries platforms publish, public pages, news and public posts, and public job boards. A source that blocks us says so in the app. We never quietly drop it."
    >
      <dl className="border-line border-b">
        {GROUPS.map((group) => (
          <div
            key={group.kind}
            className="border-line grid gap-3 border-t py-5 sm:grid-cols-[12rem_1fr] sm:items-baseline sm:gap-6"
          >
            <dt className={`${eyebrow} text-ink-soft`}>{group.kind}</dt>
            <dd className="min-w-0">
              <ul className="flex flex-wrap gap-2">
                {group.sources.map((source) => (
                  <Pill
                    key={source.label}
                    label={source.label}
                    {...("note" in source ? { note: source.note } : {})}
                    {...("live" in source ? { live: source.live } : {})}
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
