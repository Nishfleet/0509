import type { ReactElement } from "react";
import { Link } from "react-router";

import { dayMonthLabel } from "./competitor-header";
import { EmptyState } from "./empty-state";
import { SourcePill } from "./source-pill";
import type { SourceRow, SourceSnapshot } from "../lib/source-pill-status";
import { SITE_SWEEP_UTC_LABEL } from "../lib/cadence";

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
  hiring: ["new job opening", "new job openings"],
  ad: ["ad", "ads"],
  mention: ["mention", "mentions"],
  content: ["new post", "new posts"],
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
  sweepClock?: string;
  unreadable?: boolean;
  notFound?: boolean;
  awaiting?: boolean;
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
    return <EmptyState sentence="No ranking yet. It arrives with your first weekly brief." />;
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
              <Link to={`/app/competitors/${peer.entityId}`} prefetch="intent" viewTransition>
                {peer.name}
              </Link>
            )}
            {peer.state === "off" ? <span className="sr-only"> (paused)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function labelledFacts(facts: readonly RailFact[]): string[] {
  return facts.map((fact) => factLabel(fact.kind, fact.count)).filter((label) => label !== null);
}

function Facts({ facts }: { facts: readonly RailFact[] }): ReactElement {
  const labelled = labelledFacts(facts);
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

function homepageLine(state: {
  lastChecked: string | null;
  sweepClock: string;
  unreadable: boolean;
  notFound: boolean;
}): string {
  if (state.notFound) return "We couldn't find the homepage. Check the address. We try again every night.";
  if (state.unreadable) return "We couldn't read the homepage. We try again every night.";
  return state.lastChecked === null
    ? `Homepage, read every night. First read tonight ${state.sweepClock}.`
    : `Homepage, read every night. Last read ${state.lastChecked}.`;
}

function Sources({
  sources,
  lastChecked,
  now,
  sweepClock = SITE_SWEEP_UTC_LABEL,
  unreadable = false,
  notFound = false,
}: {
  sources: readonly RailSource[];
  lastChecked: string | null;
  now: number;
  sweepClock?: string;
  unreadable?: boolean;
  notFound?: boolean;
}): ReactElement {
  if (sources.length === 0) {
    return (
      <>
        <p className="font-display text-[1.02rem]">Website</p>
        <p className="text-meta text-ink-soft">{homepageLine({ lastChecked, sweepClock, unreadable, notFound })}</p>
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
    return <EmptyState sentence="We check this every week. The first answer arrives after a week of watching." />;
  }
  const checkedLabel = dayMonthLabel(verdict.decidedAt);
  return (
    <>
      <p className="font-display text-[1.02rem]">{words}</p>
      <p className="text-meta text-ink-soft">
        {checkedLabel === null ? "Checked recently" : `Checked ${checkedLabel}`}
      </p>
    </>
  );
}

function RailSection({
  name,
  labelId,
  title,
  show = true,
  children,
}: {
  name: string;
  labelId: string;
  title: string;
  show?: boolean;
  children: ReactElement;
}): ReactElement | null {
  if (!show) return null;
  return (
    <section data-section={name} aria-labelledby={labelId} className="min-w-0">
      <h2 id={labelId} className={HEADING}>
        {title}
      </h2>
      {children}
    </section>
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
  sweepClock = SITE_SWEEP_UTC_LABEL,
  unreadable = false,
  notFound = false,
  awaiting = false,
}: CompetitorRailProps): ReactElement {
  const hasVerdict = verdict !== null && verdictWords(verdict.choice) !== null;
  return (
    <aside data-slot="competitor-rail" className="flex min-w-0 flex-col gap-10">
      <RailSection name="peers" labelId="competitor-peers" title="How you rank" show={!awaiting || peers.length > 0}>
        <Peers entityId={entityId} peers={peers} />
      </RailSection>
      <RailSection
        name="facts"
        labelId="competitor-facts"
        title="Last 30 days"
        show={!awaiting || labelledFacts(facts).length > 0}
      >
        <Facts facts={facts} />
      </RailSection>
      <RailSection name="sources" labelId="competitor-sources" title="What we watch here">
        <Sources
          sources={sources}
          lastChecked={lastChecked}
          now={now}
          sweepClock={sweepClock}
          unreadable={unreadable}
          notFound={notFound}
        />
      </RailSection>
      <RailSection
        name="still-competitor"
        labelId="competitor-still"
        title="Still a competitor?"
        show={!awaiting || hasVerdict}
      >
        <StillCompetitor verdict={verdict} />
      </RailSection>
    </aside>
  );
}
