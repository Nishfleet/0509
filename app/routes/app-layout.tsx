import {
  Link,
  NavLink,
  Outlet,
  redirect,
  useLoaderData,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
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
    <main className="f9-app-shell">
      <aside className="f9-app-sidebar">
        <Link className="f9-app-brand" to="/app">
          <BrandWordmark meta="Workspace" />
        </Link>

        <div className="f9-app-user">
          <p>{session.user.name}</p>
          <small>{session.user.email}</small>
        </div>

        <nav className="f9-app-nav" aria-label="Workspace">
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

        <div className="f9-app-sidebar-footer">
          <SignOutButton />
        </div>
      </aside>

      <div className="f9-app-main">
        <header className="f9-app-topbar">
          <Link className="f9-app-search-entry" to="/search">
            Search market moves
          </Link>
          <Link className="f9-primary-button f9-app-new-search" to="/search">
            Add competitor
          </Link>
        </header>

        <Outlet />
      </div>
    </main>
  );
}
