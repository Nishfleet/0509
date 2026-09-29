import { Outlet } from "react-router";

import { AppShell } from "../components/app-shell";

export default function AppSettingsLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
