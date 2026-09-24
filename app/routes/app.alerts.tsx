import type { Route } from "./+types/app.alerts";
import { env } from "cloudflare:workers";

import { readDeliveryFailures } from "../lib/data/alert.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { daysAgoLabel } from "../lib/delivery-alert";
import { requireSession } from "../lib/require-session.server";
import { AppShell } from "../components/app-shell";
import { BriefView } from "../components/brief-view";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const failures = workspaceId === null ? [] : await readDeliveryFailures(env.DB, workspaceId);
  const now = new Date();
  return {
    email: session.user.email,
    failures: failures.map((failure) => ({ ...failure, when: daysAgoLabel(failure.created_at, now) })),
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">Alerts</h1>
        <p className="text-ink-soft mt-2 leading-[1.65]">Signed in as {loaderData.email}</p>
        {loaderData.failures.length === 0 ? (
          <p className="mt-8 leading-[1.65]">
            Nothing has interrupted you. When your own site breaks you'll get an email; everything else waits here.
          </p>
        ) : (
          loaderData.failures.map((failure) => (
            <article
              key={failure.id}
              id={failure.id}
              data-testid="delivery-failure"
              className="border-line mt-8 border-t pt-6"
            >
              <h2 className="font-display text-lg font-semibold">{failure.title}</h2>
              <p className="mt-2 leading-[1.65]">{failure.body}</p>
              <time
                dateTime={failure.created_at}
                className="text-ink-soft mt-2 block font-mono text-[0.75rem] tracking-[0.04em] uppercase"
              >
                {failure.when}
              </time>
              {failure.brief === null ? null : (
                <details className="mt-4">
                  <summary className="cursor-pointer underline decoration-1 underline-offset-4">
                    Read the brief
                  </summary>
                  <div className="mt-4">
                    <BriefView payload={failure.brief} />
                  </div>
                </details>
              )}
            </article>
          ))
        )}
      </main>
    </AppShell>
  );
}
