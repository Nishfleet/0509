import { joinList } from "../../lib/coverage";
import { sourceKindNoun } from "../../lib/source-name";
import { SourcePill, sourcePillStatus, type SourceRow, type SourceSnapshot } from "../source-pill";
import { Section } from "./section";

export interface WatchedSource {
  kind: string;
  source: SourceRow;
  snapshot: SourceSnapshot | null;
}

const REBUILDING =
  "We're rebuilding our coverage of news mentions. Your Monday brief and ranking still come from website changes. Mentions will return as their sources come back.";

export function WhatWeWatch({ sources, now }: { sources: readonly WatchedSource[]; now?: number }) {
  const statuses = sources.map((entry) => ({
    entry,
    status: sourcePillStatus(entry.source, entry.snapshot, now),
  }));
  const shown = statuses.filter(({ status }) => status.state !== "disabled");
  const shownMentions = shown.filter(({ entry }) => entry.kind === "mentions");
  const allDegraded = shownMentions.length > 0 && shownMentions.every(({ status }) => status.state === "degraded");
  const siteDegraded = shown.some(({ entry, status }) => entry.kind === "site" && status.state === "degraded");
  const gated = allDegraded && !siteDegraded;
  const nouns = [...new Set(statuses.map(({ entry }) => sourceKindNoun(entry.kind)))];
  const lead = `We read ${nouns.length === 0 ? "public sources" : joinList(nouns)}. If a source stops answering, it shows here dimmed with the reason, so we never drop it quietly. "Last good unknown" means we haven't checked that kind of source yet. The first check happens in the next daily check.`;
  return (
    <Section id="what-we-watch" kicker="Public sources only" title="What we watch" lead={lead}>
      {gated ? (
        <p className="max-w-[42rem] text-[1.05rem] leading-[1.6] text-ink-soft">{REBUILDING}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {shown.map(({ entry }) => (
            <li key={entry.source.key}>
              <SourcePill source={entry.source} snapshot={entry.snapshot} now={now} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
