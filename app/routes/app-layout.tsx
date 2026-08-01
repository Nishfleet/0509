import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import type { LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";

import { DashboardShell } from "~/components/dashboard-shell";
import { DashboardRouteError } from "~/components/dashboard-route-loading";
import { QuickAddPalette } from "~/components/quick-add-palette";
import { QuickAddProvider } from "~/components/quick-add-context";

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
 * the reports entries and BL-014 the collections entry; the rest of this shell
 * belongs to BL-017.
 *
 * §5 is a SCREEN contract, not a component one: counting only the child route
 * hides the shell's own ink primary. `/app/collections` renders its own Rank-1
 * on the gated, first-run and nothing-filed states, so the shell demotes
 * across the whole route — which also leaves the populated board at zero
 * primaries, legitimate per §5 because reading saved evidence is not a CTA and
 * creating another collection is a Rank-2 reveal (§7).
 */
export function shellPrimaryIsDemoted(pathname: string) {
  return (
    pathname === "/app/reports" ||
    pathname.startsWith("/app/reports/") ||
    pathname === "/app/collections" ||
    pathname === "/app"
  );
}

/**
 * BL-030 / BL-040 - surfaces rebuilt in the landing language own their whole page,
 * header included: a working header is title left / one action inline right /
 * one context line, and a second right-aligned action band floating above it
 * is the "chrome explaining chrome" the concept deleted. Every other route
 * still runs on the old shell topbar until its phase lands, which is what the
 * coexistence proof in the BL-030 report shows.
 */
export function shellTopbarIsSuppressed(pathname: string) {
  const normalizedPathname =
    pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  return (
    normalizedPathname === "/app" ||
    normalizedPathname === "/app/watchlists" ||
    normalizedPathname === "/app/source-access" ||
    normalizedPathname === "/app/developer-access"
  );
}

export default function AppLayoutRoute() {
  const { session, showOpsNav, showPresenceNav } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const demoteShellPrimary = shellPrimaryIsDemoted(pathname);
  const hideTopbar = shellTopbarIsSuppressed(pathname);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const closeQuickAdd = useCallback(() => setQuickAddOpen(false), []);
  const openQuickAdd = useCallback(() => setQuickAddOpen(true), []);

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
        hideTopbar ? null : (
          <>
            <Link className="f9-secondary-button" prefetch="intent" to="/app">
              Overview
            </Link>
            <button
              aria-haspopup="dialog"
              aria-keyshortcuts="Meta+K Control+K"
              className={demoteShellPrimary ? "f9-secondary-button" : "f9-primary-button"}
              onClick={openQuickAdd}
              type="button"
            >
              + Add competitor
            </button>
          </>
        )
      }
      onCommandPalette={openQuickAdd}
      showOpsNav={showOpsNav}
      showPresenceNav={showPresenceNav}
      userEmail={session.user.email}
      userName={session.user.name}
    >
      <QuickAddProvider open={openQuickAdd}>
        {quickAddOpen ? <QuickAddPalette onClose={closeQuickAdd} /> : null}
        <Outlet />
      </QuickAddProvider>
    </DashboardShell>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}
