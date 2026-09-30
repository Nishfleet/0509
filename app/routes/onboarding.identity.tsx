import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/onboarding.identity";

import { captureException } from "@sentry/cloudflare";
import { data, redirect } from "react-router";

import { IdentityCard } from "../components/identity-card";
import { OnboardingFrame } from "../components/onboarding-frame";
import { OneInput } from "../components/one-input";
import { isTakenDown } from "../lib/data/takedown.server";
import { startOnboardingRun } from "../lib/data/onboarding_run.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { executionContext } from "../lib/agent/context.server";
import { creatorRows, editedFields, isDraftSave } from "../lib/identity/card-fields";
import { applyDraftIntent, readDraft } from "../lib/identity/card-draft.server";
import { startCard, withinProbeLimit } from "../lib/identity/card.server";
import { confirmCardLater } from "../lib/identity/confirm.server";
import { normaliseSubject } from "../lib/identity/normalise";
import { screenOnboardingSubject } from "../lib/onboarding-screen.server";
import { timeCard } from "../lib/onboarding/card-timing.server";
import { requireFreshSession, requireSession } from "../lib/require-session.server";
import { createTimings } from "../lib/server-timing.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";

export async function loader({ request }: Route.LoaderArgs) {
  const timings = createTimings();
  const session = await timings.measure("session", requireSession(request));
  const landing = await timings.measure("landing", workspaceLandingForRequest(request, session.user));
  if (!landing) throw redirect("/app");
  const raw = new URL(request.url).searchParams.get("subject") ?? "";
  const normalised = normaliseSubject(raw);
  if (!normalised.ok) return { card: null, limited: false };
  const { subject } = normalised;
  const [taken, workspaceId] = await Promise.all([
    isTakenDown(subject.registrable),
    readWorkspaceIdForOwner(session.user.id),
  ]);
  if (taken || workspaceId === null) throw redirect("/onboarding");
  const now = new Date().toISOString();
  const screened = await timings.measure(
    "screen",
    screenOnboardingSubject({ workspaceId, userId: session.user.id, subject, raw, answer: null, now }),
  );
  if (screened.kind !== "proceed") throw redirect("/onboarding");
  const [, withinLimit, draft] = await Promise.all([
    timings.measure("run", startOnboardingRun({ workspaceId, userId: session.user.id, inputRaw: raw, startedAt: now })),
    withinProbeLimit(session.user.id),
    readDraft(workspaceId, subject.registrable),
  ]);
  if (!withinLimit) return { card: null, limited: true };
  const shown = subject.kind === "domain" ? subject.registrable : (subject.url ?? `@${subject.registrable}`);
  return data(
    {
      card: {
        subject: raw,
        creator: creatorRows(subject),
        domain: shown,
        ...timeCard(workspaceId, startCard(workspaceId, subject, editedFields(draft))),
        draft,
      },
      limited: false,
    },
    { headers: timings.header() },
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const timings = createTimings();
  const session = await timings.measure("session", requireFreshSession(request));
  const workspaceId = await timings.measure("workspace", readWorkspaceIdForOwner(session.user.id));
  if (workspaceId === null) throw redirect("/onboarding");
  const form = await request.formData();
  if (await applyDraftIntent(workspaceId, form)) return null;
  const rawSubject = form.get("subject");
  if (typeof rawSubject === "string") {
    const normalised = normaliseSubject(rawSubject);
    if (normalised.ok) {
      const screened = await timings.measure(
        "screen",
        screenOnboardingSubject({
          workspaceId,
          userId: session.user.id,
          subject: normalised.subject,
          raw: rawSubject,
          answer: null,
          now: new Date().toISOString(),
        }),
      );
      if (screened.kind !== "proceed") throw redirect("/onboarding");
    }
  }
  const startTail = await timings.measure("confirm", confirmCardLater(workspaceId, session.user.id, form));
  if (startTail !== null) {
    context.get(executionContext).waitUntil(
      startTail().catch((error: unknown) => {
        captureException(error, { tags: { step: "identity-tail-start" } });
      }),
    );
    throw redirect("/onboarding/competitors", { headers: timings.header() });
  }
  return { message: "Add your brand's name, then tap That's me." };
}

export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return isDraftSave(formData) ? false : defaultShouldRevalidate;
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { card, limited } = loaderData;
  const message = limited
    ? "That's a lot of lookups in a minute. Wait a minute, then try again."
    : "We couldn't find anything for that, try the main website.";
  return (
    <OnboardingFrame
      step={2}
      heading={card === null ? "Start with your website or a handle" : "This is you. Fix anything we got wrong."}
      hideHeading={card === null}
    >
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
        <IdentityCard
          subject={card.subject}
          domain={card.domain}
          creator={card.creator}
          site={card.site}
          logo={card.logo}
          draft={card.draft}
          message={actionData?.message}
        />
      )}
    </OnboardingFrame>
  );
}
