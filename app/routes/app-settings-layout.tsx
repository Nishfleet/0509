import type { Route } from "./+types/app-settings-layout";
import { Outlet } from "react-router";

import { AppRouteError } from "../components/app-route-error";
import { AppShell } from "../components/app-shell";
import { NavigationPending } from "../components/navigation-pending";
import { requireSessionMiddleware } from "../lib/require-session.server";

export const middleware: Route.MiddlewareFunction[] = [requireSessionMiddleware];

export function headers() {
  return { "cache-control": "private, no-store" };
}

export default function AppSettingsLayout() {
  return (
    <AppShell>
      <NavigationPending />
      <Outlet />
    </AppShell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <AppRouteError error={error} />;
}
