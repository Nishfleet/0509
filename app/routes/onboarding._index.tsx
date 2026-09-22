import type { Route } from "./+types/onboarding._index";

import { redirect } from "react-router";

import { StepBar } from "../components/onboarding/step-bar";
import { OneInput } from "../components/one-input";
import { requireSession } from "../lib/require-session.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";

const STEPS = ["one input", "your card", "who you're up against"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  // The self-entity bounce the placeholder route had: a workspace that already
  // has its own entity does not belong on screen 1, it belongs on /app. /app
  // redirects here while the entity is missing, and this closes the loop the
  // other way. (docs/FEATURE-MAP.md's /onboarding row keeps documenting it.)
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (!landing) throw redirect("/app");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  await requireSession(request);
  const form = await request.formData();
  const subject = form.get("subject");
  const input = typeof subject === "string" ? subject.trim() : "";
  // The submission counter is what makes "the input stays focused" true on a
  // repeat submit: `notFound` alone cannot distinguish the second whitespace
  // submit from the first.
  if (!input) return { notFound: true, submitId: ++notFoundSubmits };
  return redirect(`/onboarding/identity?input=${encodeURIComponent(input)}`);
}

// Module-scoped on purpose: it is a per-process monotonic marker for the
// not-found branch's identity, not request state.
let notFoundSubmits = 0;

export default function OnboardingScreenOne({ actionData }: Route.ComponentProps) {
  const notFound = Boolean(actionData && "notFound" in actionData && actionData.notFound);
  const submitId =
    actionData && "submitId" in actionData && typeof actionData.submitId === "number"
      ? actionData.submitId
      : 0;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[52rem] flex-col gap-8 px-6 py-12 sm:px-10 sm:py-16">
      <StepBar steps={STEPS} current={1} />
      <OneInput
        label="your website, or a handle"
        action="/onboarding"
        notFound={notFound}
        notFoundKey={submitId}
      />
    </main>
  );
}
