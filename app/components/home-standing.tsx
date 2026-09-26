import type { ReactElement } from "react";
import { Form } from "react-router";

import { BrandChipRow } from "./brand-chip";
import { EmptyState, fewerThanTwoOnBrands } from "./empty-state";
import { FirstFilePanel } from "./first-file-panel";
import { FourWeekLine } from "./four-week-line";
import { HowRankedSheet } from "./how-ranked-sheet";
import { RankedRow } from "./ranked-row";
import { ReadThisFirst } from "./read-this-first";
import { RowSheet } from "./row-sheet";
import type { HomeRow, HomeView, WeekEvidence } from "../lib/home-standing";
import type { HowRanked } from "../lib/how-ranked";
import { cn } from "../lib/utils";

const EYEBROW = "font-mono text-eyebrow text-ink-soft uppercase";
const GREETING = "font-display text-display-2 mt-2 font-extrabold uppercase";
const MARKER = "bg-green text-on-green px-[0.14em] [box-decoration-break:clone]";

export function HomeStanding({
  view,
  howRanked,
  onSwitch,
  openId = null,
  evidence = null,
}: {
  view: HomeView;
  howRanked?: HowRanked | null;
  onSwitch?: (entityId: string, checked: boolean) => void;
  openId?: string | null;
  evidence?: readonly WeekEvidence[] | null;
}): ReactElement {
  return (
    <section data-home="standing" className="min-w-0 break-words">
      <p className={EYEBROW}>{view.eyebrow}</p>
      {greeting(view)}
      <div className="mt-4">{chips(view)}</div>
      {body(view, howRanked, onSwitch, openId, evidence)}
    </section>
  );
}

function chips(view: HomeView): ReactElement | null {
  if (view.standing.kind !== "gathering") return null;
  return <BrandChipRow brands={view.chips} />;
}

function greeting(view: HomeView): ReactElement {
  const { standing } = view;
  if (standing.kind !== "ranked") {
    return <h1 className={GREETING}>{view.greeting}.</h1>;
  }
  return (
    <h1 className={GREETING}>
      {view.greeting}. You're <span className={MARKER}>#{standing.rank}</span> of {standing.total} this week.
    </h1>
  );
}

function body(
  view: HomeView,
  howRanked: HowRanked | null | undefined,
  onSwitch: ((entityId: string, checked: boolean) => void) | undefined,
  openId: string | null,
  evidence: readonly WeekEvidence[] | null,
): ReactElement {
  const { standing } = view;
  if (standing.kind === "add-competitor") {
    return (
      <div className="mt-6">
        <Form method="post" action="/app/competitors">
          <input type="hidden" name="intent" value="add" />
          <EmptyState {...fewerThanTwoOnBrands()} />
        </Form>
      </div>
    );
  }
  if (standing.kind === "gathering") {
    return (
      <div className="mt-6">
        <FirstFilePanel brands={standing.brands} firstSweepAt={standing.firstSweepAt} briefAt={standing.briefAt} />
      </div>
    );
  }
  return (
    <>
      <p className="mt-3 max-w-prose leading-[1.55]">{standing.whyLine}</p>
      {howRanked ? (
        <div className="mt-2">
          <HowRankedSheet howRanked={howRanked} />
        </div>
      ) : null}
      <ReadThisFirst marks={standing.readThisFirst} />
      <h2 className={cn(EYEBROW, "border-line mt-8 border-t pt-4")}>Four weeks</h2>
      <div className="mt-2">
        <FourWeekLine chart={standing.chart} />
      </div>
      <h2 className={cn(EYEBROW, "border-line mt-8 border-t pt-4")}>This week's standing</h2>
      <ol className="mt-2">
        {standing.rows.map((row) => (
          <RankedRow key={row.entityId} row={row} onSwitch={onSwitch} openId={openId} evidence={evidence} />
        ))}
      </ol>
      {rowSheet(standing.rows, openId, evidence)}
    </>
  );
}

function rowSheet(
  rows: readonly HomeRow[],
  openId: string | null,
  evidence: readonly WeekEvidence[] | null,
): ReactElement | null {
  if (openId === null || evidence === null) return null;
  const row = rows.find((entry) => entry.entityId === openId);
  if (row === undefined) return null;
  return <RowSheet title={row.name} evidence={evidence} />;
}
