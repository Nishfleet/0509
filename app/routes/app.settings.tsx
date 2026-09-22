import type { Route } from "./+types/app.settings";

import { Link, Outlet } from "react-router";

import { loadBrief, saveBrief } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";
import { BriefForm } from "./settings";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const brief = await loadBrief(session.user.id);
  return { email: session.user.email, brief };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const form = await request.formData();
  return saveBrief(session.user.id, {
    timezone: textField(form, "timezone"),
    weekday: Number(textField(form, "weekday")),
    hour: Number(textField(form, "hour")),
  });
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const brief = loaderData.brief;
  const nextBrief = actionData?.nextBrief ?? brief?.nextBrief ?? null;
  return (
    <main>
      <h1>Settings</h1>
      <p>Signed in as {loaderData.email}</p>
      {brief ? (
        <BriefForm
          timezone={brief.timezone}
          weekday={brief.weekday}
          hour={brief.hour}
          nextBrief={nextBrief ? localBrief(nextBrief, brief.timezone) : null}
          error={actionData?.error ?? null}
        />
      ) : (
        <p>No workspace yet.</p>
      )}
      <p>
        <Link to="/app/settings/card">Public card</Link>
      </p>
      <Outlet />
    </main>
  );
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function localBrief(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}
