import type { Route } from "./+types/app.alerts";
import { env } from "cloudflare:workers";

import { readDeliveryFailures } from "../lib/data/alert.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  return {
    email: session.user.email,
    failures: workspaceId === null ? [] : await readDeliveryFailures(env.DB, workspaceId),
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>Alerts</h1>
      <p>Signed in as {loaderData.email}</p>
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
  );
}
