import { Fragment, type ReactElement } from "react";

import { Mark } from "./mark";
import type { BriefPayload } from "../lib/brief-payload";

const SECTION = "border-line mt-5 border-t pt-4";
const HEAD = "font-mono text-eyebrow text-ink-soft uppercase";
const BODY = "mt-2 text-[0.95rem] leading-[1.6]";
const LINE = "mt-2 text-[0.92rem] leading-[1.6]";

const MAX_MARKS = 3;

export function BriefView({ payload }: { payload: BriefPayload }) {
  return (
    <article
      data-brief="view"
      className="border-line min-w-0 border break-words p-4"
    >
      {headlineBlock(payload)}
      {readThisFirstBlock(payload)}
      {brandsBlock(payload)}
      {ownSiteBlock(payload)}
      {checkedBlock(payload)}
    </article>
  );
}

function headlineBlock(payload: BriefPayload): ReactElement {
  return (
    <section data-brief-block="headline">
      <h2 className="font-display text-[1.5rem] leading-[1.2] text-ink">
        {payload.headline_rank !== null && payload.headline_total >= 2
          ? `You're #${String(payload.headline_rank)} of ${String(payload.headline_total)} this week`
          : "Add a competitor to see where you stand"}
      </h2>
      <p className={BODY}>{payload.why_line}</p>
    </section>
  );
}

function readThisFirstBlock(payload: BriefPayload): ReactElement {
  return (
    <section data-brief-block="read-this-first" className={SECTION}>
      <h3 className={HEAD}>Read this first</h3>
      {payload.read_this_first.length === 0 ? (
        <p className={BODY}>Nothing this week needed reading first.</p>
      ) : (
        payload.read_this_first.slice(0, MAX_MARKS).map((mark) => (
          <Fragment key={mark.signal_id}>
            {mark.before === null || mark.after === null ? (
              <p className={BODY}>
                <a className="underline decoration-1 underline-offset-4" href={mark.url}>
                  {mark.title}
                </a>
              </p>
            ) : (
              <Mark
                before={mark.before}
                after={mark.after}
                sourceUrl={mark.url}
                capturedAt={mark.observed_at}
                size="md"
              />
            )}
            <p className="text-ink-soft mt-2 text-[0.88rem] leading-[1.6]">
              {mark.entity_name}: {mark.jev_reason}
            </p>
          </Fragment>
        ))
      )}
    </section>
  );
}

function brandsBlock(payload: BriefPayload): ReactElement {
  return (
    <section data-brief-block="brands" className={SECTION}>
      <h3 className={HEAD}>Your tracked brands</h3>
      {payload.brands.length === 0 ? (
        <p className={BODY}>Add a competitor to see where you stand</p>
      ) : (
        payload.brands.map((brand) => (
          <p key={brand.entity_id} className={LINE}>
            {brand.name} — {rankText(brand.rank)}
            {brand.biggest_move === null ? null : ` ${brand.biggest_move}`}
          </p>
        ))
      )}
    </section>
  );
}

function ownSiteBlock(payload: BriefPayload): ReactElement {
  const fine = payload.own_site.status === "ok";
  return (
    <section data-brief-block="own-site" className={SECTION}>
      {fine ? (
        <p className={BODY}>Your site looks fine.</p>
      ) : (
        <Fragment>
          <p className={BODY}>Your site looks broken</p>
          {payload.own_site.incidents.map((incident) => (
            <p
              key={`${incident.page_url} ${incident.observed_at} ${String(incident.is_open)}`}
              className={LINE}
            >
              {incident.kind === ""
                ? incident.page_url
                : `${incident.kind} on ${incident.page_url} — ${incident.is_open ? "still broken" : "fixed"}`}
            </p>
          ))}
        </Fragment>
      )}
    </section>
  );
}

function checkedBlock(payload: BriefPayload): ReactElement {
  return (
    <section data-brief-block="checked" className={SECTION}>
      <h3 className={HEAD}>What was checked</h3>
      <p className="text-ink-soft mt-2 font-mono text-[0.75rem] tracking-[0.04em]">
        {payload.checked.mention_count} mentions · {payload.checked.site_change_count} site changes ·{" "}
        {payload.checked.new_ad_count} new ads
      </p>
    </section>
  );
}

function rankText(rank: number | null): string {
  return rank === null ? "unranked" : `#${String(rank)}`;
}
