import type { Route } from "./+types/app.home";
import { env } from "cloudflare:workers";

import { useEffect } from "react";
import { data, Link, redirect, useFetcher, useRevalidator } from "react-router";

import { FreshnessLine } from "../components/freshness-line";
import { HomePageFrame, HomeStanding } from "../components/home-standing";
import { ShareButton } from "../components/share-button";
import { readWorkspaceMentionSources } from "../lib/data/source.server";
import { readSelfSiteFill } from "../lib/data/entity.server";
import { readWeekEvidence } from "../lib/data/signal.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { homeView } from "../lib/home-standing";
import { readHomeStandingInputs } from "../lib/home-standing.server";
import { readHowRanked } from "../lib/how-ranked.server";
import { freshnessEntries } from "../lib/freshness.server";
import { onboardingTimingLines } from "../lib/onboarding/timings";
import { readOnboardingTimes } from "../lib/data/onboarding_run.server";
import { requireSession } from "../lib/require-session.server";
import { createTimings } from "../lib/server-timing.server";
import { readBiggestSiteChanges } from "../lib/site-changes.server";

export function meta() {
  return [{ title: "Home · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const timings = createTimings();
  const session = await timings.measure("session", requireSession(request));
  const [inputs, workspaceId] = await timings.measure(
    "standing",
    Promise.all([readHomeStandingInputs(env.DB, session.user.id), readWorkspaceIdForOwner(session.user.id)]),
  );
  if (inputs === null) throw redirect("/onboarding");
  const payload = inputs.payload;
  const open = new URL(request.url).searchParams.get("open");
  const openId =
    open !== null && payload !== null && inputs.entities.some((entity) => entity.id === open) ? open : null;
  const [sources, siteFill, howRanked, moves, times, evidence] = await timings.measure(
    "reads",
    Promise.all([
      workspaceId === null ? [] : readWorkspaceMentionSources(workspaceId),
      workspaceId === null ? null : readSelfSiteFill(workspaceId),
      readHowRanked(env.DB, payload),
      payload === null || workspaceId === null ? [] : readBiggestSiteChanges(workspaceId, payload.period_start),
      workspaceId === null ? null : readOnboardingTimes(workspaceId),
      openId !== null && payload !== null && workspaceId !== null
        ? readWeekEvidence({ workspaceId, entityId: openId, since: payload.period_start })
        : null,
    ]),
  );
  return data(
    {
      view: homeView({ ...inputs, moves, now: new Date() }),
      open: openId,
      evidence,
      howRanked,
      freshness: freshnessEntries(sources, Date.now()),
      siteFill,
      timings: times === null ? [] : onboardingTimingLines(times),
    },
    { headers: timings.header() },
  );
}

function SiteFillLine({ state }: { state: "pending" | "gave_up" }) {
  const text =
    state === "pending"
      ? "Your site didn't let us in yet. We're trying again every hour for a day and will fill your card when it does."
      : "We couldn't read your site in a day of trying, so your card keeps what you entered. Everything else is still watched.";
  return (
    <p role="status" className="mt-6 text-[0.88rem] text-ink-soft">
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
    <HomePageFrame
      eyebrow={loaderData.view.eyebrow}
      footer={
        <>
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
        </>
      }
    >
      <HomeStanding
        view={loaderData.view}
        howRanked={loaderData.howRanked}
        openId={loaderData.open}
        evidence={loaderData.evidence}
        showEyebrow={false}
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
    </HomePageFrame>
  );
}
