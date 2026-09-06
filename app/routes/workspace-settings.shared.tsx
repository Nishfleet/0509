import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";

export type NullableString = string | null;

export type RouteActionData = {
  ok: boolean;
  message: string;
	/** Echo of the submitted intent so feedback renders next to its form. */
	intent?: string;
};

export function SourceAccessHydrateFallback() {
  return <DashboardRouteLoading title="Source access" />;
}

export function NotificationsHydrateFallback() {
  return <DashboardRouteLoading title="Notifications" />;
}

export function DeveloperAccessHydrateFallback() {
  return <DashboardRouteLoading title="Developer access" />;
}

export function WorkspaceSettingsErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}
