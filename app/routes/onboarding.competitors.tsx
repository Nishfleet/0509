import type { Route } from "./+types/onboarding.competitors";

import { useEffect } from "react";
import { Form, Link, redirect, useRevalidator } from "react-router";

import { MaybeCompetitorList, OnCompetitorList } from "../components/onboarding/competitor-lists";
import { addUserCompetitor, listOnCompetitors } from "../lib/data/entity.server";
import { markCompetitorsReady } from "../lib/data/onboarding-run.server";
import { acceptSuggestion, listMaybeCompetitors } from "../lib/data/suggestion.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { normaliseInput } from "../lib/identity/normalise";
import { requireSession } from "../lib/require-session.server";

const POLL_MS = 5000;

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  const competitors = await listOnCompetitors(workspaceId);
  const maybes = await listMaybeCompetitors(workspaceId);
  const stillLooking = competitors.length === 0 && maybes.length === 0;
  if (!stillLooking) await markCompetitorsReady(workspaceId);
  return { competitors, maybes, stillLooking };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  const form = await request.formData();

  if (form.get("intent") === "accept") {
    const suggestionId = form.get("suggestionId");
    if (typeof suggestionId === "string") await acceptSuggestion(workspaceId, suggestionId);
    return null;
  }

  const subject = form.get("subject");
  const input = typeof subject === "string" ? subject.trim() : "";
  if (!input) return null;
  const parsed = normaliseInput(input);
  if (!parsed.ok || parsed.subject.kind !== "domain" || parsed.subject.registrable === null) {
    return { addError: "We couldn't find that one — try the brand's main website." };
  }
  await addUserCompetitor(workspaceId, { domain: parsed.subject.registrable, name: null });
  return null;
}

export default function OnboardingCompetitors({ loaderData, actionData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const stillLooking = loaderData.stillLooking;

  useEffect(() => {
    if (!stillLooking) return;
    const timer = setInterval(() => {
      void revalidator.revalidate();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [revalidator, stillLooking]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[52rem] flex-col gap-6 px-6 py-12 sm:px-10 sm:py-16">
      <h1 className="font-display text-display-2 font-extrabold uppercase text-ink">
        Here's who you're up against.
      </h1>

      {stillLooking ? (
        <p className="font-sans text-body text-ink-soft">
          We're still looking — add one you know and we'll keep going.
        </p>
      ) : null}

      {loaderData.competitors.length > 0 ? <OnCompetitorList rows={loaderData.competitors} /> : null}
      {loaderData.maybes.length > 0 ? <MaybeCompetitorList rows={loaderData.maybes} /> : null}

      <Form method="post" className="flex w-full flex-col gap-3 sm:flex-row sm:items-start">
        <input type="hidden" name="intent" value="add" />
        <input
          name="subject"
          type="text"
          aria-label="add one we missed"
          placeholder="add one we missed"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          className="w-full border border-line bg-card px-4 py-3 font-sans text-body text-ink outline-none placeholder:text-ink-faint focus-visible:border-green sm:max-w-[26rem]"
        />
        <button
          type="submit"
          className="shrink-0 border border-ink bg-transparent px-5 py-3 font-display text-[0.95rem] font-bold uppercase tracking-[0.02em] text-ink"
        >
          Add
        </button>
      </Form>
      {actionData?.addError ? (
        <p role="status" className="font-sans text-body-sm text-ink-soft">{actionData.addError}</p>
      ) : null}

      <div className="mt-4">
        <Link
          to="/app"
          className="inline-block border border-ink bg-ink px-5 py-3 font-display text-[0.95rem] font-bold uppercase tracking-[0.02em] text-bone"
        >
          Start watching — €10/mo
        </Link>
      </div>
    </main>
  );
}
