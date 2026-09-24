import type { Route } from "./+types/app.settings";

import { Link, Outlet } from "react-router";

import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  return { email: session.user.email };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>Settings</h1>
      <p>Signed in as {loaderData.email}</p>
      <p>
        <Link to="/app/settings/card" prefetch="intent">Public card</Link>
      </p>
      <p>
        <Link to="/app/settings/agents" prefetch="intent">Agents and API</Link>
      </p>
      <Outlet />
    </main>
  );
}
