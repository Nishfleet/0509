import { env } from "cloudflare:workers";
import { Suspense, useState } from "react";
import { Await, data, Form, redirect } from "react-router";

import { IdentityCardFields } from "../components/identity-card";
import { authClient } from "../lib/auth-client";
import { readEntityForWorkspace } from "../lib/data/entity.server";
import { latestOnboardingRunId } from "../lib/data/onboarding-run.server";
import { readHomeUrlForEntity } from "../lib/data/page.server";
import { recordIdentityEdits } from "../lib/data/user-decision.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { buildCardFromRequest } from "../lib/identity/card.server";
import type { CardResult } from "../lib/identity/card-types";
import { requireSession } from "../lib/require-session.server";
import { workspaceLandingForRequest } from "../lib/workspace.server";
import type { Route } from "./+types/onboarding.identity";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user.id);
  if (!landing) throw redirect("/app");
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (!workspaceId) throw new Error("signed-in user has no workspace");

  const url = new URL(request.url);
  const input = url.searchParams.get("input")?.trim() ?? "";
  if (!input) return data({ workspaceId, email: session.user.email, card: null as Promise<CardResult> | null });

  const card = buildCardFromRequest({ workspaceId, userId: session.user.id, input });
  return data({ workspaceId, email: session.user.email, card });
}

const s = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (!workspaceId) throw new Error("signed-in user has no workspace");

  const form = await request.formData();
  const entityId = s(form.get("entityId"));
  const edits = JSON.parse(s(form.get("edits")) || "{}") as Record<string, string>;

  const entity = await readEntityForWorkspace(entityId, workspaceId);
  if (!entity) throw new Response("entity not found for this workspace", { status: 404 });
  const [homepageUrl, runId] = await Promise.all([
    readHomeUrlForEntity(entity.id),
    latestOnboardingRunId(workspaceId),
  ]);
  if (!runId) throw new Error("no onboarding run for this workspace");

  await recordIdentityEdits({ workspaceId, userId: session.user.id, entityId: entity.id, edits });

  await env.IDENTITY_TAIL.create({
    id: `identity-${entity.id}`,
    params: { workspaceId, entityId: entity.id, onboardingRunId: runId, domain: entity.domain, homepageUrl },
  });
  return redirect("/app/competitors");
}

export default function Onboarding({ loaderData }: Route.ComponentProps) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [passkeyState, setPasskeyState] = useState<"idle" | "working" | "added" | "failed">("idle");

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

      <Form method="get" action="/onboarding">
        <input
          name="input"
          placeholder="your website, or a handle"
          aria-label="your website, or a handle"
          autoFocus
          required
        />
        <button type="submit">Find it</button>
      </Form>

      {loaderData.card ? (
        <Suspense fallback={<p role="status">Looking it up — the card draws itself as sources answer…</p>}>
          <Await resolve={loaderData.card}>
            {(card: CardResult) =>
              card.ok ? (
                <Form method="post">
                  <input type="hidden" name="entityId" value={card.entityId} />
                  <input type="hidden" name="edits" value={JSON.stringify(edits)} />
                  <IdentityCardFields
                    fields={card.fields}
                    onEdit={(name, value) => { setEdits((e) => ({ ...e, [name]: value })); }}
                  />
                  <button type="submit">That&apos;s me</button>
                </Form>
              ) : (
                <p role="alert">
                  {card.reason === "we track brands and creators, not people"
                    ? card.reason
                    : "we couldn't find anything for that, try the main website"}
                </p>
              )
            }
          </Await>
        </Suspense>
      ) : null}
    </main>
  );
}
