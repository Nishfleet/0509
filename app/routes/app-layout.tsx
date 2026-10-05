import type { Route } from "./+types/app-layout";
import { Outlet } from "react-router";

import { AppShell } from "../components/app-shell";
import { requireOnboarded } from "../lib/require-onboarded.server";

export const middleware: Route.MiddlewareFunction[] = [requireOnboarded];

export function headers() {
  return { "cache-control": "private, no-store" };
}

export default function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
