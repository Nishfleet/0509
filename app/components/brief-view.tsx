import { Fragment, type ReactElement } from "react";
import { Link } from "react-router";

import { formatBriefAt } from "../lib/brief-settings";
import { isFirstRanking } from "../lib/brief-subject";
import { movementLabel } from "../lib/home-standing";
import { ownSiteLines, ownSitePageLine } from "../lib/own-site-lines";
import { ledgerFooter } from "../lib/work-ledger";
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
      {payload.is_unjudged ? null : <ReadThisFirst marks={payload.read_this_first} />}
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
  const first = isFirstRanking(payload);
  return (
    <section data-brief-block="brands" className={SECTION}>
      <h3 className={HEAD}>Your tracked brands</h3>
      {payload.brands.length === 0 ? (
        <Fragment>
          <p className={BODY}>Add a competitor to see where you stand</p>
          <p className={BODY}>
            <Link
              className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4"
              to="/app/competitors"
            >
              Add one on Competitors
            </Link>
          </p>
        </Fragment>
      ) : (
        payload.brands.map((brand) => (
          <div key={brand.entity_id} className={LINE}>
            <p>
              {payload.is_unjudged && brand.rank === null ? brand.name : `${brand.name}: ${standingText(brand, first)}`}
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
  const site = ownSiteLines(payload.own_site);
  return (
    <section data-brief-block="own-site" className={SECTION}>
      <h3 className={HEAD}>Your site</h3>
      <p className={BODY}>{site.headline}</p>
      {site.pages.map((page) => (
        <p key={page.url} className={LINE}>
          {ownSitePageLine(page, (iso) => briefWhen(iso, payload.timezone))}
        </p>
      ))}
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
  const work = ledgerFooter(payload.checked.ledger, payload.why_line);
  const next = nextBriefLine(payload);
  return (
    <section data-brief-block="checked" className={SECTION}>
      <h3 className={HEAD}>What was checked</h3>
      {work === null ? null : <p className={BODY}>{work}</p>}
      <p className="mt-2 font-mono text-[0.75rem] tracking-[0.04em] text-ink-soft">
        {countLabel(payload.checked.mention_count, "mention", "mentions")} ·{" "}
        {countLabel(payload.checked.site_change_count, "site change", "site changes")}
      </p>
      {since === null ? null : <p className="mt-1 font-mono text-[0.75rem] tracking-[0.04em] text-ink-soft">{since}</p>}
      {next === null ? null : <p className="mt-1 font-mono text-[0.75rem] tracking-[0.04em] text-ink-soft">{next}</p>}
    </section>
  );
}

function briefWhen(iso: string, timezone: string): string {
  try {
    return formatBriefAt(new Date(iso), timezone);
  } catch {
    return iso;
  }
}

function countLabel(count: number, one: string, many: string): string {
  if (count === 0) return `no ${many}`;
  return `${String(count)} ${count === 1 ? one : many}`;
}

function rankText(rank: number | null): string {
  return rank === null ? "unranked" : `#${String(rank)}`;
}

function standingText(brand: BriefPayload["brands"][number], first: boolean): string {
  const rank = rankText(brand.rank);
  if (first || brand.rank === null || (brand.movement === null && !brand.is_new)) return rank;
  return `${rank}, ${movementLabel(brand.movement, brand.is_new)}`;
}

function nextBriefLine(payload: BriefPayload): string | null {
  if (payload.next_brief_at === null) return null;
  const at = new Date(payload.next_brief_at);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return null;
  try {
    return `Next brief: ${formatBriefAt(at, payload.timezone)}`;
  } catch (error) {
    console.warn(JSON.stringify({ event: "brief.next_brief_unreadable", error: String(error) }));
    return null;
  }
}
