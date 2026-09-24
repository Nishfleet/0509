import type { Route } from "./+types/onboarding.competitors";

import { useEffect } from "react";
import { Form, redirect, useRevalidator } from "react-router";

import { readOnboardingCompetitors } from "../lib/data/entity.server";
import { acceptSuggestion } from "../lib/data/suggestion.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  return readOnboardingCompetitors(workspaceId);
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const form = await request.formData();
  if (form.get("intent") === "accept") {
    const suggestionId = form.get("suggestionId");
    if (typeof suggestionId === "string" && suggestionId !== "") {
      const workspaceId = await readWorkspaceIdForOwner(session.user.id);
      if (workspaceId === null) throw redirect("/onboarding");
      await acceptSuggestion({ workspaceId, suggestionId, now: new Date().toISOString() });
      return null;
    }
  }
  throw redirect("/app");
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { on, maybes } = loaderData;
  const revalidator = useRevalidator();

  useEffect(() => {
    const id = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 5000);
    return () => {
      clearInterval(id);
    };
  }, [revalidator]);

  return (
    <main>
      <h1>Who you're up against</h1>
      {on.length === 0 && maybes.length === 0 ? (
        <p role="status">We're still looking, add one you know and we'll keep going.</p>
      ) : null}
      <ul aria-label="Watching">
        {on.map((competitor) => (
          <li key={competitor.entityId} className="py-2">
            <span className="font-semibold">{competitor.name}</span>
            {competitor.reason === null ? null : (
              <p className="text-sm truncate">{competitor.reason}</p>
            )}
          </li>
        ))}
      </ul>
      {maybes.length > 0 ? (
        <>
          <h2>Maybe</h2>
          <ul aria-label="Maybe">
            {maybes.map((maybe) => (
              <li key={maybe.suggestionId} className="py-2">
                <span className="font-semibold">{maybe.name}</span>
                {maybe.reason === null ? null : (
                  <p className="text-sm truncate">{maybe.reason}</p>
                )}
                <Form method="post">
                  <input type="hidden" name="intent" value="accept" />
                  <input type="hidden" name="suggestionId" value={maybe.suggestionId} />
                  <button
                    type="submit"
                    aria-label={"Watch " + maybe.name}
                    className="border-line text-ink-soft mt-1 border px-2 py-1 text-sm"
                  >
                    Watch
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Form method="post">
        <input type="hidden" name="intent" value="start" />
        <button type="submit">Start watching</button>
      </Form>
    </main>
  );
}
