import type { Route } from "./+types/app.home";

import { data, Link, redirect } from "react-router";

import { FreshnessLine } from "../components/freshness-line";
import { HomePageFrame, HomeStanding } from "../components/home-standing";
import { RivalNudge } from "../components/rival-nudge";
import { ShareButton } from "../components/share-button";
import { formatPausedSince } from "../lib/brief-settings";
import { readBriefScheduleForOwner } from "../lib/data/workspace.server";
import { siteSweepLabel } from "../lib/cadence";
import { isFirstRun, withFirstReadWindow } from "../lib/first-look";
import { homeBriefLink, homeView } from "../lib/home-standing";
import { readHomeReads, resolveOpenId } from "../lib/home-page.server";
import { readHomeStandingInputs } from "../lib/home-standing.server";
import { freshnessEntries } from "../lib/freshness.server";
import { onboardedContext } from "../lib/require-onboarded.server";
import { createTimings } from "../lib/server-timing.server";
import { useRevalidateOnVisible } from "../lib/use-revalidate-on-visible";

export function meta() {
  return [{ title: "Home · Five to Nine" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const timings = createTimings();
  const { session, workspaceId } = context.get(onboardedContext);
  if (workspaceId === null) throw redirect("/onboarding");
  const [inputs, owned] = await timings.measure(
    "standing",
    Promise.all([readHomeStandingInputs(session.user.id, workspaceId), readBriefScheduleForOwner(session.user.id)]),
  );
  if (inputs === null) throw redirect("/onboarding");
  const payload = inputs.payload;
  const openId = resolveOpenId(new URL(request.url).searchParams.get("open"), payload, inputs.entities);
  const { sources, siteFill, howRanked, moves, evidence, firstLook, fewRivals } = await timings.measure(
    "reads",
    readHomeReads(workspaceId, payload, openId),
  );
  const now = new Date();
  const firstRun = payload === null && isFirstRun(firstLook);
  return data(
    {
      view: homeView({ ...inputs, moves, now, firstRun }),
      hasBrief: payload !== null,
      open: openId,
      evidence,
      firstLook: withFirstReadWindow(firstLook, siteSweepLabel(inputs.schedule.timezone, now)),
      fewRivals,
      howRanked,
      freshness: freshnessEntries(sources, Date.now()),
      siteFill,
      pausedSince:
        owned?.schedule.pausedAt == null ? null : formatPausedSince(owned.schedule.pausedAt, owned.schedule.timezone),
    },
    { headers: timings.header() },
  );
}

function SiteFillLine({ state }: { state: "pending" | "gave_up" }) {
  const text =
    state === "pending"
      ? "We couldn't read your site yet. We'll try again every hour for the next day and fill in your details when we can."
      : "We couldn't read your site after a day of trying, so we're keeping the details you entered. Everything else is still being watched.";
  return (
    <p role="status" className="mt-6 text-[0.88rem] text-ink-soft">
      {text}
    </p>
  );
}

function BriefPausedLine({ since }: { since: string }) {
  return (
    <p role="status" className="mt-6 text-[0.88rem] text-ink-soft">
      Your weekly brief has been paused since {since}, so no email is coming.{" "}
      <Link className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4" to="/app/settings">
        Resume it in Settings
      </Link>
    </p>
  );
}

function SetUpLine({ line }: { line: string }) {
  return (
    <p data-home="set-up" className="mt-6 text-[0.88rem] text-ink-soft">
      {line}
    </p>
  );
}

function HomeFooter({ line, hasBrief }: { line: string; hasBrief: boolean }) {
  const brief = homeBriefLink(hasBrief);
  return (
    <>
      <p className="font-mono text-eyebrow text-ink-soft">{line}</p>
      <p className="mt-1">
        <Link className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4" to={brief.to}>
          {brief.label}
        </Link>
      </p>
    </>
  );
}

export default function Page({ loaderData }: Route.ComponentProps) {
  useRevalidateOnVisible(loaderData.view.standing.kind !== "ranked");
  return (
    <HomePageFrame
      eyebrow={loaderData.view.eyebrow}
      footer={<HomeFooter line={loaderData.view.footer} hasBrief={loaderData.hasBrief} />}
    >
      <HomeStanding
        view={loaderData.view}
        howRanked={loaderData.howRanked}
        openId={loaderData.open}
        evidence={loaderData.evidence}
        firstLook={loaderData.firstLook}
        showEyebrow={false}
      />
      {loaderData.view.setUp === null ? null : <SetUpLine line={loaderData.view.setUp} />}
      {loaderData.siteFill === "pending" || loaderData.siteFill === "gave_up" ? (
        <SiteFillLine state={loaderData.siteFill} />
      ) : null}
      {loaderData.pausedSince === null ? null : <BriefPausedLine since={loaderData.pausedSince} />}
      {loaderData.fewRivals === null ? null : <RivalNudge rivals={loaderData.fewRivals} />}
      <FreshnessLine entries={loaderData.freshness} />
      {loaderData.view.standing.kind === "ranked" ? <ShareButton /> : null}
    </HomePageFrame>
  );
}
