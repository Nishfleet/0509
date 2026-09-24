import type { Route } from "./+types/onboarding";

import { Form, redirect } from "react-router";

import { requireSession } from "../lib/require-session.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";
import { OneInput } from "../components/one-input";
import { AddPasskey } from "../components/passkey-button";
import { ONBOARDING_PAGE } from "../components/page-heading";
import { StepBar } from "../components/step-bar";
import { Button } from "../components/ui/button";
import { subjectRedirect } from "../lib/onboarding-subject";
import { isTakenDown } from "../lib/data/takedown.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { normaliseSubject } from "../lib/identity/normalise";
import { screenOnboardingSubject } from "../lib/onboarding-screen.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (!landing) throw redirect("/app");
  return { email: session.user.email };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const formData = await request.formData();
  const raw = formData.get("subject");
  const rawSubject = typeof raw === "string" ? raw : null;
  const answer = formData.get("answer");
  const normalised = rawSubject === null ? null : normaliseSubject(rawSubject);
  if (normalised?.ok && (await isTakenDown(normalised.subject.registrable))) {
    return { message: "This brand asked not to be tracked, so we can't set it up. Try your own website.", confirm: null };
  }
  if (normalised?.ok && rawSubject !== null) {
    const workspaceId = await readWorkspaceIdForOwner(session.user.id);
    if (workspaceId === null) throw redirect("/app");
    const result = await screenOnboardingSubject({
      workspaceId,
      userId: session.user.id,
      subject: normalised.subject,
      raw: rawSubject,
      answer: typeof answer === "string" ? answer : null,
      now: new Date().toISOString(),
    });
    if (result.kind === "refuse" || result.kind === "unavailable") return { message: result.message, confirm: null };
    if (result.kind === "ask") return { message: null, confirm: { subject: result.subject, raw: rawSubject } };
  }
  const target = subjectRedirect(raw);
  if (target) throw redirect(target);
  return { message: "We couldn't find anything for that, try the main website.", confirm: null };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className={ONBOARDING_PAGE}>
      <StepBar current={1} />
      <h1 className="font-display text-display-2 mt-10 font-extrabold uppercase">Start with your website</h1>
      <p className="text-ink-soft mt-3 max-w-prose leading-[1.55]">
        We read it and draw your card, then find who you're up against. A handle like @yourbrand works too.
      </p>
      <OneInput
        label="your website, or a handle"
        placeholder="your website, or a handle"
        name="subject"
        action="/onboarding"
        message={actionData?.message}
        submitLabel="Draw my card"
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
      <footer className="border-line text-ink-soft mt-16 flex flex-wrap items-center gap-x-4 border-t pt-4 font-mono text-meta">
        <p className="[overflow-wrap:anywhere]">Signed in as {loaderData.email}</p>
        <AddPasskey />
      </footer>
    </main>
  );
}
