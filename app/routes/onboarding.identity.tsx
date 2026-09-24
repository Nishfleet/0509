import type { Route } from "./+types/onboarding.identity";

import { redirect } from "react-router";

import { IdentityCard } from "../components/identity-card";
import { OneInput } from "../components/one-input";
import { OnboardingFrame } from "../components/onboarding-frame";
import { isTakenDown } from "../lib/data/takedown.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { startCard, withinProbeLimit } from "../lib/identity/card.server";
import { confirmCard } from "../lib/identity/confirm.server";
import { normaliseSubject } from "../lib/identity/normalise";
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
  if (!(await withinProbeLimit(session.user.id))) return { card: null, limited: true };
  const shown = subject.kind === "domain" ? subject.registrable : (subject.url ?? `@${subject.registrable}`);
  return { card: { subject: raw, domain: shown, ...startCard(subject) }, limited: false };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw redirect("/onboarding");
  if (await confirmCard(workspaceId, await request.formData())) throw redirect("/onboarding/competitors");
  return { message: "Add your brand's name, then tap That's me." };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { card, limited } = loaderData;
  const message = limited
    ? "That's a lot of lookups in a minute. Wait a minute, then try again."
    : "We couldn't find anything for that, try the main website.";
  return (
    <OnboardingFrame step={2} heading="This is you. Fix anything we got wrong.">
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
          site={card.site}
          logo={card.logo}
          message={actionData?.message}
        />
      )}
    </OnboardingFrame>
  );
}
