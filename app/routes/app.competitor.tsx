import type { Route } from "./+types/app.competitor";

import { redirect, useFetcher } from "react-router";

import { BrandSwitchField } from "../components/brand-switch";
import { CompetitorForget } from "../components/competitor-forget";
import { CompetitorFrame } from "../components/competitor-frame";
import { CompetitorNote } from "../components/competitor-note";
import { CompetitorHeader, dayMonthLabel } from "../components/competitor-header";
import { CompetitorRename } from "../components/competitor-rename";
import { CompetitorSite } from "../components/competitor-site";
import { CompetitorYoutube } from "../components/competitor-youtube";
import { CompetitorSnapshot } from "../components/competitor-snapshot";
import { RivalOnePager } from "../components/rival-one-pager";
import { handleCompetitorForm, type CompetitorFormErrors } from "../lib/competitor-forms.server";
import { readEntityNote } from "../lib/data/entity_note.server";
import { readCompetitorPage } from "../lib/competitor-page.server";
import { snapshotCells } from "../lib/competitor-snapshot";
import { readCompetitorSnapshot } from "../lib/competitor-snapshot.server";
import { daysAgoLabel } from "../lib/delivery-alert";
import { onboardedContext } from "../lib/require-onboarded.server";
import { captureLabel } from "../lib/site-change";

function workspaceFrom(context: Route.LoaderArgs["context"]): string {
  const { workspaceId } = context.get(onboardedContext);
  if (workspaceId === null) throw redirect("/onboarding");
  return workspaceId;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.competitor.name ?? "Competitor"} · Five to Nine` }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const workspaceId = workspaceFrom(context);
  const now = new Date();
  const [page, snapshot, note] = await Promise.all([
    readCompetitorPage(workspaceId, params.entityId, now),
    readCompetitorSnapshot(workspaceId, params.entityId, now),
    readEntityNote(workspaceId, params.entityId),
  ]);
  if (page === null) throw new Response("We don't track that competitor.", { status: 404 });
  return {
    ...page,
    lastChecked: page.watch.lastPolledAt === null ? null : captureLabel(page.watch.lastPolledAt),
    changes: page.changes.map((change) => ({ ...change, when: daysAgoLabel(change.observedAt, now) })),
    developments: page.developments.map((item) => ({ ...item, when: daysAgoLabel(item.observedAt, now) })),
    note,
    now: now.getTime(),
    snapshot: snapshotCells(snapshot),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return handleCompetitorForm(workspaceFrom(context), params.entityId, await request.formData());
}

function CompetitorFoot(props: {
  name: string;
  domain: string;
  note: string;
  youtubeUrl: string | null;
  siteUrl: string | null;
  errors: CompetitorFormErrors | undefined;
}) {
  return (
    <>
      <CompetitorRename name={props.name} domain={props.domain} result={props.errors} />
      <CompetitorNote note={props.note} error={props.errors?.noteError ?? null} />
      <CompetitorSite url={props.siteUrl} error={props.errors?.siteError ?? null} />
      <CompetitorYoutube url={props.youtubeUrl} error={props.errors?.youtubeError ?? null} />
      <CompetitorForget name={props.name} error={props.errors?.forgetError ?? null} />
    </>
  );
}

function OnePager({ data }: { data: Route.ComponentProps["loaderData"] }) {
  return (
    <RivalOnePager
      name={data.competitor.name}
      domain={data.competitor.domain}
      pages={data.watch.pages}
      lastChecked={data.lastChecked}
      changes={data.changes}
      moves={data.developments}
    />
  );
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { competitor } = loaderData;
  const fetcher = useFetcher();
  const state = (["on", "off"] as const).find((value) => value === fetcher.formData?.get("intent")) ?? competitor.state;
  const pausedAt = competitor.state === "off" ? competitor.stateChangedAt : null;
  return (
    <main className="mx-auto flex max-w-6xl min-w-0 flex-col gap-10 px-4 py-10">
      <CompetitorHeader
        name={competitor.name}
        domain={competitor.domain}
        state={competitor.state}
        stateChangedAt={competitor.stateChangedAt}
        stateReason={competitor.stateReason}
        control={
          <BrandSwitchField
            state={state}
            brandName={competitor.name}
            pausedOn={pausedAt === null ? null : new Date(pausedAt)}
            onCheckedChange={(checked) => {
              void fetcher.submit({ intent: checked ? "on" : "off" }, { method: "post" });
            }}
          />
        }
      />
      <CompetitorSnapshot cells={loaderData.snapshot} />
      <OnePager data={loaderData} />
      <CompetitorFrame
        changes={loaderData.changes}
        developments={loaderData.developments}
        weekCount={loaderData.weekCount}
        biggestMove={loaderData.biggestMove}
        quiet={loaderData.quiet}
        pages={loaderData.watch.pages}
        lastChecked={loaderData.lastChecked}
        pausedOn={pausedAt === null ? null : dayMonthLabel(pausedAt, loaderData.timezone)}
        unreadable={loaderData.watch.unreadable}
        sweepClock={loaderData.sweepClock}
        rail={{ ...loaderData.rail, entityId: competitor.id, now: loaderData.now }}
      />
      <CompetitorFoot
        name={competitor.name}
        domain={competitor.domain}
        note={loaderData.note}
        youtubeUrl={loaderData.youtubeUrl}
        siteUrl={loaderData.watch.customerSite}
        errors={actionData}
      />
    </main>
  );
}
