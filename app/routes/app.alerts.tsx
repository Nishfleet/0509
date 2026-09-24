import type { Route } from "./+types/app.alerts";
import { env } from "cloudflare:workers";

import { readDeliveryFailures, readTakedownNotes } from "../lib/data/alert.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";
import { AppShell } from "../components/app-shell";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  return {
    email: session.user.email,
    failures: workspaceId === null ? [] : await readDeliveryFailures(env.DB, workspaceId),
    notes: workspaceId === null ? [] : await readTakedownNotes(env.DB, workspaceId),
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <AppShell>
      <main>
        <h1>Alerts</h1>
        <p>Signed in as {loaderData.email}</p>
        {loaderData.notes.map((note) => (
          <article key={note.id} id={note.id} data-testid="takedown-note">
            <p>{note.title}</p>
            <time dateTime={note.created_at}>{note.created_at}</time>
          </article>
        ))}
        {loaderData.failures.map((failure) => (
          <article key={failure.id} id={failure.id} data-testid="delivery-failure">
            <h2>{failure.title}</h2>
            <p>{failure.body}</p>
            <time dateTime={failure.created_at}>{failure.created_at}</time>
            <details>
              <summary>Read the brief</summary>
              <pre className="whitespace-pre-wrap">{failure.brief_text}</pre>
            </details>
          </article>
        ))}
      </main>
    </AppShell>
  );
}
