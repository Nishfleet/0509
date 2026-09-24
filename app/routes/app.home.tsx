import type { Route } from "./+types/app.home";
import { env } from "cloudflare:workers";

import { useState } from "react";
import { redirect } from "react-router";

import { HomeStanding } from "../components/home-standing";
import { ShareButton } from "../components/share-button";
import { authClient } from "../lib/auth-client";
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
  return { email: session.user.email, view: homeView({ ...inputs, now: new Date() }) };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const [state, setState] = useState<"idle" | "working" | "added" | "failed">("idle");

  async function addPasskey() {
    setState("working");
    const result = await authClient.passkey.addPasskey().catch(() => null);
    if (result && !result.error) {
      setState("added");
      return;
    }
    const code = result?.error && "code" in result.error ? result.error.code : "";
    setState(code === "ERROR_CEREMONY_ABORTED" ? "idle" : "failed");
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <HomeStanding view={loaderData.view} />
      {loaderData.view.standing.kind === "ranked" ? <ShareButton /> : null}
      <footer className="border-line mt-10 border-t pt-4">
        <p className="text-ink-soft leading-[1.65]">Signed in as {loaderData.email}</p>
        <button
          type="button"
          className="font-display mt-3 border-[1.5px] border-ink px-3 py-2 uppercase"
          onClick={() => void addPasskey()}
          disabled={state === "working"}
        >
          {state === "working" ? "Follow the prompt…" : "Add a passkey"}
        </button>
        {state === "added" ? <p role="status">Passkey added. It can sign you in from now on.</p> : null}
        {state === "failed" ? <p role="alert">The passkey prompt did not finish. Try again.</p> : null}
      </footer>
    </main>
  );
}
