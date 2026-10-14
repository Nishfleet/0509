import type { Route } from "./+types/app.home";

import { data, Link, redirect } from "react-router";

import { FreshnessLine } from "../components/freshness-line";
import { HomePageFrame, HomeStanding } from "../components/home-standing";
import { ShareButton } from "../components/share-button";
import { formatPausedSince } from "../lib/brief-settings";
import { readBriefScheduleForOwner } from "../lib/data/workspace.server";
import { homeView } from "../lib/home-standing";
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
  const { sources, siteFill, howRanked, moves, evidence, firstLook } = await timings.measure(
    "reads",
    readHomeReads(workspaceId, payload, openId),
  );
  return data(
    {
      view: homeView({ ...inputs, moves, now: new Date() }),
      open: openId,
      evidence,
      firstLook,
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

function HomeFooter({ line }: { line: string }) {
  return (
    <>
      <p className="font-mono text-eyebrow text-ink-soft">{line}</p>
      <p className="mt-1">
        <Link className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4" to="/app/brief">
          Read this week's brief
        </Link>
      </p>
    </>
  );
}

export default function Page({ loaderData }: Route.ComponentProps) {
  useRevalidateOnVisible(loaderData.view.standing.kind !== "ranked");
  return (
    <HomePageFrame eyebrow={loaderData.view.eyebrow} footer={<HomeFooter line={loaderData.view.footer} />}>
      <HomeStanding
        view={loaderData.view}
        howRanked={loaderData.howRanked}
        openId={loaderData.open}
        evidence={loaderData.evidence}
        firstLook={loaderData.firstLook}
        showEyebrow={false}
      />
      {loaderData.siteFill === "pending" || loaderData.siteFill === "gave_up" ? (
        <SiteFillLine state={loaderData.siteFill} />
      ) : null}
      {loaderData.pausedSince === null ? null : <BriefPausedLine since={loaderData.pausedSince} />}
      <FreshnessLine entries={loaderData.freshness} />
      {loaderData.view.standing.kind === "ranked" ? <ShareButton /> : null}
    </HomePageFrame>
  );
}
