import { useCallback, useEffect, useState } from "react";
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
  const { presenceNavVisible } = await import("~/lib/presence-internal-access.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const workspace = await getCachedWorkspaceForRequest(env, request, session.user.id);
  const showPresenceNav = await presenceNavVisible(env, workspace.workspaceUserId);

  return {
    session,
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

export default function AppLayoutRoute() {
  const { session, showPresenceNav } = useLoaderData<typeof loader>();
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
      onCommandPalette={openQuickAdd}
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
