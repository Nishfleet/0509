import type { Route } from "./+types/app.settings";

import { Link, Outlet } from "react-router";

import { SignedInFrame } from "../components/nav";
import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  return { email: session.user.email };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <SignedInFrame>
      <main>
        <h1>Settings</h1>
        <p>Signed in as {loaderData.email}</p>
        <p>
          <Link to="/app/settings/card">Public card</Link>
        </p>
        <Outlet />
      </main>
    </SignedInFrame>
  );
}
