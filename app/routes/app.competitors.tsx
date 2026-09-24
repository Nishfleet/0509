import type { Route } from "./+types/app.competitors";

import { Link, redirect, useFetcher } from "react-router";

import { BrandSwitchField } from "../components/brand-switch";
import { AddCompetitor, CompetitorMaybes } from "../components/competitor-maybes";
import { EmptyState } from "../components/empty-state";
import { handleCompetitorIntent } from "../lib/competitors.server";
import type { CompetitorRow } from "../lib/data/entity.server";
import { readCompetitors } from "../lib/data/entity.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

async function workspaceFor(request: Request): Promise<string> {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  return workspaceId;
}

export async function loader({ request }: Route.LoaderArgs) {
  return readCompetitors(await workspaceFor(request));
}

export async function action({ request }: Route.ActionArgs) {
  const workspaceId = await workspaceFor(request);
  return handleCompetitorIntent(workspaceId, await request.formData());
}

function CompetitorItem({ competitor }: { competitor: CompetitorRow }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("intent");
  const state = pending === "on" || pending === "off" ? pending : competitor.state;
  return (
    <li className="border-line flex flex-wrap items-center gap-3 border-t py-3">
      <div className={state === "off" ? "text-ink-faint min-w-0 flex-1" : "min-w-0 flex-1"}>
        <Link to={`/app/competitors/${competitor.entityId}`} className="font-semibold">
          {competitor.name}
        </Link>
        <span className="text-ink-soft ml-2 text-sm">{competitor.domain}</span>
        {competitor.reason === null ? null : <p className="text-ink-soft text-sm">{competitor.reason}</p>}
      </div>
      <BrandSwitchField
        state={state}
        brandName={competitor.name}
        pausedOn={competitor.stateChangedAt === null ? null : new Date(competitor.stateChangedAt)}
        onCheckedChange={(checked) => {
          void fetcher.submit({ intent: checked ? "on" : "off", entityId: competitor.entityId }, { method: "post" });
        }}
      />
    </li>
  );
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { competitors, maybes } = loaderData;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">Competitors</h1>
      {competitors.length === 0 ? (
        <div className="mt-6">
          <EmptyState sentence="Add a competitor to see where you stand. We also look for new ones every night." />
        </div>
      ) : (
        <ul aria-label="Competitors" className="mt-6">
          {competitors.map((competitor) => (
            <CompetitorItem key={competitor.entityId} competitor={competitor} />
          ))}
        </ul>
      )}
      <CompetitorMaybes maybes={maybes} />
      <AddCompetitor message={actionData?.message} />
    </main>
  );
}
