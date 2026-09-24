import type { Route } from "./+types/app.settings";

import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { BLOCK_HEADING, PAGE, PageHeading } from "../components/page-heading";
import { AddPasskey } from "../components/passkey-button";
import { Button } from "../components/ui/button";
import { authClient } from "../lib/auth-client";
import { requireSession } from "../lib/require-session.server";

export function meta() {
  return [{ title: "Settings · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  return { email: session.user.email };
}

const BLOCK = "border-line mt-10 border-t pt-4";

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main className={PAGE}>
      <PageHeading
        title="Settings"
        lede="Turn tracking for a brand on or off from its switch in Competitors."
      />
      <section aria-labelledby="settings-agents" className={BLOCK}>
        <h2 id="settings-agents" className={BLOCK_HEADING}>
          Agents and API
        </h2>
        <p className="mt-2 max-w-prose leading-[1.55]">
          Let Claude, ChatGPT, Cursor or your own code read your brief, competitors and alerts. They can only read.
        </p>
        <Link
          to="/app/settings/agents"
          prefetch="intent"
          className="font-display mt-3 inline-flex min-h-11 items-center gap-2 font-bold underline decoration-1 underline-offset-4"
        >
          Connect an agent <span aria-hidden="true">→</span>
        </Link>
      </section>
      <section aria-labelledby="settings-account" className={BLOCK}>
        <h2 id="settings-account" className={BLOCK_HEADING}>
          Account
        </h2>
        <p className="mt-2 leading-[1.55] [overflow-wrap:anywhere]">
          Signed in as <strong className="font-semibold">{loaderData.email}</strong>
        </p>
        <div className="mt-2 flex flex-wrap items-start gap-x-6">
          <AddPasskey />
          <SignOut />
        </div>
      </section>
    </main>
  );
}

function SignOut() {
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function signOut() {
    setState("working");
    const result = await authClient.signOut().catch(() => null);
    if (result && !result.error) {
      await navigate("/login");
      return;
    }
    setState("failed");
  }

  return (
    <div>
      <Button type="button" variant="tertiary" onClick={() => void signOut()} disabled={state === "working"}>
        {state === "working" ? "Signing out…" : "Sign out"}
      </Button>
      {state === "failed" ? (
        <p role="alert" className="text-[0.95rem]">
          We couldn't sign you out. Try again.
        </p>
      ) : null}
    </div>
  );
}
