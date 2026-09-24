import type { Route } from "./+types/app.competitor";

import { Link, redirect, useFetcher } from "react-router";

import { BrandSwitchField } from "../components/brand-switch";
import { CompetitorHeader } from "../components/competitor-header";
import { PAGE } from "../components/page-heading";
import { handleCompetitorIntent } from "../lib/competitors.server";
import { readCompetitor } from "../lib/data/entity.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

async function workspaceFor(request: Request): Promise<string> {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  return workspaceId;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.competitor.name ?? "Competitor"} · Five to Nine` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const competitor = await readCompetitor(await workspaceFor(request), params.entityId);
  if (competitor === null) throw new Response(null, { status: 404, statusText: "Not Found" });
  return { competitor };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get("entityId") !== params.entityId) return { message: null };
  return handleCompetitorIntent(await workspaceFor(request), form);
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { competitor } = loaderData;
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("intent");
  const state = pending === "on" || pending === "off" ? pending : competitor.state;
  return (
    <main className={PAGE}>
      <CompetitorHeader
        name={competitor.name}
        domain={competitor.domain}
        state={state}
        stateChangedAt={competitor.stateChangedAt}
        control={
          <BrandSwitchField
            state={state}
            brandName={competitor.name}
            pausedOn={competitor.stateChangedAt === null ? null : new Date(competitor.stateChangedAt)}
            onCheckedChange={(checked) => {
              void fetcher.submit(
                { intent: checked ? "on" : "off", entityId: competitor.id },
                { method: "post" },
              );
            }}
          />
        }
      />
      <p className="mt-6 max-w-prose leading-[1.55]">
        {state === "on"
          ? `We're watching ${competitor.name}. What we find lands in your weekly brief, and anything urgent shows in Alerts.`
          : "Turn it back on and we pick up where we left off."}
      </p>
      {state === "on" ? (
        <p className="text-ink-soft mt-3 max-w-prose text-body-sm">
          Off stops the watching and the alerts. The history stays, and turning it back on picks up where it left off.
        </p>
      ) : null}
      <Link
        to="/app/competitors"
        prefetch="intent"
        className="font-display mt-8 inline-flex min-h-11 items-center gap-2 font-bold underline decoration-1 underline-offset-4"
      >
        <span aria-hidden="true">←</span> All competitors
      </Link>
    </main>
  );
}
