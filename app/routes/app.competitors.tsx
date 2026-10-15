import { useId } from "react";

import type { Route } from "./+types/app.competitors";

import { redirect, useFetcher } from "react-router";

import { BrandChip } from "../components/brand-chip";
import { BrandSwitch, brandSwitchNote } from "../components/brand-switch";
import { CapRefusal } from "../components/cap-refusal";
import { CompetitorCount } from "../components/competitor-count";
import { CompetitorRemoved } from "../components/competitor-removed";
import { AddCompetitor, CompetitorMaybes } from "../components/competitor-maybes";
import { UpgradeStatus } from "../components/plan-gate";
import { EmptyState } from "../components/empty-state";
import { PAGE, PageHeading } from "../components/page-heading";
import { RetireQuestions } from "../components/retire-questions";
import { isPlanId } from "../lib/billing/plans";
import { reconcileCheckoutReturn } from "../lib/billing/reconcile.server";
import { handleCompetitorIntent } from "../lib/competitors.server";
import type { CompetitorRow } from "../lib/data/entity.server";
import { readCompetitors } from "../lib/data/entity.server";
import { readEntitlements, readPlanTier } from "../lib/data/plan.server";
import { competitorCountLine } from "../lib/competitor-count";
import { onboardedContext } from "../lib/require-onboarded.server";
import { cn } from "../lib/utils";

export function meta() {
  return [{ title: "Competitors · Five to Nine" }];
}

function workspaceFrom(context: Route.LoaderArgs["context"]): string {
  const { workspaceId } = context.get(onboardedContext);
  if (workspaceId === null) throw redirect("/onboarding");
  return workspaceId;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const workspaceId = workspaceFrom(context);
  const wanted = new URL(request.url).searchParams.get("upgraded");
  if (isPlanId(wanted)) await reconcileCheckoutReturn(workspaceId, context.get(onboardedContext).session.user.email);
  const [competitors, tier, entitlements] = await Promise.all([
    readCompetitors(workspaceId),
    readPlanTier(workspaceId),
    readEntitlements(workspaceId),
  ]);
  const watching = competitors.competitors.filter((competitor) => competitor.state === "on").length;
  return {
    ...competitors,
    tier,
    countLine: competitorCountLine(watching, entitlements.competitors),
    planFull: watching >= entitlements.competitors,
    wanted: isPlanId(wanted) ? wanted : null,
    removed: new URL(request.url).searchParams.get("removed") === "1",
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleCompetitorIntent(workspaceFrom(context), await request.formData());
}

function CompetitorItem({ competitor }: { competitor: CompetitorRow }) {
  const fetcher = useFetcher<typeof action>();
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
        <p id={noteId} className={cn("basis-full text-meta text-ink-soft", state === "on" && "sr-only")}>
          {brandSwitchNote(state, competitor.stateChangedAt === null ? null : new Date(competitor.stateChangedAt))}
        </p>
        <CapRefusal result={fetcher.data} />
      </div>
    </li>
  );
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { competitors, maybes, questions, tier, wanted, countLine, planFull, removed } = loaderData;
  return (
    <main className={PAGE}>
      <PageHeading
        title="Competitors"
        lede="Each competitor has one switch. Turn it off to stop watching and alerts. Your history stays. Open one to fix its name, or to delete it for good with Remove and forget."
      />
      <CompetitorCount line={countLine} full={planFull} />
      {removed ? <CompetitorRemoved /> : null}
      <UpgradeStatus tier={tier} wanted={wanted} />
      <AddCompetitor
        message={actionData?.message}
        upgradePlanId={actionData?.upgradePlanId}
        returning={actionData?.returning}
        added={actionData?.added}
      />
      {competitors.length === 0 ? (
        <div className="mt-8">
          <EmptyState sentence="Add a competitor to see where you stand. We also look for new ones every week." />
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
    </main>
  );
}
