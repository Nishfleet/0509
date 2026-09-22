import { env } from "cloudflare:workers";
import { useState } from "react";
import { data, Form, redirect, useNavigation } from "react-router";
import { z } from "zod";

import { IdentityCardFields } from "../components/identity-card";
import { authClient } from "../lib/auth-client";
import { confirmedSelfEntityForWorkspace, readSelfEntityForWorkspace } from "../lib/data/entity.server";
import { readOnboardingRunForWorkspace } from "../lib/data/onboarding-run.server";
import { readHomeUrlForEntity } from "../lib/data/page.server";
import { priorConfirmationExists, recordIdentityConfirmation } from "../lib/data/user-decision.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { buildCardFromRequest, cardFromIdentityJson } from "../lib/identity/card.server";
import type { CardResult } from "../lib/identity/card-types";
import { requireSession } from "../lib/require-session.server";
import type { Route } from "./+types/onboarding.identity";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (!workspaceId) throw new Error("signed-in user has no workspace");
  if (await confirmedSelfEntityForWorkspace(workspaceId)) throw redirect("/app");

  const entityId = new URL(request.url).searchParams.get("entity")?.trim() ?? "";
  const entity = entityId ? await readSelfEntityForWorkspace(entityId, workspaceId) : null;
  const card = entity ? cardFromIdentityJson(entity.id, entity.identityJson) : null;
  return data({ email: session.user.email, card });
}

const s = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

const EditsSchema = z.record(z.string(), z.string());

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (!workspaceId) throw new Error("signed-in user has no workspace");

  const form = await request.formData();
  const intent = s(form.get("intent"));

  if (intent === "find") {
    const card = await buildCardFromRequest({ workspaceId, userId: session.user.id, input: s(form.get("input")) });
    if (!card.ok) return data({ card });
    return redirect(`/onboarding?entity=${card.entityId}`);
  }

  if (intent !== "confirm") throw new Response("unknown intent", { status: 400 });

  const entityId = s(form.get("entityId"));
  let edits: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(s(form.get("edits")) || "{}");
    edits = EditsSchema.parse(parsed);
  } catch {
    throw new Response("malformed edits payload", { status: 400 });
  }

  const entity = await readSelfEntityForWorkspace(entityId, workspaceId);
  if (!entity) throw new Response("entity not found for this workspace", { status: 404 });
  const card = cardFromIdentityJson(entity.id, entity.identityJson);
  if (!card.ok) throw new Response("stored card is unreadable", { status: 500 });
  const run = await readOnboardingRunForWorkspace(card.onboardingRunId, workspaceId);
  if (!run) throw new Response("onboarding run not found for this workspace", { status: 404 });

  if (!(await priorConfirmationExists(workspaceId, entity.id))) {
    await recordIdentityConfirmation({
      workspaceId,
      userId: session.user.id,
      entityId: entity.id,
      runId: card.onboardingRunId,
      edits,
    });
    const homepageUrl = await readHomeUrlForEntity(entity.id);
    await env.IDENTITY_TAIL.create({
      id: `identity-${card.onboardingRunId}`,
      params: {
        workspaceId,
        userId: session.user.id,
        entityId: entity.id,
        onboardingRunId: card.onboardingRunId,
        domain: entity.domain,
        homepageUrl,
        publicSubject: card.publicSubject,
      },
    });
  }
  return redirect("/app/competitors");
}

export default function Onboarding({ loaderData, actionData }: Route.ComponentProps) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [passkeyState, setPasskeyState] = useState<"idle" | "working" | "added" | "failed">("idle");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const card: CardResult | null = actionData && "card" in actionData ? actionData.card : loaderData.card;

  async function addPasskey() {
    setPasskeyState("working");
    const result = await authClient.passkey.addPasskey().catch(() => null);
    if (result && !result.error) {
      setPasskeyState("added");
      return;
    }
    const code = result?.error && "code" in result.error ? result.error.code : "";
    setPasskeyState(code === "ERROR_CEREMONY_ABORTED" ? "idle" : "failed");
  }

  return (
    <main>
      <h1>Your brand</h1>
      <p>Signed in as {loaderData.email}</p>
      <button type="button" onClick={() => void addPasskey()} disabled={passkeyState === "working"}>
        {passkeyState === "working" ? "Follow the prompt…" : "Add a passkey"}
      </button>
      {passkeyState === "added" ? <p role="status">Passkey added. It can sign you in from now on.</p> : null}
      {passkeyState === "failed" ? <p role="alert">The passkey prompt did not finish. Try again.</p> : null}

      <Form method="post">
        <input type="hidden" name="intent" value="find" />
        <input name="input" placeholder="your website, or a handle" aria-label="your website, or a handle" autoFocus required />
        <button type="submit" disabled={busy}>{busy ? "Looking it up…" : "Find it"}</button>
      </Form>
      {busy ? <p role="status">Looking it up — the card draws itself as sources answer…</p> : null}

      {card ? (
        card.ok ? (
          <Form method="post">
            <input type="hidden" name="intent" value="confirm" />
            <input type="hidden" name="entityId" value={card.entityId} />
            <input type="hidden" name="edits" value={JSON.stringify(edits)} />
            <IdentityCardFields
              fields={card.fields}
              onEdit={(name, value) => { setEdits((e) => ({ ...e, [name]: value })); }}
            />
            {card.publicSubject !== "cleared" ? <p>we track brands and creators, not people — check this card is yours</p> : null}
            <button type="submit" disabled={busy}>That&apos;s me</button>
          </Form>
        ) : (
          <p role="alert">{card.reason === "we track brands and creators, not people" ? card.reason : "we couldn't find anything for that, try the main website"}</p>
        )
      ) : null}
    </main>
  );
}
