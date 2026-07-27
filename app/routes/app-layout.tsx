import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import type { LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";

import { DashboardShell } from "~/components/dashboard-shell";
import { DashboardRouteError } from "~/components/dashboard-route-loading";
import { QuickAddPalette } from "~/components/quick-add-palette";

/** Cmd/Ctrl+K anywhere in /app opens quick-add, except while typing. */
export function isQuickAddShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  target: EventTarget | null;
}) {
  if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) {
    return false;
  }
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (
      target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return false;
    }
  }
  return true;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getCachedWorkspaceForRequest, requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { isOpsUserAllowed } = await import("~/lib/env.server");
  const { presenceNavVisible } = await import("~/lib/presence-internal-access.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const path = new URL(request.url).pathname;

  if (!session.user.onboardedAt && path !== "/app/billing") {
    throw redirect("/app/onboard");
  }

  const workspace = await getCachedWorkspaceForRequest(env, request, session.user.id);
  const showPresenceNav = await presenceNavVisible(env, workspace.workspaceUserId);

  return {
    session,
    showOpsNav: isOpsUserAllowed(env, session.user.email),
    showPresenceNav,
  };
}

export function shouldRevalidate({
  currentUrl,
  defaultShouldRevalidate,
  formMethod,
  nextUrl,
}: ShouldRevalidateFunctionArgs) {
  if (
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search !== nextUrl.search &&
    (!formMethod || formMethod.toLowerCase() === "get")
  ) {
    return false;
  }

  return defaultShouldRevalidate;
}

/**
 * Routes that carry their own Rank-1 primary (brief §5: exactly one ink-filled
 * primary per screen). The shell's standing "+ Add competitor" demotes to
 * Rank 2 there so the page's own primary is the only one in view. BL-009 owns
 * the reports entries; the rest of this shell belongs to BL-017.
 */
export function shellPrimaryIsDemoted(pathname: string) {
  return pathname === "/app/reports" || pathname.startsWith("/app/reports/");
}

export default function AppLayoutRoute() {
  const { session, showOpsNav, showPresenceNav } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const demoteShellPrimary = shellPrimaryIsDemoted(pathname);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const closeQuickAdd = useCallback(() => setQuickAddOpen(false), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isQuickAddShortcut(event)) {
        event.preventDefault();
        setQuickAddOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <DashboardShell
      accountDetail="Competitor intelligence workspace"
      accountLabel="Workspace"
      accountTitle="Five to Nine"
      headerActions={
        <>
          <Link className="f9-secondary-button" prefetch="intent" to="/app">
            Overview
          </Link>
          <button
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+K Control+K"
            className={demoteShellPrimary ? "f9-secondary-button" : "f9-primary-button"}
            onClick={() => setQuickAddOpen(true)}
            type="button"
          >
            + Add competitor
          </button>
        </>
      }
      showOpsNav={showOpsNav}
      showPresenceNav={showPresenceNav}
      userEmail={session.user.email}
      userName={session.user.name}
    >
      {quickAddOpen ? <QuickAddPalette onClose={closeQuickAdd} /> : null}
      <Outlet />
    </DashboardShell>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}
