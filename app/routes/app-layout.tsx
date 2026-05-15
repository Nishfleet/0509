import {
  Link,
  NavLink,
  Outlet,
  redirect,
  useLoaderData,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { SignOutButton } from "~/components/sign-out-button";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { isOpsUserAllowed } = await import("~/lib/env.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);

  if (!session.user.onboardedAt) {
    throw redirect("/app/onboard");
  }

  return {
    session,
    showOpsNav: isOpsUserAllowed(env, session.user.email),
  };
}

export default function AppLayoutRoute() {
  const { session, showOpsNav } = useLoaderData<typeof loader>();

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <Link className="brand-mark" to="/app">
          <span className="brand-pill" aria-hidden="true">
            09
          </span>
          <span>
            <strong>Five to Nine</strong>
            <small>Workspace</small>
          </span>
        </Link>

        <div className="workspace-user">
          <p>{session.user.name}</p>
          <small>{session.user.email}</small>
        </div>

        <nav className="workspace-nav" aria-label="Workspace">
          <NavLink end to="/app">
            Dashboard
          </NavLink>
          <NavLink to="/app/collections">Collections</NavLink>
          <NavLink to="/app/watchlists">Watchlists</NavLink>
          <NavLink to="/app/digests">Digests</NavLink>
          <NavLink to="/app/sources">Sources</NavLink>
          {showOpsNav ? <NavLink to="/app/ops">Ops</NavLink> : null}
          <NavLink to="/search">Search</NavLink>
        </nav>

        <div className="workspace-sidebar-footer">
          <SignOutButton />
        </div>
      </aside>

      <div className="workspace-main">
        <header className="workspace-topbar">
          <div>
            <p className="eyebrow">Five to Nine workspace</p>
            <h1>Track competitor changes without losing the context.</h1>
          </div>
          <Link className="button button-primary" to="/search">
            New search
          </Link>
        </header>

        <Outlet />
      </div>
    </main>
  );
}
