import { env } from "cloudflare:workers";
import { Suspense, useState } from "react";
import { Await, data, redirect, useFetcher } from "react-router";

import { IdentityCardFields } from "../components/identity-card";
import { recordIdentityEdits } from "../lib/data/user-decision.server";
import { workspaceForUser } from "../lib/data/workspace.server";
import { buildCardFromRequest } from "../lib/identity/card.server";
import type { CardResult } from "../lib/identity/card-types";
import { requireSession } from "../lib/require-session.server";
import type { Route } from "./+types/onboarding.identity";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const url = new URL(request.url);
  const input = url.searchParams.get("input")?.trim() ?? "";
  const workspaceId = await workspaceForUser(session.user.id);

  if (!input) return data({ workspaceId, card: null as Promise<CardResult> | null });

  const card = buildCardFromRequest({ workspaceId, userId: session.user.id, input });
  return data({ workspaceId, card });
}

const s = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const form = await request.formData();
  const workspaceId = s(form.get("workspaceId"));
  const entityId = s(form.get("entityId"));
  const runId = s(form.get("onboardingRunId"));
  const domain = s(form.get("domain"));
  const homepageUrl = s(form.get("homepageUrl")) || null;
  const edits = JSON.parse(s(form.get("edits")) || "{}") as Record<string, string>;

  await recordIdentityEdits({ workspaceId, userId: session.user.id, entityId, edits });

  await env.IDENTITY_TAIL.create({
    id: `identity-${entityId}`,
    params: { workspaceId, entityId, onboardingRunId: runId, domain, homepageUrl },
  });
  return redirect("/app/competitors");
}

export default function Onboarding({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher();
  const [edits, setEdits] = useState<Record<string, string>>({});

  return (
    <main>
      <h1>Your brand</h1>
      <fetcher.Form method="get" action="/onboarding">
        <input
          name="input"
          placeholder="your website, or a handle"
          defaultValue=""
          required
        />
        <button type="submit">Find it</button>
      </fetcher.Form>

      {loaderData.card ? (
        <Suspense fallback={<p role="status">Looking it up — the card draws itself as sources answer…</p>}>
          <Await resolve={loaderData.card}>
            {(card: CardResult) =>
              card.ok ? (
                <fetcher.Form method="post">
                  <input type="hidden" name="workspaceId" value={loaderData.workspaceId} />
                  <input type="hidden" name="entityId" value={card.entityId} />
                  <input type="hidden" name="onboardingRunId" value={card.onboardingRunId} />
                  <input type="hidden" name="domain" value={card.subject.registrable ?? card.subject.handle ?? ""} />
                  <input type="hidden" name="homepageUrl" value={card.subject.url ?? ""} />
                  <input type="hidden" name="edits" value={JSON.stringify(edits)} />
                  <IdentityCardFields
                    fields={card.fields}
                    onEdit={(name, value) => { setEdits((e) => ({ ...e, [name]: value })); }}
                  />
                  <button type="submit">That&apos;s me</button>
                </fetcher.Form>
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
