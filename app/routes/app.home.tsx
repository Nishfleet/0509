import type { Route } from "./+types/app.home";
import { env } from "cloudflare:workers";

import { useEffect } from "react";
import { Link, redirect, useFetcher, useRevalidator } from "react-router";

import { FreshnessLine } from "../components/freshness-line";
import { HomeStanding } from "../components/home-standing";
import { PAGE } from "../components/page-heading";
import { ShareButton } from "../components/share-button";
import { readWorkspaceMentionSources } from "../lib/data/source.server";
import { readSelfSiteFill } from "../lib/data/entity.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { homeView } from "../lib/home-standing";
import { readHomeStandingInputs } from "../lib/home-standing.server";
import { readHowRanked } from "../lib/how-ranked.server";
import { freshnessEntries } from "../lib/freshness.server";
import { onboardingTimingLines } from "../lib/onboarding/timings";
import { readOnboardingTimes } from "../lib/data/onboarding_run.server";
import { requireSession } from "../lib/require-session.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";

export function meta() {
  return [{ title: "Home · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (landing) throw redirect(landing);
  const inputs = await readHomeStandingInputs(env.DB, session.user.id);
  if (inputs === null) throw redirect("/onboarding");
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const sources = workspaceId === null ? [] : await readWorkspaceMentionSources(workspaceId);
  const siteFill = workspaceId === null ? null : await readSelfSiteFill(workspaceId);
  const howRanked = await readHowRanked(env.DB, inputs.payload);
  const times = workspaceId === null ? null : await readOnboardingTimes(workspaceId);
  return {
    view: homeView({ ...inputs, now: new Date() }),
    howRanked,
    freshness: freshnessEntries(sources, Date.now()),
    siteFill,
    timings: times === null ? [] : onboardingTimingLines(times),
  };
}

function SiteFillLine({ state }: { state: "pending" | "gave_up" }) {
  const text =
    state === "pending"
      ? "Your site didn't let us in yet. We're trying again every hour for a day and will fill your card when it does."
      : "We couldn't read your site in a day of trying, so your card keeps what you entered. Everything else is still watched.";
  return (
    <p role="status" className="text-ink-soft mt-6 text-[0.88rem]">
      {text}
    </p>
  );
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const standingKind = loaderData.view.standing.kind;
  useEffect(() => {
    if (standingKind === "ranked") return;
    function onVisible(): void {
      if (document.visibilityState !== "visible") return;
      if (revalidator.state !== "idle") return;
      void revalidator.revalidate();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [revalidator, standingKind]);
  return (
    <main className={PAGE}>
      <HomeStanding
        view={loaderData.view}
        howRanked={loaderData.howRanked}
        onSwitch={(entityId, checked) =>
          void fetcher.submit(
            { intent: checked ? "on" : "off", entityId },
            { method: "post", action: "/app/competitors" },
          )
        }
      />
      {loaderData.siteFill === "pending" || loaderData.siteFill === "gave_up" ? (
        <SiteFillLine state={loaderData.siteFill} />
      ) : null}
      <FreshnessLine entries={loaderData.freshness} />
      {loaderData.view.standing.kind === "ranked" ? <ShareButton /> : null}
      <footer className="border-line mt-14 border-t pt-7">
        <p className="font-mono text-eyebrow text-ink-soft">{loaderData.view.footer}</p>
        <p className="mt-3">
          <Link className="underline decoration-1 underline-offset-4" to="/app/brief">
            Read this week's brief
          </Link>
        </p>
        {loaderData.timings.length > 0 ? (
          <ul aria-label="Onboarding timings" className="mt-3">
            {loaderData.timings.map((line) => (
              <li key={line} className="font-mono text-eyebrow text-ink-soft">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </footer>
    </main>
  );
}
