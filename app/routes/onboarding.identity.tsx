import type { Route } from "./+types/onboarding.identity";

import { useState } from "react";
import { redirect } from "react-router";

import { authClient } from "../lib/auth-client";
import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const input = new URL(request.url).searchParams.get("input")?.trim() ?? "";
  if (!input) throw redirect("/onboarding");
  return { email: session.user.email, input };
}

export default function OnboardingIdentity({ loaderData }: Route.ComponentProps) {
  const [passkeyState, setPasskeyState] = useState<"idle" | "working" | "added" | "failed">("idle");

  async function addPasskey() {
    setPasskeyState("working");
    const result = await authClient.passkey.addPasskey().catch(() => null);
    if (result && !result.error) {
      setPasskeyState("added");
      return;
    }
    const code = result?.error && "code" in result.error ? result.error.code : "";
    setPasskeyState(code === "ERROR_CEREMONY_ABORTED" ? "idle" : "failed");
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[52rem] flex-col gap-8 px-6 py-12 sm:px-10 sm:py-16">
      <p className="font-mono text-meta break-words text-ink-soft">
        {loaderData.input}
      </p>
      <p className="font-mono text-meta text-ink-soft">
        Signed in as {loaderData.email}
      </p>
      <button
        type="button"
        onClick={() => void addPasskey()}
        disabled={passkeyState === "working"}
        className="self-start border border-line bg-card px-4 py-2 font-display text-[0.9rem] font-bold uppercase tracking-[0.02em] text-ink"
      >
        {passkeyState === "working" ? "Follow the prompt…" : "Add a passkey"}
      </button>
      {passkeyState === "added" ? (
        <p role="status" className="font-mono text-meta text-ink-soft">
          Passkey added. It can sign you in from now on.
        </p>
      ) : null}
      {passkeyState === "failed" ? (
        <p role="alert" className="font-mono text-meta text-ink-soft">
          The passkey prompt did not finish. Try again.
        </p>
      ) : null}
    </main>
  );
}
