import type { LoaderFunctionArgs } from "react-router";

import {
  collectionExportResponse,
  digestExportResponse,
  exportFormatForRequest,
  watchlistExportResponse,
} from "~/lib/resource-export";

type ApiResourceType = "collection" | "watchlist" | "digest";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireExportFeature, requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const {
    getCollection,
    getDigest,
    getWatchlist,
    listCollectionItems,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const auth = await authenticateApiKeyRequest(env, request);
  if (!auth.ok) {
    return auth.response;
  }
  const workspaceUserId = await resolveWorkspaceDataUserId(env, auth.apiKey.userId);
  const apiGate = await requireWorkspacePlanFeature(env, workspaceUserId, "api_access");
  if (!apiGate.ok) {
    return apiGate.response;
  }

  const resourceType = normalizeResourceType(params.resourceType);
  const resourceId = params.resourceId;
  const format = exportFormatForRequest(request, "json");
  const exportGate = await requireExportFeature(env, workspaceUserId, format);
  if (!exportGate.ok) {
    return exportGate.response;
  }

  if (!resourceType || !resourceId) {
    return notFoundResponse();
  }

  if (resourceType === "collection") {
    const collection = await getCollection(env, resourceId, auth.apiKey.userId);
    if (!collection) {
      return notFoundResponse();
    }

    const items = await listCollectionItems(env, collection.id);
    return collectionExportResponse(collection, items, format);
  }

  if (resourceType === "watchlist") {
    const watchlist = await getWatchlist(env, resourceId, auth.apiKey.userId);
    if (!watchlist) {
      return notFoundResponse();
    }

    const events = await listWatchEvents(env, watchlist.id, 200);
    return watchlistExportResponse(watchlist, events, format);
  }

  const digest = await getDigest(env, resourceId);
  if (!digest || digest.userId !== auth.apiKey.userId) {
    return notFoundResponse();
  }

  return digestExportResponse(digest, format);
}

function normalizeResourceType(value: string | undefined): ApiResourceType | null {
  if (value === "collection" || value === "collections") {
    return "collection";
  }
  if (value === "watchlist" || value === "watchlists") {
    return "watchlist";
  }
  if (value === "digest" || value === "digests") {
    return "digest";
  }
  return null;
}

function notFoundResponse() {
  return Response.json(
    {
      error: "not_found",
      message: "No API resource was found for this key.",
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
