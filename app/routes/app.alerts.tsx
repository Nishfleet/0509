import type { Route } from "./+types/app.alerts";

import { listAlertsForOwner } from "../lib/alerts.server";
import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const alerts = await listAlertsForOwner(session.user.id);
  return { email: session.user.email, alerts };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>Alerts</h1>
      <p>Signed in as {loaderData.email}</p>
      {loaderData.alerts.length === 0 ? (
        <p>Nothing in alerts.</p>
      ) : (
        <ul>
          {loaderData.alerts.map((alert) => (
            <li key={`${alert.createdAt}:${alert.title}`}>
              <p>{alert.title}</p>
              {alert.body ? <p>{alert.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
