import type { Route } from "./+types/app.home";
import { env } from "cloudflare:workers";

import { redirect } from "react-router";

import { HomeStanding } from "../components/home-standing";
import { PAGE } from "../components/page-heading";
import { ShareButton } from "../components/share-button";
import { homeView } from "../lib/home-standing";
import { readHomeStandingInputs } from "../lib/home-standing.server";
import { requireSession } from "../lib/require-session.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (landing) throw redirect(landing);
  const inputs = await readHomeStandingInputs(env.DB, session.user.id);
  if (inputs === null) throw redirect("/onboarding");
  return { view: homeView({ ...inputs, now: new Date() }) };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main className={PAGE}>
      <HomeStanding view={loaderData.view} />
      {loaderData.view.standing.kind === "ranked" ? <ShareButton /> : null}
    </main>
  );
}
