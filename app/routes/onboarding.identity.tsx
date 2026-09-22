import { env } from "cloudflare:workers";
import { Suspense, useState } from "react";
import { Await, data, redirect, useFetcher } from "react-router";

import { IdentityCardFields } from "../components/identity-card";
import { buildIdentityCard, type CardResult } from "../lib/identity/card.server";
import { requireSession } from "../lib/require-session.server";
import type { Route } from "./+types/onboarding.identity";

// Identity card engine P5 (#3885): one input -> a streamed, editable card.
// The loader returns the build promise unawaited; React Router streams it and
// the card draws itself when it lands. Every empty field says what fills it.

async function workspaceFor(userId: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT id FROM workspace WHERE owner_user_id = ? LIMIT 1`)
    .bind(userId)
    .first<{ id: string }>();
  if (row) return row.id;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?,?,?,?)`,
  )
    .bind(id, "My workspace", userId, new Date().toISOString())
    .run();
  return id;
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const url = new URL(request.url);
  const input = url.searchParams.get("input")?.trim() ?? "";
  const workspaceId = await workspaceFor(session.user.id);

  if (!input) return data({ workspaceId, card: null as Promise<CardResult> | null });

  const jevUrl = (env as { JEV_URL?: string }).JEV_URL;
  const card = buildIdentityCard(
    {
      db: env.DB,
      cache: env.IDENTITY_CACHE,
      browser: env.BROWSER,
      jev: jevUrl ? { url: jevUrl, apiKey: (env as { JEV_API_KEY?: string }).JEV_API_KEY } : undefined,
    },
    { workspaceId, userId: session.user.id, input },
  );
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

  const now = new Date().toISOString();
  const stmts = Object.entries(edits).map(([field, value]) =>
    env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, entity_id, verdict, note, decided_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), workspaceId, session.user.id, entityId, `identity_edit:${field}`, value, now),
  );
  if (stmts.length) await env.DB.batch(stmts);

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
