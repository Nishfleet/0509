import { Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";

import { DashboardShell } from "~/components/dashboard-shell";
import { DashboardRouteError } from "~/components/dashboard-route-loading";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { isOpsUserAllowed } = await import("~/lib/env.server");
  const { presenceNavVisible } = await import("~/lib/presence-internal-access.server");
  const { resolveWorkspace } = await import("~/lib/workspace.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);

  if (!session.user.onboardedAt) {
    throw redirect("/app/onboard");
  }

  const workspace = await resolveWorkspace(env, session.user.id);
  const showPresenceNav = await presenceNavVisible(env, workspace.workspaceUserId);

  return {
    session,
    showOpsNav: isOpsUserAllowed(env, session.user.email),
    showPresenceNav,
  };
}

export default function AppLayoutRoute() {
  const { session, showOpsNav, showPresenceNav } = useLoaderData<typeof loader>();

  return (
    <DashboardShell
      accountDetail="Competitor intelligence workspace"
      accountLabel="Workspace"
      accountTitle="Five to Nine"
      headerActions={
        <>
          <Link className="f9-secondary-button" to="/app">
            Overview
          </Link>
          <Link className="f9-primary-button" to="/search">
            Add competitor
          </Link>
        </>
      }
      showOpsNav={showOpsNav}
      showPresenceNav={showPresenceNav}
      userEmail={session.user.email}
      userName={session.user.name}
    >
      <Outlet />
    </DashboardShell>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}
