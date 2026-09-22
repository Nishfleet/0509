import type { Route } from "./+types/app.home";

import { useState } from "react";

import { SourcePills } from "../components/mention-row";
import { authClient } from "../lib/auth-client";
import { loadSourceLines } from "../lib/data/mentions.server";
import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const sources = await loadSourceLines(session.user.id);
  return { email: session.user.email, sources };
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
    <main>
      <h1>Home</h1>
      <p>Signed in as {loaderData.email}</p>
      <SourcePills lines={loaderData.sources.lines} allDown={loaderData.sources.allDown} />
      <button type="button" onClick={() => void addPasskey()} disabled={state === "working"}>
        {state === "working" ? "Follow the prompt…" : "Add a passkey"}
      </button>
      {state === "added" ? <p role="status">Passkey added. It can sign you in from now on.</p> : null}
      {state === "failed" ? <p role="alert">The passkey prompt did not finish. Try again.</p> : null}
    </main>
  );
}
