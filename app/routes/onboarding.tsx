import type { Route } from "./+types/onboarding";

import { Form, redirect } from "react-router";

import { requireFreshSession, requireSession } from "../lib/require-session.server";
import { ONBOARDING_COMPETITORS, workspaceLandingForRequest } from "../lib/workspace.server";
import { OneInput } from "../components/one-input";
import { OnboardingFrame } from "../components/onboarding-frame";
import { Button } from "../components/ui/button";
import { subjectRedirect } from "../lib/onboarding-subject";
import { isTakenDown } from "../lib/data/takedown.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { normaliseSubject } from "../lib/identity/normalise";
import { screenOnboardingSubject } from "../lib/onboarding-screen.server";
import { startOnboardingRun } from "../lib/data/onboarding_run.server";
import { createTimings } from "../lib/server-timing.server";

export function meta() {
  return [{ title: "Your website or social username · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user);
  if (landing === null || landing === ONBOARDING_COMPETITORS) throw redirect(landing ?? "/app");
  return { email: session.user.email };
}

type Timings = ReturnType<typeof createTimings>;
type Normalised = ReturnType<typeof normaliseSubject>;
type AcceptedSubject = Extract<Normalised, { ok: true }>["subject"];

function readSubjectForm(formData: FormData) {
  const raw = formData.get("subject");
  const answer = formData.get("answer");
  const rawSubject = typeof raw === "string" ? raw : null;
  return {
    raw,
    rawSubject,
    answer: typeof answer === "string" ? answer : null,
    normalised: rawSubject === null ? null : normaliseSubject(rawSubject),
  };
}

async function readTakenAndWorkspace(timings: Timings, userId: string, normalised: Normalised | null) {
  if (!normalised?.ok) return { taken: false, workspaceId: null };
  const [taken, workspaceId] = await timings.measure(
    "workspace",
    Promise.all([isTakenDown(normalised.subject.registrable), readWorkspaceIdForOwner(userId)]),
  );
  return { taken, workspaceId };
}

interface ScreenInput {
  timings: Timings;
  userId: string;
  workspaceId: string;
  subject: AcceptedSubject;
  rawSubject: string;
  answer: string | null;
}

async function screenAndStart({ timings, userId, workspaceId, subject, rawSubject, answer }: ScreenInput) {
  const now = new Date().toISOString();
  const result = await timings.measure(
    "screen",
    screenOnboardingSubject({ workspaceId, userId, subject, raw: rawSubject, answer, now }),
  );
  if (result.kind === "refuse") return { message: result.message, confirm: null };
  if (result.kind === "ask") return { message: null, confirm: { subject: result.subject, raw: rawSubject } };
  await timings.measure("run", startOnboardingRun({ workspaceId, userId, inputRaw: rawSubject, startedAt: now }));
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const timings = createTimings();
  const session = await timings.measure("session", requireFreshSession(request));
  const { raw, rawSubject, answer, normalised } = readSubjectForm(await request.formData());
  const { taken, workspaceId } = await readTakenAndWorkspace(timings, session.user.id, normalised);
  if (taken) {
    return {
      message: "This brand asked us not to track it, so we can't set it up. Try your own website address.",
      confirm: null,
    };
  }
  if (normalised?.ok && rawSubject !== null) {
    if (workspaceId === null) throw redirect("/app");
    const outcome = await screenAndStart({
      timings,
      userId: session.user.id,
      workspaceId,
      subject: normalised.subject,
      rawSubject,
      answer,
    });
    if (outcome !== null) return outcome;
  }
  const target = subjectRedirect(raw);
  if (target) throw redirect(target, { headers: timings.header() });
  return {
    message:
      "We couldn't find a website or username in that. Try an address like yourbrand.com or a username like @yourbrand.",
    confirm: null,
  };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
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
        <Form method="post" action="/onboarding" className="mt-6 flex flex-col gap-3">
          <p>Is {actionData.confirm.subject} a business or a public creator?</p>
          <input type="hidden" name="subject" value={actionData.confirm.raw} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" name="answer" value="business" size="lg">
              Yes, a business or creator
            </Button>
            <Button type="submit" name="answer" value="person" variant="secondary" size="lg">
              No, it's a person
            </Button>
          </div>
        </Form>
      ) : null}
      <footer className="mt-16 flex flex-wrap items-center gap-x-4 border-t border-line pt-4 font-mono text-meta text-ink-soft">
        <p className="[overflow-wrap:anywhere]">Signed in as {loaderData.email}</p>
      </footer>
    </OnboardingFrame>
  );
}
