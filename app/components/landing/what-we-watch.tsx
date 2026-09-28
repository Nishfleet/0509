import { joinList } from "../../lib/coverage";
import { sourceKindNoun } from "../../lib/source-name";
import { SourcePill, type SourceRow, type SourceSnapshot } from "../source-pill";
import { Section } from "./section";

export interface WatchedSource {
  kind: string;
  source: SourceRow;
  snapshot: SourceSnapshot | null;
}

export function WhatWeWatch({
  sources,
  now,
}: {
  sources: readonly WatchedSource[];
  now?: number;
}) {
  const nouns = [...new Set(sources.map((entry) => sourceKindNoun(entry.kind)))];
  const lead = `We read ${nouns.length === 0 ? "public sources" : joinList(nouns)}. A source that stops answering shows here dimmed, with the reason — we never quietly drop it.`;
  return (
    <Section id="what-we-watch" kicker="Public sources only" title="What we watch" lead={lead}>
      <ul className="flex flex-wrap gap-2">
        {sources.map((entry) => (
          <li key={entry.source.key}>
            <SourcePill source={entry.source} snapshot={entry.snapshot} now={now} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
