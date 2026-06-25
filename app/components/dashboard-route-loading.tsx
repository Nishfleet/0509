import { DashboardPage } from "~/components/dashboard-page";
import { ErrorState } from "~/components/error-state";
import { RouteSkeleton } from "~/components/route-skeleton";

export function DashboardRouteLoading({ title }: { title: string }) {
  return (
    <DashboardPage>
      <RouteSkeleton label={`Loading ${title}…`} />
    </DashboardPage>
  );
}

export function DashboardRouteError({ error }: { error: unknown }) {
  return (
    <DashboardPage>
      <ErrorState error={error} />
    </DashboardPage>
  );
}
