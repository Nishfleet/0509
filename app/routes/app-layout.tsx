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
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

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
          <BrandWordmark meta="Account" />
        </Link>

        <div className="f9-app-user">
          <p>{session.user.name}</p>
          <small>{session.user.email}</small>
        </div>

        <nav className="f9-app-nav" aria-label="Account">
          <NavLink end to="/app">
            Dashboard
          </NavLink>
          <NavLink to="/app/collections">Boards</NavLink>
          <NavLink to="/app/watchlists">Watchlists</NavLink>
          <NavLink to="/app/team">Team</NavLink>
          <NavLink to="/app/digests">Digests</NavLink>
          <NavLink to="/app/shares">Shared links</NavLink>
          <NavLink to="/app/billing">Plan &amp; billing</NavLink>
          <NavLink to="/app/account">Account</NavLink>
          <NavLink to="/app/sources">Integrations &amp; API</NavLink>
          {showOpsNav ? <NavLink to="/app/ops">Ops</NavLink> : null}
          <NavLink to="/search">Search</NavLink>
        </nav>

        <div className="f9-app-sidebar-footer">
          <Link className="f9-app-support-link" to="/help">
            Help
          </Link>
          <Link className="f9-app-support-link" to="/docs">
            Docs
          </Link>
          <a className="f9-app-support-link" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          <SignOutButton />
        </div>
      </aside>

      <div className="f9-app-main">
        <header className="f9-app-topbar">
          <Link className="f9-app-search-entry" to="/search">
            Search competitor ads
          </Link>
          <Link className="f9-secondary-button" to="/help">
            Help
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
