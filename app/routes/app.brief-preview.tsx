import type { Route } from "./+types/app.brief-preview";

import { Link, redirect } from "react-router";

import { BriefView } from "../components/brief-view";
import { PAGE, PageHeading } from "../components/page-heading";
import { formatBriefAt } from "../lib/brief-settings";
import { previewBrief, previewFirstRun } from "../lib/brief-preview.server";
import { readBriefScheduleForOwner } from "../lib/data/workspace.server";
import { onboardedContext } from "../lib/require-onboarded.server";

export function meta() {
  return [{ title: "This week's brief so far · Five to Nine" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { session, workspaceId } = context.get(onboardedContext);
  if (workspaceId === null) throw redirect("/onboarding");
  const owned = await readBriefScheduleForOwner(session.user.id);
  if (owned === null) throw redirect("/onboarding");
  const payload = await previewBrief(workspaceId, owned.schedule, new Date());
  const firstRun = await previewFirstRun(workspaceId, payload);
  const sendsAt = formatBriefAt(new Date(payload.period_end), owned.schedule.timezone);
  return {
    payload,
    sendsAt,
    firstRun: firstRun === null ? undefined : { arrivesAt: sendsAt, names: firstRun.names },
    paused: owned.schedule.pausedAt !== null,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main className={PAGE}>
      <PageHeading title="This week so far" />
      <p
        data-brief="preview"
        className="mt-2 font-mono text-[0.75rem] tracking-[0.04em] [overflow-wrap:anywhere] text-ink-soft uppercase"
      >
        Preview · Nothing is sent from here
      </p>
      <p className="mt-3 max-w-prose leading-[1.55] text-ink-soft">
        {loaderData.paused
          ? "This is your brief as it would read today. Your weekly brief is paused, so it won't be sent."
          : `This is your brief as it would read today. The real one goes out ${loaderData.sendsAt}, and by then it may have more in it.`}
      </p>
      <div className="mt-6">
        <BriefView payload={loaderData.payload} firstRun={loaderData.firstRun} />
      </div>
      <p className="mt-10">
        <Link className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4" to="/app/brief">
          Back to your briefs
        </Link>
      </p>
    </main>
  );
}
