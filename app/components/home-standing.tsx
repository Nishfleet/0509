import type { ReactElement } from "react";
import { Form, Link } from "react-router";

import { brandMonogram } from "./brand-chip";
import { EmptyState, fewerThanTwoOnBrands } from "./empty-state";
import type { HomeRow, HomeView } from "../lib/home-standing";
import { cn } from "../lib/utils";

const EYEBROW = "font-mono text-eyebrow text-ink-soft uppercase";
const GREETING = "font-display text-display-2 mt-2 font-extrabold uppercase";
const MARKER = "bg-green text-on-green px-[0.14em] [box-decoration-break:clone]";

export function HomeStanding({ view }: { view: HomeView }): ReactElement {
  return (
    <section data-home="standing" className="min-w-0 break-words">
      <p className={EYEBROW}>{view.eyebrow}</p>
      {greeting(view)}
      {body(view)}
    </section>
  );
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

function body(view: HomeView): ReactElement {
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
        <EmptyState
          sentence={`We're gathering the first week. Your first standing comes with the brief on ${standing.briefAt}.`}
        />
      </div>
    );
  }
  return (
    <>
      <p className="mt-3 max-w-prose leading-[1.55]">{standing.whyLine}</p>
      <h2 className={cn(EYEBROW, "border-line mt-8 border-t pt-4")}>This week's standing</h2>
      <ol className="mt-2">
        {standing.rows.map((row) => (
          <RankedRow key={row.entityId} row={row} />
        ))}
      </ol>
    </>
  );
}

function RankedRow({ row }: { row: HomeRow }): ReactElement {
  return (
    <li
      data-testid="standing-row"
      data-self={row.self ? "true" : undefined}
      className={cn(
        "border-line grid grid-cols-[2.25rem_26px_minmax(0,1fr)_auto] items-center gap-3 border-b px-2 py-3",
        row.self && "bg-green-wash",
      )}
    >
      <span className="font-mono text-[0.88rem]">{row.position === null ? "—" : `#${String(row.position)}`}</span>
      <span
        aria-hidden="true"
        className={cn(
          "font-display flex size-[26px] items-center justify-center border-[1.5px] border-ink text-[0.8rem] font-extrabold",
          row.self ? "bg-green" : "bg-card",
        )}
      >
        {brandMonogram(row.name)}
      </span>
      <span className="min-w-0">
        {row.self ? (
          <span className="font-display text-row-name block truncate font-bold">{row.name}</span>
        ) : (
          <Link
            to={`/app/competitors/${row.entityId}`}
            prefetch="intent"
            className="font-display text-row-name block truncate font-bold hover:underline"
          >
            {row.name}
          </Link>
        )}
        {row.domain === null ? null : (
          <span className="text-ink-soft block truncate text-[0.88rem]">{row.domain}</span>
        )}
      </span>
      <span className="text-ink-soft text-right font-mono text-eyebrow uppercase">
        {row.self ? "You · " : null}
        {row.movement}
      </span>
    </li>
  );
}
