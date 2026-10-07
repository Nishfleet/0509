import type { Route } from "./+types/app-layout";
import { Outlet } from "react-router";

import { AppRouteError } from "../components/app-route-error";
import { AppShell } from "../components/app-shell";
import { NavigationPending } from "../components/navigation-pending";
import { requireOnboarded } from "../lib/require-onboarded.server";

export const middleware: Route.MiddlewareFunction[] = [requireOnboarded];

export function headers() {
  return { "cache-control": "private, no-store" };
}

export default function AppLayout() {
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
