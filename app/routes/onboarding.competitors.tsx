import type { Route } from "./+types/onboarding.competitors";

import { useEffect } from "react";
import { Form, redirect, useRevalidator } from "react-router";

import { AddCompetitor, CompetitorMaybes } from "../components/competitor-maybes";
import { StepBar } from "../components/step-bar";
import { handleCompetitorIntent } from "../lib/competitors.server";
import { readOnboardingCompetitors } from "../lib/data/entity.server";
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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <StepBar current={3} />
      <h1 className="font-display mt-6 text-2xl font-semibold tracking-[-0.02em]">Who you're up against</h1>
      {searching ? (
        <p role="status" className="text-ink-soft mt-2">
          We're reading the news for brands named alongside you. They appear here as we find them.
        </p>
      ) : null}
      {!searching && on.length === 0 && maybes.length === 0 ? (
        <p role="status" className="mt-2">
          We didn't find anyone named alongside you yet. Add one you know and we'll keep looking every night.
        </p>
      ) : null}
      <ul aria-label="Watching" className="mt-6">
        {on.map((competitor) => (
          <li key={competitor.entityId} className="border-line border-t py-3">
            <span className="font-semibold">{competitor.name}</span>
            <span className="text-ink-soft ml-2 text-sm">{competitor.domain}</span>
            {competitor.reason === null ? null : <p className="text-ink-soft text-sm">{competitor.reason}</p>}
          </li>
        ))}
      </ul>
      <CompetitorMaybes maybes={maybes} />
      <AddCompetitor message={actionData?.message} />
      <Form method="post" className="mt-10">
        <input type="hidden" name="intent" value="start" />
        <button type="submit" className="bg-ink text-card min-h-11 px-5 font-semibold">
          Start watching
        </button>
      </Form>
    </main>
  );
}
