import type { Route } from "./+types/app-settings-layout";
import { Outlet } from "react-router";

import { AppShell } from "../components/app-shell";
import { requireSessionMiddleware } from "../lib/require-session.server";

export const middleware: Route.MiddlewareFunction[] = [requireSessionMiddleware];

export function headers() {
  return { "cache-control": "private, no-store" };
}

export default function AppSettingsLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
