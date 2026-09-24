import type { Route } from "./+types/app.settings";

import { env } from "cloudflare:workers";
import { Link, redirect } from "react-router";

import { DeleteAccount, SignOut } from "../components/account-settings";
import { BriefScheduleSettings } from "../components/brief-schedule-settings";
import { DismissedBrands } from "../components/dismissed-brands";
import { OwnSiteAlertsSetting } from "../components/own-site-alerts-setting";
import { BLOCK_HEADING, PAGE, PageHeading } from "../components/page-heading";
import { AddPasskey } from "../components/passkey-button";
import { deleteAccount } from "../lib/account-delete.server";
import { oauthHelpersContext } from "../lib/agent/context.server";
import { signOut } from "../lib/auth.server";
import { nextBriefAt } from "../lib/brief-schedule";
import { formatBriefAt, parseBriefSchedule } from "../lib/brief-settings";
import { readUserDismissed, restoreSuggestion } from "../lib/data/suggestion.server";
import {
  readBriefScheduleForOwner,
  updateBriefSchedule,
  readOwnSiteAlerts,
  setOwnSiteAlerts,
  readWorkspaceIdForOwner,
} from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

const MISMATCH = "That doesn't match your email. Type it exactly to delete your account.";
const SIGN_IN_AGAIN = "For your safety, sign out and sign back in, then delete your account.";

export function meta() {
  return [{ title: "Settings · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const owned = await readBriefScheduleForOwner(session.user.id);
  const schedule =
    owned === null
      ? null
      : { ...owned.schedule, nextLine: formatBriefAt(nextBriefAt(owned.schedule, new Date()), owned.schedule.timezone) };
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const ownSiteAlerts = workspaceId === null ? true : await readOwnSiteAlerts(workspaceId);
  const dismissed = workspaceId === null ? [] : await readUserDismissed(workspaceId);
  return { email: session.user.email, schedule, ownSiteAlerts, dismissed };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireSession(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "own-site-alerts") {
    const workspaceId = await readWorkspaceIdForOwner(session.user.id);
    if (workspaceId === null) return { saved: false, deleteError: null };
    const raw = form.get("value");
    const next = raw === "on" ? true : raw === "off" ? false : null;
    if (next === null) return { saved: false, deleteError: null };
    await setOwnSiteAlerts(workspaceId, next);
    return { saved: true, deleteError: null };
  }
  if (intent === "sign-out") {
    throw redirect("/login", { headers: await signOut(env, request) });
  }
  if (intent === "delete-account") {
    const confirm = form.get("confirm");
    const typed = typeof confirm === "string" ? confirm.trim().toLowerCase() : "";
    if (typed !== session.user.email.toLowerCase()) return { saved: null, deleteError: MISMATCH };
    const headers = await deleteAccount(context.get(oauthHelpersContext), request, session.user.id);
    if (headers === null) return { saved: null, deleteError: SIGN_IN_AGAIN };
    throw redirect("/login", { headers });
  }
  if (intent === "restore-suggestion") {
    const workspaceId = await readWorkspaceIdForOwner(session.user.id);
    const rawId = form.get("suggestionId");
    const suggestionId = typeof rawId === "string" ? rawId.trim() : "";
    if (workspaceId !== null && suggestionId !== "") await restoreSuggestion({ workspaceId, suggestionId });
    return { saved: null, deleteError: null };
  }
  const owned = await readBriefScheduleForOwner(session.user.id);
  const schedule = parseBriefSchedule({
    weekday: form.get("weekday"),
    hour: form.get("hour"),
    timezone: form.get("timezone"),
  });
  if (owned === null || schedule === null) return { saved: false, deleteError: null };
  await updateBriefSchedule(owned.workspaceId, schedule);
  return { saved: true, deleteError: null };
}

const BLOCK = "border-line mt-10 border-t pt-4";

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className={PAGE}>
      <PageHeading title="Settings" lede="Turn tracking for a brand on or off from its switch in Competitors." />
      {loaderData.schedule === null ? null : (
        <section aria-labelledby="settings-brief" className={BLOCK}>
          <h2 id="settings-brief" className={BLOCK_HEADING}>
            Your weekly brief
          </h2>
          <p className="mt-2 max-w-prose leading-[1.55]">One email a week, when you want to read it.</p>
          <BriefScheduleSettings schedule={loaderData.schedule} />
        </section>
      )}
      <OwnSiteAlertsSetting on={loaderData.ownSiteAlerts} />
      <DismissedBrands dismissed={loaderData.dismissed} />
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
      <DeleteAccount email={loaderData.email} error={actionData?.deleteError ?? null} />
    </main>
  );
}
