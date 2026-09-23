import type { Route } from "./+types/onboarding.competitors";

import { useEffect } from "react";
import { Form, redirect, useRevalidator } from "react-router";

import { readOnboardingCompetitors } from "../lib/data/entity.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  return readOnboardingCompetitors(workspaceId);
}

export async function action({ request }: Route.ActionArgs) {
  await requireSession(request);
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
                {maybe.reason === null && maybe.p === null ? null : (
                  <p className="text-sm truncate">
                    {maybe.reason}
                    {maybe.p === null ? "" : ` ${String(Math.round(maybe.p * 100))}%`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Form method="post">
        <button type="submit">Start watching — €10/mo</button>
      </Form>
    </main>
  );
}
