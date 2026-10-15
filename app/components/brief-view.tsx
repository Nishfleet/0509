import { Fragment, type ReactElement } from "react";

import { ReadThisFirst } from "./read-this-first";
import type { BriefPayload } from "../lib/brief-payload";
import { newRivalLines, rankTrendLine, sinceStartedLine } from "../lib/brief-since";

const SECTION = "mt-5 border-t border-line pt-4";
const HEAD = "font-mono text-eyebrow text-ink-soft uppercase";
const BODY = "mt-2 text-[0.95rem] leading-[1.6]";
const LINE = "mt-2 text-[0.92rem] leading-[1.6]";

export function BriefView({ payload }: { payload: BriefPayload }) {
  return (
    <article data-brief="view" className="min-w-0 border border-line p-4 break-words">
      {headlineBlock(payload)}
      <ReadThisFirst marks={payload.read_this_first} unjudged={payload.is_unjudged} />
      {brandsBlock(payload)}
      {ownSiteBlock(payload)}
      {newRivalBlock(payload)}
      {checkedBlock(payload)}
    </article>
  );
}

function headlineBlock(payload: BriefPayload): ReactElement {
  const trend = rankTrendLine(payload);
  return (
    <section data-brief-block="headline">
      <h2 className="font-display text-[1.5rem] leading-[1.2] text-ink">
        {payload.is_unjudged
          ? payload.why_line
          : payload.headline_rank !== null && payload.headline_total >= 2
            ? `You're #${String(payload.headline_rank)} of ${String(payload.headline_total)} this week`
            : "Add a competitor to see where you stand"}
      </h2>
      {trend === null ? null : (
        <p className="mt-1 font-mono text-[0.75rem] tracking-[0.04em] text-ink-soft uppercase">{trend}</p>
      )}
      {payload.is_unjudged ? null : <p className={BODY}>{payload.why_line}</p>}
    </section>
  );
}

function brandsBlock(payload: BriefPayload): ReactElement {
  return (
    <section data-brief-block="brands" className={SECTION}>
      <h3 className={HEAD}>Your tracked brands</h3>
      {payload.brands.length === 0 ? (
        <Fragment>
          <p className={BODY}>Add a competitor to see where you stand</p>
          <p className={BODY}>
            <a
              className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4"
              href="/app/competitors"
            >
              Add one on Competitors
            </a>
          </p>
        </Fragment>
      ) : (
        payload.brands.map((brand) => (
          <div key={brand.entity_id} className={LINE}>
            <p>
              {brand.name}: {rankText(brand.rank)}
            </p>
            {brand.biggest_move === null ? null : <p className="text-ink-soft">{brand.biggest_move}</p>}
            {(brand.baseline ?? []).map((row) => (
              <p key={row} className="text-ink-soft">
                {row}
              </p>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function ownSiteBlock(payload: BriefPayload): ReactElement {
  const fine = payload.own_site.status === "ok";
  return (
    <section data-brief-block="own-site" className={SECTION}>
      <h3 className={HEAD}>Your site</h3>
      {fine ? (
        <p className={BODY}>Your site looks fine.</p>
      ) : (
        <Fragment>
          <p className={BODY}>Your site looks broken.</p>
          {payload.own_site.incidents.map((incident) => (
            <p key={`${incident.page_url} ${incident.observed_at} ${String(incident.is_open)}`} className={LINE}>
              {incident.kind === ""
                ? incident.page_url
                : `${incident.kind} on ${incident.page_url}, ${incident.is_open ? "still broken" : "fixed"}`}
            </p>
          ))}
        </Fragment>
      )}
    </section>
  );
}

function newRivalBlock(payload: BriefPayload): ReactElement | null {
  const rival = newRivalLines(payload);
  if (rival === null) return null;
  return (
    <section data-brief-block="new-rival" className={SECTION}>
      <h3 className={HEAD}>A competitor you may be missing</h3>
      <p className={BODY}>
        {rival.title}
        {rival.reason === null ? "" : ` ${rival.reason}`}
      </p>
      <p className={BODY}>
        <a
          className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4"
          href="/app/competitors"
        >
          Review in Competitors
        </a>
      </p>
    </section>
  );
}

function checkedBlock(payload: BriefPayload): ReactElement {
  const since = sinceStartedLine(payload.checked);
  return (
    <section data-brief-block="checked" className={SECTION}>
      <h3 className={HEAD}>What was checked</h3>
      <p className="mt-2 font-mono text-[0.75rem] tracking-[0.04em] text-ink-soft">
        {countLabel(payload.checked.mention_count, "mention", "mentions")} ·{" "}
        {countLabel(payload.checked.site_change_count, "site change", "site changes")}
      </p>
      {since === null ? null : <p className="mt-1 font-mono text-[0.75rem] tracking-[0.04em] text-ink-soft">{since}</p>}
    </section>
  );
}

function countLabel(count: number, one: string, many: string): string {
  if (count === 0) return `no ${many}`;
  return `${String(count)} ${count === 1 ? one : many}`;
}

function rankText(rank: number | null): string {
  return rank === null ? "unranked" : `#${String(rank)}`;
}
