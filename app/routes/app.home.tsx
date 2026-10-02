import type { Route } from "./+types/app.home";
import { env } from "cloudflare:workers";

import { data, Link, redirect, useFetcher } from "react-router";

import { FreshnessLine } from "../components/freshness-line";
import { HomePageFrame, HomeStanding } from "../components/home-standing";
import { ShareButton } from "../components/share-button";
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
  const inputs = await timings.measure("standing", readHomeStandingInputs(env.DB, session.user.id, workspaceId));
  if (inputs === null) throw redirect("/onboarding");
  const payload = inputs.payload;
  const openId = resolveOpenId(new URL(request.url).searchParams.get("open"), payload, inputs.entities);
  const { sources, siteFill, howRanked, moves, evidence } = await timings.measure(
    "reads",
    readHomeReads(workspaceId, payload, openId),
  );
  return data(
    {
      view: homeView({ ...inputs, moves, now: new Date() }),
      open: openId,
      evidence,
      howRanked,
      freshness: freshnessEntries(sources, Date.now()),
      siteFill,
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

function HomeFooter({ line }: { line: string }) {
  return (
    <>
      <p className="font-mono text-eyebrow text-ink-soft">{line}</p>
      <p className="mt-3">
        <Link className="underline decoration-1 underline-offset-4" to="/app/brief">
          Read this week's brief
        </Link>
      </p>
    </>
  );
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher();
  useRevalidateOnVisible(loaderData.view.standing.kind !== "ranked");
  return (
    <HomePageFrame eyebrow={loaderData.view.eyebrow} footer={<HomeFooter line={loaderData.view.footer} />}>
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
