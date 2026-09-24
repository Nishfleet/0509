import type { Route } from "./+types/app.settings";

import { Link } from "react-router";

import { BLOCK_HEADING, PAGE, PageHeading } from "../components/page-heading";
import { AddPasskey } from "../components/passkey-button";
import { BriefScheduleSettings } from "../components/brief-schedule-settings";
import { SignOut } from "../components/sign-out";
import { nextBriefAt } from "../lib/brief-schedule";
import { nextBriefLine, parseScheduleForm } from "../lib/brief-settings";
import { readBriefScheduleForOwner, updateBriefSchedule } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

export function meta() {
  return [{ title: "Settings · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const owned = await readBriefScheduleForOwner(session.user.id);
  const schedule =
    owned === null
      ? null
      : { ...owned.schedule, nextLine: nextBriefLine(nextBriefAt(owned.schedule, new Date()), owned.schedule.timezone) };
  return { email: session.user.email, schedule };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const owned = await readBriefScheduleForOwner(session.user.id);
  const schedule = parseScheduleForm(await request.formData());
  if (owned === null || schedule === null) return { saved: false };
  await updateBriefSchedule(owned.workspaceId, schedule);
  return { saved: true };
}

const BLOCK = "border-line mt-10 border-t pt-4";

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main className={PAGE}>
      <PageHeading
        title="Settings"
        lede="Turn tracking for a brand on or off from its switch in Competitors."
      />
      {loaderData.schedule === null ? null : (
        <section aria-labelledby="settings-brief" className={BLOCK}>
          <h2 id="settings-brief" className={BLOCK_HEADING}>
            Your weekly brief
          </h2>
          <p className="mt-2 max-w-prose leading-[1.55]">One email a week, when you want to read it.</p>
          <BriefScheduleSettings schedule={loaderData.schedule} />
        </section>
      )}
      <section aria-labelledby="settings-agents" className={BLOCK}>
        <h2 id="settings-agents" className={BLOCK_HEADING}>
          Agents and API
        </h2>
        <p className="mt-2 max-w-prose leading-[1.55]">
          Let Claude, ChatGPT, Cursor or your own code read your brief, competitors and alerts. They can only read.
        </p>
        <Link
          to="/app/settings/agents"
          prefetch="intent"
          className="font-display mt-3 inline-flex min-h-11 items-center gap-2 font-bold underline decoration-1 underline-offset-4"
        >
          Connect an agent <span aria-hidden="true">→</span>
        </Link>
      </section>
      <section aria-labelledby="settings-account" className={BLOCK}>
        <h2 id="settings-account" className={BLOCK_HEADING}>
          Account
        </h2>
        <p className="mt-2 leading-[1.55] [overflow-wrap:anywhere]">
          Signed in as <strong className="font-semibold">{loaderData.email}</strong>
        </p>
        <div className="mt-2 flex flex-wrap items-start gap-x-6">
          <AddPasskey />
          <SignOut />
        </div>
      </section>
    </main>
  );
}
