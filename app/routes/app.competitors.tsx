import type { Route } from "./+types/app.competitors";

import { redirect, useFetcher } from "react-router";

import { BrandChip } from "../components/brand-chip";
import { BrandSwitchField } from "../components/brand-switch";
import { AddCompetitor, CompetitorMaybes } from "../components/competitor-maybes";
import { EmptyState } from "../components/empty-state";
import { PAGE, PageHeading } from "../components/page-heading";
import { RetireQuestions } from "../components/retire-questions";
import { handleCompetitorIntent } from "../lib/competitors.server";
import type { CompetitorRow } from "../lib/data/entity.server";
import { readCompetitors } from "../lib/data/entity.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

export function meta() {
  return [{ title: "Competitors · Five to Nine" }];
}

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
  const off = state === "off";
  return (
    <li className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-t py-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <BrandChip name={competitor.name} href={`/app/competitors/${competitor.entityId}`} off={off} />
        <div className="min-w-0">
          <p className="truncate text-body-sm text-ink-soft">{competitor.domain}</p>
          {competitor.reason === null ? null : (
            <p className="mt-1 text-body-sm text-ink-soft">{competitor.reason}</p>
          )}
        </div>
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
  const { competitors, maybes, questions } = loaderData;
  return (
    <main className={PAGE}>
      <PageHeading
        title="Competitors"
        lede="Each brand has one switch. Off stops the watching and the alerts; the history stays."
      />
      {competitors.length === 0 ? (
        <div className="mt-8">
          <EmptyState sentence="Add a competitor to see where you stand. We also look for new ones every night." />
        </div>
      ) : (
        <ul aria-label="Competitors" className="bg-card border-line mt-6 border px-4">
          {competitors.map((competitor) => (
            <CompetitorItem key={competitor.entityId} competitor={competitor} />
          ))}
        </ul>
      )}
      <RetireQuestions questions={questions} />
      <CompetitorMaybes maybes={maybes} />
      <AddCompetitor message={actionData?.message} />
    </main>
  );
}
