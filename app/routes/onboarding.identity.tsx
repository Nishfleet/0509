import type { Route } from "./+types/onboarding.identity";

import { redirect } from "react-router";

import { IdentityCard } from "../components/identity-card";
import { OneInput } from "../components/one-input";
import { ONBOARDING_PAGE } from "../components/page-heading";
import { StepBar } from "../components/step-bar";
import { isTakenDown } from "../lib/data/takedown.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { readDraft, saveDraftField } from "../lib/identity/card-draft.server";
import { startCard, withinProbeLimit } from "../lib/identity/card.server";
import { confirmCard } from "../lib/identity/confirm.server";
import { normaliseSubject } from "../lib/identity/normalise";
import { screenOnboardingSubject } from "../lib/onboarding-screen.server";
import { requireSession } from "../lib/require-session.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (!landing) throw redirect("/app");
  const raw = new URL(request.url).searchParams.get("subject") ?? "";
  const normalised = normaliseSubject(raw);
  if (!normalised.ok) return { card: null, limited: false };
  const { subject } = normalised;
  if (await isTakenDown(subject.registrable)) throw redirect("/onboarding");
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  const screened = await screenOnboardingSubject({
    workspaceId,
    userId: session.user.id,
    subject,
    raw,
    answer: null,
    now: new Date().toISOString(),
  });
  if (screened.kind !== "proceed") throw redirect("/onboarding");
  if (!(await withinProbeLimit(session.user.id))) return { card: null, limited: true };
  const shown = subject.kind === "domain" ? subject.registrable : (subject.url ?? `@${subject.registrable}`);
  return {
    card: {
      subject: raw,
      domain: shown,
      ...startCard(workspaceId, subject),
      draft: await readDraft(workspaceId, subject.registrable),
    },
    limited: false,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  const form = await request.formData();
  if (form.get("intent") === "draft") {
    const draftSubject = form.get("subject");
    const field = form.get("field");
    const value = form.get("value");
    if (
      typeof draftSubject === "string" &&
      (field === "name" || field === "description") &&
      typeof value === "string"
    ) {
      const normalised = normaliseSubject(draftSubject);
      if (normalised.ok) {
        await saveDraftField(workspaceId, normalised.subject.registrable, field, value);
      }
    }
    return null;
  }
  const rawSubject = form.get("subject");
  if (typeof rawSubject === "string") {
    const normalised = normaliseSubject(rawSubject);
    if (normalised.ok) {
      const screened = await screenOnboardingSubject({
        workspaceId,
        userId: session.user.id,
        subject: normalised.subject,
        raw: rawSubject,
        answer: null,
        now: new Date().toISOString(),
      });
      if (screened.kind !== "proceed") throw redirect("/onboarding");
    }
  }
  if (await confirmCard(workspaceId, session.user.id, form)) throw redirect("/onboarding/competitors");
  return { message: "Add your brand's name, then tap That's me." };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { card, limited } = loaderData;
  const message = limited
    ? "That's a lot of lookups in a minute. Wait a minute, then try again."
    : "We couldn't find anything for that, try the main website.";
  return (
    <main className={ONBOARDING_PAGE}>
      <StepBar current={2} />
      {card === null ? (
        <OneInput
          label="your website, or a handle"
          placeholder="your website, or a handle"
          name="subject"
          action="/onboarding"
          message={message}
          submitLabel="Draw my card"
        />
      ) : (
        <>
          <h1 className="font-display text-display-2 mt-10 font-extrabold uppercase">
            This is you. Fix anything we got wrong.
          </h1>
          <IdentityCard
            subject={card.subject}
            domain={card.domain}
            site={card.site}
            logo={card.logo}
            draft={card.draft}
            message={actionData?.message}
          />
        </>
      )}
    </main>
  );
}
