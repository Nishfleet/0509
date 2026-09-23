import type { Route } from "./+types/onboarding";

import { useState } from "react";
import { redirect } from "react-router";

import { authClient } from "../lib/auth-client";
import { requireSession } from "../lib/require-session.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";
import { OneInput } from "../components/one-input";
import { StepBar } from "../components/step-bar";
import { subjectRedirect } from "../lib/onboarding-subject";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (!landing) throw redirect("/app");
  return { email: session.user.email };
}

export async function action({ request }: Route.ActionArgs) {
  await requireSession(request);
  const target = subjectRedirect((await request.formData()).get("subject"));
  if (target) throw redirect(target);
  return { message: "we couldn't find anything for that, try the main website" };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
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
      <StepBar current={1} />
      <OneInput
        label="your website, or a handle"
        placeholder="your website, or a handle"
        name="subject"
        action="/onboarding"
        message={actionData?.message}
      />
      <p>Signed in as {loaderData.email}</p>
      <button type="button" onClick={() => void addPasskey()} disabled={state === "working"}>
        {state === "working" ? "Follow the prompt…" : "Add a passkey"}
      </button>
      {state === "added" ? <p role="status">Passkey added. It can sign you in from now on.</p> : null}
      {state === "failed" ? <p role="alert">The passkey prompt did not finish. Try again.</p> : null}
    </main>
  );
}
