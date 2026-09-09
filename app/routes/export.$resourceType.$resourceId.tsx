import type { LoaderFunctionArgs } from "react-router";

import {
  archiveExportResponse,
  collectionExportResponse,
  digestExportResponse,
  exportFormatForRequest,
  watchlistExportResponse,
} from "~/lib/resource-export";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireExportFeature } = await import("~/lib/plan-feature-gate.server");
  const {
    getCollection,
    getDigest,
    getWatchlist,
    listCollectionItems,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const resourceType = params.resourceType;
  const resourceId = params.resourceId;
  const format = exportFormatForRequest(request);
  const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
  if (format === "slack" && !isSlackDeliveryCustomerFacing()) {
    throw new Response("Slack exports are not available at general availability yet.", { status: 403 });
  }
  const exportGate = await requireExportFeature(env, workspaceUserId, format);
  if (!exportGate.ok) {
    throw exportGate.response;
  }

  if (!resourceType || !resourceId) {
    throw new Response("Not found", { status: 404 });
  }

  if (resourceType === "collection") {
    const collection = await getCollection(env, resourceId, workspaceUserId);
    if (!collection) {
      throw new Response("Not found", { status: 404 });
    }

    const items = await listCollectionItems(env, collection.id);
    return collectionExportResponse(collection, items, format);
  }

  if (resourceType === "watchlist") {
    const watchlist = await getWatchlist(env, resourceId, workspaceUserId);
    if (!watchlist) {
      throw new Response("Not found", { status: 404 });
    }

    const events = await listWatchEvents(env, watchlist.id, 200);
    return watchlistExportResponse(watchlist, events, format);
  }

  // The proof archive (issue #2173): CSV + JSON of the full dated record for
  // the account's watched domain, from the same engine as the Archive tab.
  if (resourceType === "archive") {
    const watchlist = await getWatchlist(env, resourceId, workspaceUserId);
    if (!watchlist) {
      throw new Response("Not found", { status: 404 });
    }

    const { loadWatchlistArchive } = await import("~/lib/archive.server");
    const archive = await loadWatchlistArchive(env, { watchlist });
    return archiveExportResponse(archive, format === "json" ? "json" : "csv");
  }

  if (resourceType === "digest") {
    const digest = await getDigest(env, resourceId);
    if (!digest || digest.userId !== workspaceUserId) {
      throw new Response("Not found", { status: 404 });
    }

    return digestExportResponse(digest, format);
  }

  throw new Response("Not found", { status: 404 });
}
