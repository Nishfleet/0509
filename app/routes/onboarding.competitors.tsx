import type { Route } from "./+types/onboarding.competitors";

import { useEffect } from "react";
import { Form, redirect, useRevalidator } from "react-router";

import { AddCompetitor, CompetitorMaybes } from "../components/competitor-maybes";
import { Monogram } from "../components/monogram";
import { OnboardingFrame } from "../components/onboarding-frame";
import { Button } from "../components/ui/button";
import { handleCompetitorIntent } from "../lib/competitors.server";
import { readOnboardingCompetitors } from "../lib/data/entity.server";
import { markCompetitorsReady, markWatchingStarted } from "../lib/data/onboarding_run.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { readDiscoveryState } from "../lib/discovery/start.server";
import { discoveryNotice } from "../lib/discovery/state";
import { requireSession } from "../lib/require-session.server";
import { ONBOARDING_COMPETITORS, workspaceLandingForRequest } from "../lib/workspace.server";

const POLL_MS = 3000;

async function workspaceFor(request: Request): Promise<string> {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (landing !== null && landing !== ONBOARDING_COMPETITORS) throw redirect(landing);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  return workspaceId;
}

export async function loader({ request }: Route.LoaderArgs) {
  const workspaceId = await workspaceFor(request);
  const [competitors, discovery] = await Promise.all([
    readOnboardingCompetitors(workspaceId),
    readDiscoveryState(workspaceId, new Date()),
  ]);
  if (competitors.on.length + competitors.maybes.length > 0) {
    await markCompetitorsReady(workspaceId, new Date().toISOString());
  }
  return { ...competitors, discovery };
}

export async function action({ request }: Route.ActionArgs) {
  const workspaceId = await workspaceFor(request);
  const form = await request.formData();
  if (form.get("intent") === "start") {
    await markWatchingStarted(workspaceId, new Date().toISOString());
    throw redirect("/app");
  }
  return handleCompetitorIntent(workspaceId, form);
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { on, maybes, discovery } = loaderData;
  const searching = discovery === "looking";
  const notice = discoveryNotice(discovery, on.length + maybes.length);
  const revalidator = useRevalidator();

  useEffect(() => {
    if (!searching) return;
    const id = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [revalidator, searching]);

  return (
    <OnboardingFrame step={3} heading="Who you're up against">
      {notice === null ? null : (
        <p role="status" className="mt-3 max-w-prose leading-[1.55] text-ink-soft">
          {notice}
        </p>
      )}
      {on.length === 0 ? null : (
        <ul aria-label="Watching" aria-live="polite" aria-relevant="additions" className="mt-8 border-b border-line">
          {on.map((competitor) => (
            <li key={competitor.entityId} className="flex items-start gap-3 border-t border-line py-4">
              <Monogram name={competitor.name} />
              <div className="min-w-0">
                <p className="truncate font-display text-row-name font-bold">{competitor.name}</p>
                <p className="truncate text-body-sm text-ink-soft">{competitor.domain}</p>
                {competitor.reason === null ? null : (
                  <p className="mt-1 text-body-sm text-ink-soft">{competitor.reason}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <CompetitorMaybes maybes={maybes} />
      <AddCompetitor message={actionData?.message} />
      <Form method="post" className="mt-12 border-t border-line pt-8">
        <input type="hidden" name="intent" value="start" />
        <Button type="submit" size="lg">
          Start watching
        </Button>
        <p className="mt-3 text-body-sm text-ink-soft">You can switch any of them on or off later in Competitors.</p>
      </Form>
    </OnboardingFrame>
  );
}
