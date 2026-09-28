import type { Route } from "./+types/app.brief";

import { env } from "cloudflare:workers";
import { Link, redirect } from "react-router";

import { BriefView } from "../components/brief-view";
import { EmptyState } from "../components/empty-state";
import { PAGE, PageHeading } from "../components/page-heading";
import { briefSendLine } from "../lib/brief-state";
import { readBriefPayload } from "../lib/brief-payload";
import { listBriefs, readBrief } from "../lib/data/digest.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

const PREVIOUS_LIST = "border-line mt-10 border-t pt-6";
const PREVIOUS_HEADING = "font-display text-lg font-semibold";
const PREVIOUS_LINK = "underline decoration-1 underline-offset-4";
const BRIEF_LINE = "text-ink-soft mt-2 font-mono text-[0.75rem] tracking-[0.04em] uppercase";
const FALLBACK = "This brief could not be shown here.";
const EMPTY_SENTENCE =
  "Your first brief arrives after your first full week of tracking. It will appear here as well as in your inbox.";

export function meta() {
  return [{ title: "Your brief · Five to Nine" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  const weeks = await listBriefs(env.DB, workspaceId);
  const selectedId = params.digestId ?? weeks[0]?.id ?? null;
  const brief = selectedId === null ? null : await readBrief(env.DB, workspaceId, selectedId);
  if (params.digestId !== undefined && brief === null) {
    throw new Response("That brief isn't here.", { status: 404 });
  }
  return {
    weeks: weeks.map((w) => ({
      id: w.id,
      week: w.period_start.slice(0, 10),
      line: briefSendLine(w),
    })),
    selected:
      brief === null
        ? null
        : {
            id: brief.id,
            week: brief.period_start.slice(0, 10),
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
        <EmptyState sentence={EMPTY_SENTENCE} />
      ) : (
        <>
          <p data-brief-state={selected.status} className={BRIEF_LINE}>
            Week of {selected.week} · {selected.line}
          </p>
          <div className="mt-6">
            {selected.payload === null ? (
              <p className="leading-[1.65]">{FALLBACK}</p>
            ) : (
              <BriefView payload={selected.payload} />
            )}
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
                  Week of {w.week}
                </Link>
                {" — "}
                {w.line}
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </main>
  );
}
