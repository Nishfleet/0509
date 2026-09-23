import type { Route } from "./+types/app.competitors";

import { CompetitorRow, SuggestionRow } from "../components/competitor-rows";
import { EmptyState } from "../components/empty-state";
import {
  acceptSuggestion,
  addCompetitor,
  dismissCompetitor,
  dismissSuggestion,
  listCompetitors,
  setCompetitorState,
} from "../lib/data/competitors.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

const EMPTY = { competitors: [], suggestions: [] };

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function workspaceIdFor(request: Request): Promise<string | null> {
  const session = await requireSession(request);
  return readWorkspaceIdForOwner(session.user.id);
}

export async function loader({ request }: Route.LoaderArgs) {
  const workspaceId = await workspaceIdFor(request);
  if (workspaceId === null) return { ...EMPTY, hasWorkspace: false, notice: null };
  return { ...(await listCompetitors(workspaceId)), hasWorkspace: true, notice: null };
}

export async function action({ request }: Route.ActionArgs) {
  const workspaceId = await workspaceIdFor(request);
  if (workspaceId === null) return { ...EMPTY, hasWorkspace: false, notice: null };

  const form = await request.formData();
  const intent = form.get("intent");
  let notice: string | null = null;

  if (intent === "add") {
    const result = await addCompetitor(workspaceId, field(form, "competitor"));
    if (result.domain) notice = `Now tracking ${result.domain}.`;
    else if (result.pending) notice = `${result.pending} is queued while we confirm its site.`;
    else notice = "Enter a domain or brand name.";
  } else if (intent === "on" || intent === "off") {
    await setCompetitorState(workspaceId, field(form, "entity"), intent);
  } else if (intent === "dismiss-entity") {
    await dismissCompetitor(workspaceId, field(form, "entity"));
  } else if (intent === "accept-suggestion") {
    const { accepted } = await acceptSuggestion(workspaceId, field(form, "suggestion"));
    if (!accepted) notice = "That brand's site could not be confirmed yet.";
  } else if (intent === "dismiss-suggestion") {
    await dismissSuggestion(workspaceId, field(form, "suggestion"));
  }

  return { ...(await listCompetitors(workspaceId)), hasWorkspace: true, notice };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const data = actionData ?? loaderData;
  const tracked = data.competitors.filter((c) => c.state === "on");
  const paused = data.competitors.filter((c) => c.state === "off");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-display-3">Competitors</h1>
      {!data.hasWorkspace ? <p>Your workspace is still being set up.</p> : null}
      {actionData?.notice ? <p role="status">{actionData.notice}</p> : null}

      {data.hasWorkspace ? (
        <form method="post" className="mt-6 flex gap-2">
          <input type="hidden" name="intent" value="add" />
          <input
            name="competitor"
            required
            placeholder="Add a competitor — domain or brand name"
            className="min-w-0 flex-1 border border-line bg-card px-3 py-2"
          />
          <button type="submit" className="border border-ink px-4 py-2 font-semibold">
            Add
          </button>
        </form>
      ) : null}

      <section aria-labelledby="tracked-heading" className="mt-8">
        <h2 id="tracked-heading" className="text-eyebrow uppercase text-ink-soft">
          Tracking
        </h2>
        {tracked.length === 0 ? (
          <EmptyState sentence="No competitors tracked yet. Add one above, or let discovery propose its list on the next weekly run." />
        ) : null}
        <ul className="divide-y divide-line">
          {tracked.map((c) => (
            <CompetitorRow key={c.id} item={c} />
          ))}
        </ul>
      </section>

      {paused.length > 0 ? (
        <section aria-labelledby="paused-heading" className="mt-8">
          <h2 id="paused-heading" className="text-eyebrow uppercase text-ink-soft">
            Off — history kept
          </h2>
          <ul className="divide-y divide-line">
            {paused.map((c) => (
              <CompetitorRow key={c.id} item={c} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="maybe-heading" className="mt-8">
        <h2 id="maybe-heading" className="text-eyebrow uppercase text-ink-soft">
          Maybe
        </h2>
        {data.suggestions.length === 0 ? (
          <EmptyState sentence="Discovery runs weekly. Brands that need your call before tracking lands here." />
        ) : null}
        <ul className="divide-y divide-line">
          {data.suggestions.map((s) => (
            <SuggestionRow key={s.id} item={s} />
          ))}
        </ul>
      </section>
    </main>
  );
}
