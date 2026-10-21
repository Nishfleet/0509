import type { Route } from "./+types/onboarding.competitors";

import { useEffect, useState } from "react";
import { data, Form, redirect, useNavigation, useRevalidator } from "react-router";
import { z } from "zod";

import { AddCompetitor, CompetitorMaybes } from "../components/competitor-maybes";
import { DiscoverySkeleton } from "../components/discovery-skeleton";
import { Monogram } from "../components/monogram";
import { OnboardingFrame } from "../components/onboarding-frame";
import { Button } from "../components/ui/button";
import { readOtherBrands } from "../lib/client-brands.server";
import { handleCompetitorIntent } from "../lib/competitors.server";
import { markCompetitorsReady, markWatchingStarted } from "../lib/data/onboarding_run.server";
import { readOnboardingScreen } from "../lib/discovery/start.server";
import { ensureOnboardingRun } from "../lib/onboarding-start.server";
import { TRIAL_DAYS } from "../lib/billing/plans";
import { discoveryNotice, type DiscoveryState } from "../lib/discovery/state";
import { requireFreshSession, requireSession, signOutToLogin } from "../lib/require-session.server";
import { createTimings } from "../lib/server-timing.server";
import { ONBOARDING_COMPETITORS, workspaceLandingForRequest } from "../lib/workspace.server";

const POLL_MS = 3000;
const MAX_POLLS = 60;

const startWatchingForm = z.object({ intent: z.literal("start") });

async function workspaceFor(request: Request, fresh = false): Promise<{ workspaceId: string; userId: string }> {
  const session = await (fresh ? requireFreshSession(request) : requireSession(request));
  const { landing, workspaceId } = await workspaceLandingForRequest(request, session.user);
  if (workspaceId === null) return await signOutToLogin(request);
  if (landing !== null && landing !== ONBOARDING_COMPETITORS) throw redirect(landing);
  return { workspaceId, userId: session.user.id };
}

export function meta() {
  return [{ title: "Your competitors · Five to Nine" }];
}

export function headers() {
  return { "cache-control": "private, no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const timings = createTimings();
  const { workspaceId, userId } = await timings.measure("workspace", workspaceFor(request));
  const [screen, otherBrands] = await timings.measure(
    "reads",
    Promise.all([readOnboardingScreen(workspaceId, new Date()), readOtherBrands(userId)]),
  );
  if (screen.on.length + screen.maybes.length > 0) {
    await timings.measure("ready", markCompetitorsReady(workspaceId, new Date().toISOString()));
  }
  return data({ ...screen, otherBrands }, { headers: timings.header() });
}

export async function action({ request }: Route.ActionArgs) {
  const { workspaceId, userId } = await workspaceFor(request, true);
  const form = await request.formData();
  if (startWatchingForm.safeParse(Object.fromEntries(form)).success) {
    const now = new Date().toISOString();
    await ensureOnboardingRun({ workspaceId, userId, now });
    await markWatchingStarted(workspaceId, now);
    throw redirect("/onboarding/plan");
  }
  return handleCompetitorIntent(workspaceId, form);
}

function useDiscoveryPolling(discovery: DiscoveryState): DiscoveryState {
  const [polls, setPolls] = useState(0);
  const stalled = polls >= MAX_POLLS;
  const searching = discovery === "looking" && !stalled;
  const revalidator = useRevalidator();
  const navigation = useNavigation();

  useEffect(() => {
    if (!searching) return;
    const id = setInterval(() => {
      setPolls((count) => count + 1);
      if (revalidator.state === "idle" && navigation.state === "idle") void revalidator.revalidate();
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [navigation, revalidator, searching]);

  return stalled && discovery === "looking" ? "unavailable" : discovery;
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { on, maybes, discovery, otherBrands } = loaderData;
  const navigation = useNavigation();
  const starting = navigation.state !== "idle" && navigation.formData?.get("intent") === "start";
  const state = useDiscoveryPolling(discovery);
  const notice = discoveryNotice(state, on.length + maybes.length);

  return (
    <OnboardingFrame step={3} heading="Your competitors" otherBrands={otherBrands}>
      {notice === null ? null : (
        <p role="status" className="mt-3 max-w-prose leading-[1.55] text-ink-soft">
          {notice}
        </p>
      )}
      {state === "looking" && on.length + maybes.length === 0 ? <DiscoverySkeleton /> : null}
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
      <AddCompetitor message={actionData?.message} unreachable={actionData?.unreachable} />
      <Form method="post" className="mt-12 border-t border-line pt-8">
        <input type="hidden" name="intent" value="start" />
        <Button type="submit" size="lg" disabled={starting}>
          {starting ? "Starting…" : "Start watching"}
        </Button>
        <p className="mt-3 text-body-sm text-ink-soft">
          You can switch any of them on or off later in Competitors. Next you'll choose a plan and start your{" "}
          {String(TRIAL_DAYS)}-day trial.
        </p>
      </Form>
    </OnboardingFrame>
  );
}
