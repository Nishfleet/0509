import type { Route } from "./+types/app.competitor";

import { Form, redirect, useFetcher } from "react-router";

import { BrandSwitchField } from "../components/brand-switch";
import { CompetitorFrame } from "../components/competitor-frame";
import { CompetitorHeader, DAY_MONTH } from "../components/competitor-header";
import { Button } from "../components/ui/button";
import { readCompetitorPage } from "../lib/competitor-page.server";
import { forgetCompetitor } from "../lib/competitor-forget.server";
import { handleCompetitorIntent } from "../lib/competitors.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { daysAgoLabel } from "../lib/delivery-alert";
import { requireSession } from "../lib/require-session.server";
import { captureLabel } from "../lib/site-change";

async function workspaceFor(request: Request): Promise<string> {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  return workspaceId;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.competitor.name ?? "Competitor"} — Five to Nine` }];
}

export function headers() {
  return { "cache-control": "private, no-store" };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const workspaceId = await workspaceFor(request);
  const now = new Date();
  const page = await readCompetitorPage(workspaceId, params.entityId, now);
  if (page === null) throw new Response("We don't track that competitor.", { status: 404 });
  return {
    ...page,
    lastChecked: page.watch.lastPolledAt === null ? null : captureLabel(page.watch.lastPolledAt),
    changes: page.changes.map((change) => ({ ...change, when: daysAgoLabel(change.observedAt, now) })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const workspaceId = await workspaceFor(request);
  const intent = (await request.formData()).get("intent");
  if (intent === "forget") {
    await forgetCompetitor(workspaceId, params.entityId, new Date().toISOString());
    throw redirect("/app/competitors");
  }
  const form = new FormData();
  form.set("intent", intent === "on" || intent === "off" ? intent : "");
  form.set("entityId", params.entityId);
  return handleCompetitorIntent(workspaceId, form);
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { competitor } = loaderData;
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("intent");
  const state = pending === "on" || pending === "off" ? pending : competitor.state;
  const pausedAt = competitor.state === "off" ? competitor.stateChangedAt : null;
  return (
    <main className="mx-auto flex max-w-6xl min-w-0 flex-col gap-10 px-4 py-10">
      <CompetitorHeader
        name={competitor.name}
        domain={competitor.domain}
        state={competitor.state}
        stateChangedAt={competitor.stateChangedAt}
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
      <Form method="post" className="flex min-w-0 flex-col items-start gap-2">
        <input type="hidden" name="intent" value="forget" />
        <Button type="submit" variant="secondary">
          Stop tracking and delete its history
        </Button>
        <p className="text-meta text-ink-soft">
          Turning it off keeps its history. This deletes every change and screenshot we kept for it.
        </p>
      </Form>
      <CompetitorFrame
        changes={loaderData.changes}
        weekCount={loaderData.weekCount}
        biggestId={loaderData.biggestId}
        pages={loaderData.watch.pages}
        lastChecked={loaderData.lastChecked}
        pausedOn={pausedAt === null ? null : DAY_MONTH.format(new Date(pausedAt))}
      />
    </main>
  );
}
