import type { Route } from "./+types/onboarding.competitors";

import { useEffect } from "react";
import { Form, redirect, useRevalidator } from "react-router";

import { AddCompetitor, CompetitorMaybes } from "../components/competitor-maybes";
import { Monogram } from "../components/monogram";
import { OnboardingFrame } from "../components/onboarding-frame";
import { Button } from "../components/ui/button";
import { handleCompetitorIntent } from "../lib/competitors.server";
import { readOnboardingCompetitors } from "../lib/data/entity.server";
import { markCompetitorsReady } from "../lib/data/onboarding_run.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { isDiscoveryActive } from "../lib/discovery/start.server";
import { requireSession } from "../lib/require-session.server";

const POLL_MS = 3000;

async function workspaceFor(request: Request): Promise<string> {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  return workspaceId;
}

export async function loader({ request }: Route.LoaderArgs) {
  const workspaceId = await workspaceFor(request);
  const [competitors, searching] = await Promise.all([
    readOnboardingCompetitors(workspaceId),
    isDiscoveryActive(workspaceId, new Date()),
  ]);
  if (competitors.on.length + competitors.maybes.length > 0) {
    await markCompetitorsReady(workspaceId, new Date().toISOString());
  }
  return { ...competitors, searching };
}

export async function action({ request }: Route.ActionArgs) {
  const workspaceId = await workspaceFor(request);
  const form = await request.formData();
  if (form.get("intent") === "start") throw redirect("/app");
  return handleCompetitorIntent(workspaceId, form);
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { on, maybes, searching } = loaderData;
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
      {searching ? (
        <p role="status" className="text-ink-soft mt-3 max-w-prose leading-[1.55]">
          We're reading the news for brands named alongside you. They appear here as we find them.
        </p>
      ) : null}
      {!searching && on.length === 0 && maybes.length === 0 ? (
        <p role="status" className="text-ink-soft mt-3 max-w-prose leading-[1.55]">
          We didn't find anyone named alongside you yet. Add one you know and we'll keep looking every night.
        </p>
      ) : null}
      {on.length === 0 ? null : (
        <ul aria-label="Watching" aria-live="polite" aria-relevant="additions" className="border-line mt-8 border-b">
          {on.map((competitor) => (
            <li key={competitor.entityId} className="border-line flex items-start gap-3 border-t py-4">
              <Monogram name={competitor.name} />
              <div className="min-w-0">
                <p className="font-display text-row-name truncate font-bold">{competitor.name}</p>
                <p className="text-ink-soft truncate text-body-sm">{competitor.domain}</p>
                {competitor.reason === null ? null : (
                  <p className="text-ink-soft mt-1 text-body-sm">{competitor.reason}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <CompetitorMaybes maybes={maybes} />
      <AddCompetitor message={actionData?.message} />
      <Form method="post" className="border-line mt-12 border-t pt-8">
        <input type="hidden" name="intent" value="start" />
        <Button type="submit" size="lg">
          Start watching
        </Button>
        <p className="text-ink-soft mt-3 text-body-sm">You can switch any of them on or off later in Competitors.</p>
      </Form>
    </OnboardingFrame>
  );
}
