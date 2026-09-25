import type { ReactElement } from "react";
import { Link } from "react-router";

import { DAY_MONTH } from "./competitor-header";
import { EmptyState } from "./empty-state";
import { SourcePill } from "./source-pill";
import type { SourceRow, SourceSnapshot } from "./source-pill";

const HEADING = "mb-3 font-mono text-eyebrow text-ink-soft uppercase";
const ROW = "min-w-0";
const OFF = "opacity-60";

const VERDICT_WORDS: Record<string, string> = {
  active: "Yes. Still trading and selling to the same kind of customer as you.",
  acquired: "Bought by another company.",
  shut_down: "Closed or stopped trading.",
  pivoted: "Still trading, but now sells something different.",
  dormant: "Still there, but gone quiet: no launches, posts or changes.",
};

const FACT_NOUNS: Record<string, [string, string]> = {
  change: ["site change", "site changes"],
  hiring: ["new role", "new roles"],
  ad: ["ad", "ads"],
  mention: ["mention", "mentions"],
};

export interface RailPeer {
  entityId: string;
  name: string;
  role: "self" | "competitor";
  state: string;
  rank: number;
}

export interface RailFact {
  kind: string;
  count: number;
}

export interface RailSource {
  source: SourceRow;
  snapshot: SourceSnapshot | null;
}

export interface RailVerdict {
  choice: string;
  decidedAt: string;
}

export interface CompetitorRailProps {
  entityId: string;
  peers: readonly RailPeer[];
  facts: readonly RailFact[];
  sources: readonly RailSource[];
  verdict: RailVerdict | null;
  lastChecked: string | null;
  now: number;
}

export function verdictWords(choice: string): string | null {
  return VERDICT_WORDS[choice] ?? null;
}

export function factLabel(kind: string, count: number): string | null {
  const nouns = FACT_NOUNS[kind];
  if (nouns === undefined) return null;
  return `${String(count)} ${count === 1 ? nouns[0] : nouns[1]}`;
}

function Peers({ entityId, peers }: { entityId: string; peers: readonly RailPeer[] }): ReactElement {
  if (peers.length === 0) {
    return <EmptyState sentence="No standing yet. It comes with your first weekly brief." />;
  }
  return (
    <ol className={ROW}>
      {peers.map((peer) => {
        const self = peer.role === "self";
        const current = peer.entityId === entityId;
        return (
          <li
            key={peer.entityId}
            data-entity-id={peer.entityId}
            data-state={peer.state}
            className={peer.state === "off" ? `${ROW} ${OFF}` : ROW}
          >
            <span className="font-mono text-meta text-ink-soft">#{peer.rank}</span>{" "}
            {self ? (
              <span>You</span>
            ) : current ? (
              <span aria-current="page" className="font-bold">
                {peer.name}
              </span>
            ) : (
              <Link to={`/app/competitors/${peer.entityId}`} prefetch="intent">
                {peer.name}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Facts({ facts }: { facts: readonly RailFact[] }): ReactElement {
  const labelled = facts
    .map((fact) => factLabel(fact.kind, fact.count))
    .filter((label) => label !== null);
  if (labelled.length === 0) {
    return <EmptyState sentence="Nothing new from them in the last 30 days." />;
  }
  return (
    <ul className={ROW}>
      {labelled.map((label) => (
        <li key={label}>{label}</li>
      ))}
    </ul>
  );
}

export function Sources({
  sources,
  lastChecked,
  now,
}: {
  sources: readonly RailSource[];
  lastChecked: string | null;
  now: number;
}): ReactElement {
  if (sources.length === 0) {
    return (
      <>
        <p className="font-display text-[1.02rem]">Website</p>
        <p className="text-meta text-ink-soft">
          {lastChecked === null
            ? "Homepage, read every night. First read tonight at 02:00 UTC."
            : `Homepage, read every night. Last read ${lastChecked}.`}
        </p>
      </>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {sources.map((entry) => (
        <li key={entry.source.key} className={ROW}>
          <SourcePill source={entry.source} snapshot={entry.snapshot} now={now} />
        </li>
      ))}
    </ul>
  );
}

function StillCompetitor({ verdict }: { verdict: RailVerdict | null }): ReactElement {
  const words = verdict === null ? null : verdictWords(verdict.choice);
  if (verdict === null || words === null) {
    return (
      <EmptyState sentence="We ask this every week. The first answer lands after a week of watching." />
    );
  }
  return (
    <>
      <p className="font-display text-[1.02rem]">{words}</p>
      <p className="text-meta text-ink-soft">
        Checked {DAY_MONTH.format(new Date(verdict.decidedAt))}
      </p>
    </>
  );
}

export function CompetitorRail({
  entityId,
  peers,
  facts,
  sources,
  verdict,
  lastChecked,
  now,
}: CompetitorRailProps): ReactElement {
  return (
    <aside data-slot="competitor-rail" className="flex min-w-0 flex-col gap-10">
      <section data-section="peers" aria-labelledby="competitor-peers" className="min-w-0">
        <h2 id="competitor-peers" className={HEADING}>
          Peers
        </h2>
        <Peers entityId={entityId} peers={peers} />
      </section>
      <section data-section="facts" aria-labelledby="competitor-facts" className="min-w-0">
        <h2 id="competitor-facts" className={HEADING}>
          Thirty days
        </h2>
        <Facts facts={facts} />
      </section>
      <section data-section="sources" aria-labelledby="competitor-sources" className="min-w-0">
        <h2 id="competitor-sources" className={HEADING}>
          Sources on this brand
        </h2>
        <Sources sources={sources} lastChecked={lastChecked} now={now} />
      </section>
      <section data-section="still-competitor" aria-labelledby="competitor-still" className="min-w-0">
        <h2 id="competitor-still" className={HEADING}>
          Still a competitor?
        </h2>
        <StillCompetitor verdict={verdict} />
      </section>
    </aside>
  );
}
