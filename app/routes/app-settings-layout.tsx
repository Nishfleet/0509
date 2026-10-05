import { Outlet } from "react-router";

import { AppShell } from "../components/app-shell";

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
