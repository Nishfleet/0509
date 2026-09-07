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
  // Honesty: the time a customer sees on this list must be evidence time,
  // not record-mutation time. A watchlist's truth is its last completed
  // check; a collection has no check of its own, so its edit time is
  // labeled as exactly that. Renaming a record must never outrank this
  // morning's caught change.
  const reports = [
    ...collections.map((collection) => ({
      id: createReportId("collection", collection.id),
      href: `/app/reports/${encodeURIComponent(createReportId("collection", collection.id))}`,
      typeLabel: "Collection report",
      title: collection.name,
      description: collection.description?.trim() || "Saved ads and evidence from this collection.",
      timeLabel: "Edited",
      timeAt: collection.updatedAt as string | null,
    })),
    ...watchlists.map((watchlist) => ({
      id: createReportId("watchlist", watchlist.id),
      href: `/app/reports/${encodeURIComponent(createReportId("watchlist", watchlist.id))}`,
      typeLabel: "Competitor report",
      title: watchlist.name,
      description: watchlist.lastScannedAt
        ? `${watchlist.isActive ? "Watching" : "Paused"} · ${watchlist.targetLabel}`
        : `No check has run yet · ${watchlist.targetLabel}`,
      timeLabel: watchlist.lastScannedAt ? "Checked" : null,
      timeAt: watchlist.lastScannedAt ?? null,
    })),
  ].sort((left, right) => {
    const leftTime = left.timeAt ? Date.parse(left.timeAt) : 0;
    const rightTime = right.timeAt ? Date.parse(right.timeAt) : 0;
    return rightTime - leftTime || left.id.localeCompare(right.id);
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
