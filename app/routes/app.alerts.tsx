import type { Route } from "./+types/app.alerts";

import { requireSession } from "../lib/require-session.server";
import { AppShell } from "../components/app-shell";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  return { email: session.user.email };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <AppShell>
      <main>
        <h1>Alerts</h1>
        <p>Signed in as {loaderData.email}</p>
      </main>
    </AppShell>
  );
}
