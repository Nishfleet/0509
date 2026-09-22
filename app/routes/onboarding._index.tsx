import type { Route } from "./+types/onboarding._index";

import { redirect } from "react-router";

import { StepBar } from "../components/onboarding/step-bar";
import { OneInput } from "../components/one-input";
import { requireSession } from "../lib/require-session.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";

const STEPS = ["one input", "your card", "who you're up against"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (!landing) throw redirect("/app");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  await requireSession(request);
  const form = await request.formData();
  const subject = form.get("subject");
  const input = typeof subject === "string" ? subject.trim() : "";
  if (!input) return { notFound: true as const };
  return redirect(`/onboarding/identity?input=${encodeURIComponent(input)}`);
}

export default function OnboardingScreenOne({ actionData }: Route.ComponentProps) {
  const notFound = Boolean(actionData?.notFound);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[52rem] flex-col gap-8 px-6 py-12 sm:px-10 sm:py-16">
      <StepBar steps={STEPS} current={1} />
      <OneInput
        label="your website, or a handle"
        action="/onboarding"
        notFound={notFound}
      />
    </main>
  );
}
