import type { Route } from "./+types/onboarding";

import { redirect } from "react-router";

import { requireFreshSession, requireSession, signOutToLogin } from "../lib/require-session.server";
import { ONBOARDING_COMPETITORS, ONBOARDING_PLAN, workspaceLandingForRequest } from "../lib/workspace.server";
import { OneInput } from "../components/one-input";
import { OnboardingFrame } from "../components/onboarding-frame";
import { SubjectConfirm } from "../components/onboarding-subject-confirm";
import { submitOnboardingSubject } from "../lib/onboarding-start.server";
import { createTimings } from "../lib/server-timing.server";
import { useTimezoneCookie } from "../lib/use-timezone-cookie";

export function meta() {
  return [{ title: "Your website or social username · Five to Nine" }];
}

export function headers() {
  return { "cache-control": "private, no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const { landing, workspaceId } = await workspaceLandingForRequest(request, session.user);
  if (workspaceId === null) return await signOutToLogin(request);
  if (landing === null || landing === ONBOARDING_COMPETITORS || landing === ONBOARDING_PLAN) {
    throw redirect(landing ?? "/app");
  }
  return { email: session.user.email };
}

export async function action({ request }: Route.ActionArgs) {
  const timings = createTimings();
  const session = await timings.measure("session", requireFreshSession(request));
  const outcome = await submitOnboardingSubject({
    timings,
    userId: session.user.id,
    formData: await request.formData(),
  });
  if (outcome.status === "home") throw redirect("/app");
  if (outcome.status === "next") throw redirect(outcome.path, { headers: timings.header() });
  return outcome.reply;
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  useTimezoneCookie();
  return (
    <OnboardingFrame step={1} heading="Your website or social username" hideHeading>
      <p className="mt-3 max-w-prose leading-[1.55] text-ink-soft">
        Enter your website address or your social username, like @yourbrand. We'll read it, fill in your details, then
        find your competitors.
      </p>
      <OneInput
        label="Your website address or social username"
        placeholder="yourbrand.com or @yourbrand"
        name="subject"
        action="/onboarding"
        message={actionData?.message ?? undefined}
        submitLabel="Continue"
      />
      {actionData?.confirm ? (
        <SubjectConfirm subject={actionData.confirm.subject} raw={actionData.confirm.raw} />
      ) : null}
      <footer className="mt-16 flex flex-wrap items-center gap-x-4 border-t border-line pt-4 font-mono text-meta text-ink-soft">
        <p className="[overflow-wrap:anywhere]">Signed in as {loaderData.email}</p>
      </footer>
    </OnboardingFrame>
  );
}
