import type { Route } from "./+types/onboarding";

import { redirect } from "react-router";

import { requireSession } from "../lib/require-session.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";
import { OneInput } from "../components/one-input";
import { AddPasskey } from "../components/passkey-button";
import { OnboardingFrame } from "../components/onboarding-frame";
import { subjectRedirect } from "../lib/onboarding-subject";
import { isTakenDown } from "../lib/data/takedown.server";
import { normaliseSubject } from "../lib/identity/normalise";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (!landing) throw redirect("/app");
  return { email: session.user.email };
}

export async function action({ request }: Route.ActionArgs) {
  await requireSession(request);
  const raw = (await request.formData()).get("subject");
  const normalised = typeof raw === "string" ? normaliseSubject(raw) : null;
  if (normalised?.ok && (await isTakenDown(normalised.subject.registrable))) {
    return { message: "This brand asked not to be tracked, so we can't set it up. Try your own website." };
  }
  const target = subjectRedirect(raw);
  if (target) throw redirect(target);
  return { message: "We couldn't find anything for that, try the main website." };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <OnboardingFrame step={1} heading="Start with your website or a handle" hideHeading>
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
      <footer className="border-line text-ink-soft mt-16 flex flex-wrap items-center gap-x-4 border-t pt-4 font-mono text-meta">
        <p className="[overflow-wrap:anywhere]">Signed in as {loaderData.email}</p>
        <AddPasskey />
      </footer>
    </OnboardingFrame>
  );
}
