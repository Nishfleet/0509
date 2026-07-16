import type { LoaderFunctionArgs } from "react-router";

import {
  ReportsIndexErrorBoundary,
  ReportsIndexHydrateFallback,
  ReportsIndexRoute,
  reportsIndexMeta,
  type ReportsIndexLoaderData,
} from "~/routes/app.reports.index.ui";
import { createReportId } from "~/lib/report";

export async function loader({ context, request }: LoaderFunctionArgs): Promise<ReportsIndexLoaderData> {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { listCollections, listWatchlists } = await import("~/lib/data.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const gate = await requireWorkspacePlanFeature(env, workspaceUserId, "client_reports");

  if (!gate.ok) {
    return {
      accessDenied: true,
      feature: "client_reports",
      plan: gate.plan,
      upgradePath: "/app/billing?source=reports#plans",
      reports: [],
    };
  }

  const [collections, watchlists] = await Promise.all([
    listCollections(env, workspaceUserId),
    listWatchlists(env, workspaceUserId, { includeInactive: true }),
  ]);
  const reports = [
    ...collections.map((collection) => ({
      id: createReportId("collection", collection.id),
      href: `/app/reports/${encodeURIComponent(createReportId("collection", collection.id))}`,
      typeLabel: "Collection report",
      title: collection.name,
      description: collection.description?.trim() || "Saved ads and evidence from this collection.",
      updatedAt: collection.updatedAt,
    })),
    ...watchlists.map((watchlist) => ({
      id: createReportId("watchlist", watchlist.id),
      href: `/app/reports/${encodeURIComponent(createReportId("watchlist", watchlist.id))}`,
      typeLabel: "Competitor report",
      title: watchlist.name,
      description: `${watchlist.isActive ? "Active" : "Paused"} monitoring · ${watchlist.targetLabel}`,
      updatedAt: watchlist.updatedAt,
    })),
  ].sort((left, right) => {
    const updatedOrder = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return updatedOrder || left.id.localeCompare(right.id);
  });

  return {
    accessDenied: false,
    feature: "client_reports",
    plan: gate.plan,
    reports,
  };
}

export const meta = reportsIndexMeta;
export const HydrateFallback = ReportsIndexHydrateFallback;
export const ErrorBoundary = ReportsIndexErrorBoundary;
export default ReportsIndexRoute;
