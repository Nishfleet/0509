import type { Route } from "./+types/app.brief";

import { env } from "cloudflare:workers";
import { Link, redirect } from "react-router";

import { BriefUnavailable } from "../components/brief-unavailable";
import { BriefView } from "../components/brief-view";
import { dayMonthLabel } from "../components/brand-switch";
import { FirstBriefNote } from "../components/first-brief-note";
import { PAGE, PageHeading } from "../components/page-heading";
import { formatBriefAt } from "../lib/brief-settings";
import { nextBriefAt } from "../lib/brief-schedule";
import { briefSendLine } from "../lib/brief-state";
import { readBriefPayload } from "../lib/brief-payload";
import { listBriefs, readBrief } from "../lib/data/digest.server";
import { readBriefScheduleForOwner } from "../lib/data/workspace.server";
import { onboardedContext } from "../lib/require-onboarded.server";

const PREVIOUS_LIST = "mt-10 border-t border-line pt-6";
const PREVIOUS_HEADING = "font-display text-row-name font-bold [overflow-wrap:anywhere]";
const PREVIOUS_LINK = "inline-flex min-h-11 items-center underline decoration-1 underline-offset-4";
const BRIEF_LINE = "mt-2 font-mono text-[0.75rem] tracking-[0.04em] text-ink-soft uppercase";
export function meta() {
  return [{ title: "Your brief · Five to Nine" }];
}

function briefWeekLabel(periodStart: string): string {
  const day = dayMonthLabel(periodStart);
  return day === null ? "An earlier week" : `Week of ${day}`;
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { session, workspaceId } = context.get(onboardedContext);
  if (workspaceId === null) throw redirect("/onboarding");
  const owned = await readBriefScheduleForOwner(session.user.id);
  if (owned === null) throw redirect("/onboarding");
  const { schedule } = owned;
  const weeks = await listBriefs(env.DB, workspaceId);
  const selectedId = params.digestId ?? weeks[0]?.id ?? null;
  const brief = selectedId === null ? null : await readBrief(env.DB, workspaceId, selectedId);
  if (params.digestId !== undefined && brief === null) {
    throw new Response("That brief isn't here.", { status: 404 });
  }
  const now = new Date();
  return {
    firstBriefAt: formatBriefAt(nextBriefAt(schedule, now), schedule.timezone),
    weeks: weeks.map((w) => ({
      id: w.id,
      weekLabel: briefWeekLabel(w.period_start),
      line: briefSendLine(w),
    })),
    selected:
      brief === null
        ? null
        : {
            id: brief.id,
            weekLabel: briefWeekLabel(brief.period_start),
            status: brief.status,
            line: briefSendLine(brief),
            payload: readBriefPayload(brief.payload_json),
          },
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { selected } = loaderData;
  return (
    <main className={PAGE}>
      <PageHeading title="Your weekly brief" />
      {selected === null ? (
        <div className="mt-6">
          <FirstBriefNote arrivesAt={loaderData.firstBriefAt} />
        </div>
      ) : (
        <>
          <p data-brief-state={selected.status} className={BRIEF_LINE}>
            {selected.weekLabel} · {selected.line}
          </p>
          <div className="mt-6">
            {selected.payload === null ? <BriefUnavailable /> : <BriefView payload={selected.payload} />}
          </div>
        </>
      )}
      {loaderData.weeks.length > 0 ? (
        <nav aria-label="Previous briefs" className={PREVIOUS_LIST}>
          <h2 className={PREVIOUS_HEADING}>Previous briefs</h2>
          <ul className="mt-3">
            {loaderData.weeks.map((w) => (
              <li key={w.id} className="mt-2 leading-[1.65]">
                <Link
                  className={PREVIOUS_LINK}
                  to={`/app/brief/${w.id}`}
                  aria-current={w.id === loaderData.selected?.id ? "page" : undefined}
                >
                  {w.weekLabel}
                </Link>
                {": "}
                {w.line}
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </main>
  );
}
