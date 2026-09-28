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
  "We're rebuilding coverage of news mentions. Briefs and standing still arrive from site changes; mentions resume as their sources come back.";

export function WhatWeWatch({
  sources,
  now,
}: {
  sources: readonly WatchedSource[];
  now?: number;
}) {
  const statuses = sources.map((entry) => ({
    entry,
    status: sourcePillStatus(entry.source, entry.snapshot, now),
  }));
  const shown = statuses.filter(({ status }) => status.state !== "disabled");
  const allDegraded = shown.length > 0 && shown.every(({ status }) => status.state === "degraded");
  const nouns = [...new Set(shown.map(({ entry }) => sourceKindNoun(entry.kind)))];
  const lead = `We read ${nouns.length === 0 ? "public sources" : joinList(nouns)}. A source that stops answering shows here dimmed, with the reason — we never quietly drop it. Last good unknown means we haven't yet checked this kind of source. The first check lands in the daily sweep.`;
  return (
    <Section id="what-we-watch" kicker="Public sources only" title="What we watch" lead={lead}>
      {allDegraded ? (
        <p className="text-ink-soft max-w-[42rem] text-[1.05rem] leading-[1.6]">{REBUILDING}</p>
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
