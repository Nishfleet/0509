import { useId } from "react";

import type { Route } from "./+types/app.competitors";

import { redirect, useFetcher } from "react-router";

import { BrandChip } from "../components/brand-chip";
import { BrandSwitch, brandSwitchNote } from "../components/brand-switch";
import { AddCompetitor, CompetitorMaybes } from "../components/competitor-maybes";
import { UpgradeStatus } from "../components/plan-gate";
import { EmptyState } from "../components/empty-state";
import { PAGE, PageHeading } from "../components/page-heading";
import { RetireQuestions } from "../components/retire-questions";
import { isPlanId } from "../lib/billing/plans";
import { handleCompetitorIntent } from "../lib/competitors.server";
import type { CompetitorRow } from "../lib/data/entity.server";
import { readCompetitors } from "../lib/data/entity.server";
import { readPlanTier } from "../lib/data/plan.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireFreshSession, requireSession } from "../lib/require-session.server";

export function meta() {
  return [{ title: "Competitors · Five to Nine" }];
}

async function workspaceFor(request: Request, fresh = false): Promise<string> {
  const session = await (fresh ? requireFreshSession(request) : requireSession(request));
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  return workspaceId;
}

export async function loader({ request }: Route.LoaderArgs) {
  const workspaceId = await workspaceFor(request);
  const wanted = new URL(request.url).searchParams.get("upgraded");
  const [competitors, tier] = await Promise.all([readCompetitors(workspaceId), readPlanTier(workspaceId)]);
  return { ...competitors, tier, wanted: isPlanId(wanted) ? wanted : null };
}

export async function action({ request }: Route.ActionArgs) {
  const workspaceId = await workspaceFor(request, true);
  return handleCompetitorIntent(workspaceId, await request.formData());
}

function CompetitorItem({ competitor }: { competitor: CompetitorRow }) {
  const fetcher = useFetcher();
  const noteId = useId();
  const pending = fetcher.formData?.get("intent");
  const state = pending === "on" || pending === "off" ? pending : competitor.state;
  const off = state === "off";
  return (
    <li className="border-t border-line py-4 first:border-t-0">
      <div
        data-slot="brand-switch-field"
        data-state={state}
        className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
      >
        <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
          <BrandChip name={competitor.name} href={`/app/competitors/${competitor.entityId}`} off={off} />
          <div className="min-w-0">
            <p className="truncate text-body-sm text-ink-soft">{competitor.domain}</p>
            {competitor.reason === null ? null : <p className="mt-1 text-body-sm text-ink-soft">{competitor.reason}</p>}
          </div>
        </div>
        <BrandSwitch
          state={state}
          brandName={competitor.name}
          describedBy={noteId}
          onCheckedChange={(checked) => {
            void fetcher.submit({ intent: checked ? "on" : "off", entityId: competitor.entityId }, { method: "post" });
          }}
        />
        <p id={noteId} className="basis-full text-meta text-ink-soft">
          {brandSwitchNote(state, competitor.stateChangedAt === null ? null : new Date(competitor.stateChangedAt))}
        </p>
      </div>
    </li>
  );
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { competitors, maybes, questions, tier, wanted } = loaderData;
  return (
    <main className={PAGE}>
      <PageHeading
        title="Competitors"
        lede="Each brand has one switch. Off stops the watching and the alerts; the history stays."
      />
      <UpgradeStatus tier={tier} wanted={wanted} />
      {competitors.length === 0 ? (
        <div className="mt-8">
          <EmptyState sentence="Add a competitor to see where you stand. We also look for new ones every night." />
        </div>
      ) : (
        <ul aria-label="Competitors" className="mt-6 border border-line bg-card px-4">
          {competitors.map((competitor) => (
            <CompetitorItem key={competitor.entityId} competitor={competitor} />
          ))}
        </ul>
      )}
      <RetireQuestions questions={questions} />
      <CompetitorMaybes maybes={maybes} />
      <AddCompetitor message={actionData?.message} upgradePlanId={actionData?.upgradePlanId} />
    </main>
  );
}
