import type { LoaderFunctionArgs } from "react-router";

import {
  buildCollectionExportPayload,
  buildWatchlistExportPayload,
  collectionExportResponse,
  digestExportResponse,
  exportFormatForRequest,
  watchlistExportResponse,
} from "~/lib/resource-export";
import { decodeListCursor } from "~/lib/list-pagination";
import {
  isSlackDeliveryCustomerFacing,
  slackDeliveryUnavailableMessage,
} from "~/lib/ga-customer-surface";

type ApiResourceType = "collection" | "watchlist" | "digest";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireExportFeature, requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const {
    createAuthenticatedApiLimitContext,
    enforceAuthenticatedApiLimit,
  } = await import("~/lib/authenticated-api-limits.server");
  const {
    getCollection,
    getDigest,
    getWatchlist,
    listCollectionItems,
    listCollectionItemsPage,
    listWatchEvents,
    listWatchEventsPage,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const auth = await authenticateApiKeyRequest(env, request);
  if (!auth.ok) {
    return auth.response;
  }
  const workspaceUserId = await resolveWorkspaceDataUserId(env, auth.apiKey.userId);
  const apiLimit = createAuthenticatedApiLimitContext(env, {
    workspaceUserId,
    actorUserId: auth.apiKey.userId,
    apiKeyId: auth.apiKey.id,
  });
  const limitResponse = await enforceAuthenticatedApiLimit({
    env,
    ...apiLimit,
    operation: "api.v1.resource.read",
    actionClass: "read",
    request,
  });
  if (limitResponse) return limitResponse;
  const apiGate = await requireWorkspacePlanFeature(env, workspaceUserId, "api_access");
  if (!apiGate.ok) {
    return apiGate.response;
  }

  const resourceType = normalizeResourceType(params.resourceType);
  const resourceId = params.resourceId;
  const format = exportFormatForRequest(request, "json");
  const pageInput = readPageInput(request);
  if (!pageInput.ok) return pageInput.response;
  if (format === "slack" && !isSlackDeliveryCustomerFacing()) {
    return Response.json(
      {
        error: "slack_export_unavailable",
        message: slackDeliveryUnavailableMessage(),
      },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
  // BET 6: JSON reads of the account's own saved data are the free + Scout
  // read surface (`api_access`). CSV and Slack-ready exports remain Starter+
  // exports — "Writes and exports on Starter+".
  if (format !== "json") {
    const exportGate = await requireExportFeature(env, workspaceUserId, format);
    if (!exportGate.ok) {
      return exportGate.response;
    }
  }

  if (!resourceType || !resourceId) {
    return notFoundResponse();
  }

  if (resourceType === "collection") {
    const collection = await getCollection(env, resourceId, workspaceUserId);
    if (!collection) {
      return notFoundResponse();
    }

    if (!pageInput.value) {
      const items = await listCollectionItems(env, collection.id);
      return collectionExportResponse(collection, items, format);
    }
    const page = await listCollectionItemsPage(env, collection.id, pageInput.value);
    const pagination = { limit: pageInput.value.limit, nextCursor: page.nextCursor };
    if (format === "json") {
      return pagedJsonResponse(buildCollectionExportPayload(collection, page.items), pagination, request);
    }
    return withPageHeaders(collectionExportResponse(collection, page.items, format), pagination, request);
  }

  if (resourceType === "watchlist") {
    const watchlist = await getWatchlist(env, resourceId, workspaceUserId);
    if (!watchlist) {
      return notFoundResponse();
    }

    if (!pageInput.value) {
      const events = await listWatchEvents(env, watchlist.id, 200);
      return watchlistExportResponse(watchlist, events, format);
    }
    const page = await listWatchEventsPage(env, watchlist.id, pageInput.value);
    const pagination = { limit: pageInput.value.limit, nextCursor: page.nextCursor };
    if (format === "json") {
      return pagedJsonResponse(buildWatchlistExportPayload(watchlist, page.items), pagination, request);
    }
    return withPageHeaders(watchlistExportResponse(watchlist, page.items, format), pagination, request);
  }

  const digest = await getDigest(env, resourceId);
  if (!digest || digest.userId !== workspaceUserId) {
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

function readPageInput(request: Request) {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");
  if (rawLimit === null && cursor === null) {
    return { ok: true as const, value: null };
  }
  const parsedLimit = rawLimit === null ? 100 : Number(rawLimit);
  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 200 ||
    (cursor !== null && (cursor.length > 512 || !decodeListCursor(cursor)))
  ) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error: "invalid_pagination",
          message: "Use limit 1–200 and a cursor returned by Five to Nine.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return {
    ok: true as const,
    value: { limit: parsedLimit, cursor },
  };
}

function pagedJsonResponse(
  payload: Record<string, unknown>,
  pagination: { limit: number; nextCursor: string | null },
  request: Request,
) {
  return withPageHeaders(
    Response.json(
      { ...payload, pagination },
      { headers: { "Cache-Control": "no-store" } },
    ),
    pagination,
    request,
  );
}

function withPageHeaders(
  response: Response,
  pagination: { limit: number; nextCursor: string | null },
  request: Request,
) {
  response.headers.set("X-0509-Page-Limit", String(pagination.limit));
  if (pagination.nextCursor) {
    response.headers.set("X-0509-Next-Cursor", pagination.nextCursor);
    const next = new URL(request.url);
    next.searchParams.set("cursor", pagination.nextCursor);
    next.searchParams.set("limit", String(pagination.limit));
    response.headers.set("Link", `<${next.toString()}>; rel="next"`);
  }
  return response;
}
