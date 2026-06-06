import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { AppEnv } from "~/lib/env.server";
import type { CustomerApiKeyRecord } from "~/lib/types";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_TOOLS = [
  {
    name: "get_collection_export",
    title: "Get Collection Export",
    description:
      "Read an account-owned Five to Nine collection with saved competitor proof and insight-depth summaries.",
    inputSchema: resourceInputSchema("collectionId"),
  },
  {
    name: "get_watchlist_export",
    title: "Get Watchlist Export",
    description:
      "Read an account-owned Five to Nine watchlist with recent proof-backed changes and next-move intelligence.",
    inputSchema: resourceInputSchema("watchlistId"),
  },
  {
    name: "get_digest_export",
    title: "Get Digest Export",
    description:
      "Read an account-owned Five to Nine digest with priority, recommendation, proof trail, and insight-depth summaries.",
    inputSchema: resourceInputSchema("digestId"),
  },
].map((tool) => ({
  ...tool,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}));

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

export function loader({ request }: LoaderFunctionArgs) {
  const origin = new URL(request.url).origin;
  if ((request.headers.get("Accept") ?? "").toLowerCase().includes("text/event-stream")) {
    return new Response("This MCP endpoint accepts JSON-RPC over POST only.", {
      status: 405,
      headers: {
        Allow: "POST",
        ...noStoreHeaders(),
      },
    });
  }

  return jsonResponse({
    name: "Five to Nine MCP",
    status: "live",
    endpoint: `${origin}/api/mcp`,
    transport: "streamable-http-json-rpc",
    protocolVersion: MCP_PROTOCOL_VERSION,
    auth: {
      type: "bearer",
      header: "Authorization: Bearer <Five to Nine API key>",
      createKeysIn: `${origin}/app/sources`,
    },
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
    })),
    liveDataScope: [
      "Account-owned collections",
      "Account-owned watchlists",
      "Account-owned digests",
      "Saved Meta and landing-page proof already captured in Five to Nine",
    ],
    notLiveYet: [
      "TikTok ingestion",
      "Google or YouTube ingestion",
      "LinkedIn or Pinterest ingestion",
      "public write API",
    ],
  });
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const auth = await authenticateApiKeyRequest(env, request);
  if (!auth.ok) {
    return auth.response;
  }

  const rpcRequest = await readJsonRpcRequest(request);
  if (!rpcRequest.ok) {
    return jsonRpcError(null, -32700, "Parse error");
  }

  if (!isJsonRpcRequest(rpcRequest.value)) {
    return jsonRpcError(null, -32600, "Invalid Request");
  }

  const message = rpcRequest.value;
  if (typeof message.id === "undefined") {
    await handleNotification(message);
    return new Response(null, {
      status: 202,
      headers: noStoreHeaders(),
    });
  }

  if (message.method === "initialize") {
    return jsonRpcResult(message.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "five-to-nine",
        title: "Five to Nine",
        version: "1.0.0",
      },
      instructions:
        "Use these read-only tools to retrieve account-owned Five to Nine collections, watchlists, and digests. Do not treat the endpoint as TikTok, Google, LinkedIn, Pinterest, write API, or unsupported-channel coverage.",
    });
  }

  if (message.method === "tools/list") {
    return jsonRpcResult(message.id, {
      tools: MCP_TOOLS,
    });
  }

  if (message.method === "tools/call") {
    const result = await callTool(env, auth.apiKey, message.params);
    if (!result.ok) {
      return jsonRpcError(message.id, -32602, result.message);
    }
    return jsonRpcResult(message.id, result.value);
  }

  return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
}

async function callTool(
  env: AppEnv,
  apiKey: CustomerApiKeyRecord,
  params: unknown,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  if (!params || typeof params !== "object") {
    return { ok: false, message: "tools/call params must be an object." };
  }

  const name = stringField(params, "name");
  const args = objectField(params, "arguments");
  if (!name || !args) {
    return { ok: false, message: "tools/call requires name and arguments." };
  }

  const format = normalizeAgentFormat(stringField(args, "format"));
  if (!format) {
    return { ok: false, message: "format must be json or slack." };
  }

  if (name === "get_collection_export") {
    return buildCollectionToolResult(env, apiKey.userId, stringField(args, "collectionId"), format);
  }

  if (name === "get_watchlist_export") {
    return buildWatchlistToolResult(env, apiKey.userId, stringField(args, "watchlistId"), format);
  }

  if (name === "get_digest_export") {
    return buildDigestToolResult(env, apiKey.userId, stringField(args, "digestId"), format);
  }

  return { ok: false, message: `Unknown tool: ${name}` };
}

async function buildCollectionToolResult(
  env: AppEnv,
  userId: string,
  collectionId: string | null,
  format: AgentFormat,
) {
  if (!collectionId) {
    return { ok: false as const, message: "collectionId is required." };
  }

  const {
    getCollection,
    listCollectionItems,
  } = await import("~/lib/data.server");
  const {
    buildCollectionExportPayload,
    collectionExportResponse,
  } = await import("~/lib/resource-export");
  const collection = await getCollection(env, collectionId, userId);
  if (!collection) {
    return toolNotFound("No account-owned collection was found for this API key.");
  }

  const items = await listCollectionItems(env, collection.id);
  if (format === "slack") {
    return textToolResult(await collectionExportResponse(collection, items, "slack").text(), {
      resourceType: "collection",
      resourceId: collection.id,
      format,
    });
  }

  return structuredToolResult(buildCollectionExportPayload(collection, items));
}

async function buildWatchlistToolResult(
  env: AppEnv,
  userId: string,
  watchlistId: string | null,
  format: AgentFormat,
) {
  if (!watchlistId) {
    return { ok: false as const, message: "watchlistId is required." };
  }

  const {
    getWatchlist,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const {
    buildWatchlistExportPayload,
    watchlistExportResponse,
  } = await import("~/lib/resource-export");
  const watchlist = await getWatchlist(env, watchlistId, userId);
  if (!watchlist) {
    return toolNotFound("No account-owned watchlist was found for this API key.");
  }

  const events = await listWatchEvents(env, watchlist.id, 200);
  if (format === "slack") {
    return textToolResult(await watchlistExportResponse(watchlist, events, "slack").text(), {
      resourceType: "watchlist",
      resourceId: watchlist.id,
      format,
    });
  }

  return structuredToolResult(buildWatchlistExportPayload(watchlist, events));
}

async function buildDigestToolResult(
  env: AppEnv,
  userId: string,
  digestId: string | null,
  format: AgentFormat,
) {
  if (!digestId) {
    return { ok: false as const, message: "digestId is required." };
  }

  const {
    getDigest,
  } = await import("~/lib/data.server");
  const {
    buildDigestExportPayload,
    digestExportResponse,
  } = await import("~/lib/resource-export");
  const digest = await getDigest(env, digestId);
  if (!digest || digest.userId !== userId) {
    return toolNotFound("No account-owned digest was found for this API key.");
  }

  if (format === "slack") {
    return textToolResult(await digestExportResponse(digest, "slack").text(), {
      resourceType: "digest",
      resourceId: digest.id,
      format,
    });
  }

  return structuredToolResult(buildDigestExportPayload(digest));
}

function structuredToolResult(structuredContent: Record<string, unknown>) {
  return {
    ok: true as const,
    value: {
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
      structuredContent,
      isError: false,
    },
  };
}

function textToolResult(text: string, structuredContent: Record<string, unknown>) {
  return {
    ok: true as const,
    value: {
      content: [
        {
          type: "text",
          text,
        },
      ],
      structuredContent,
      isError: false,
    },
  };
}

function toolNotFound(message: string) {
  return {
    ok: true as const,
    value: {
      content: [
        {
          type: "text",
          text: message,
        },
      ],
      structuredContent: {
        error: "not_found",
        message,
      },
      isError: true,
    },
  };
}

async function readJsonRpcRequest(request: Request) {
  try {
    return {
      ok: true as const,
      value: await request.json(),
    };
  } catch {
    return { ok: false as const };
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as JsonRpcRequest;
  return candidate.jsonrpc === "2.0" && typeof candidate.method === "string";
}

async function handleNotification(message: JsonRpcRequest) {
  if (message.method === "notifications/initialized") {
    return;
  }
}

type AgentFormat = "json" | "slack";

function normalizeAgentFormat(value: string | null): AgentFormat | null {
  if (!value) {
    return "json";
  }
  if (value === "json" || value === "slack") {
    return value;
  }
  return null;
}

function objectField(value: object, field: string) {
  const candidate = (value as Record<string, unknown>)[field];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate
    : null;
}

function stringField(value: object, field: string) {
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function resourceInputSchema(idName: string) {
  return {
    type: "object",
    properties: {
      [idName]: {
        type: "string",
        description: `Five to Nine ${idName} owned by the API-key account.`,
      },
      format: {
        type: "string",
        enum: ["json", "slack"],
        default: "json",
        description: "Use json for structured agent context or slack for Slack-ready markdown.",
      },
    },
    required: [idName],
    additionalProperties: false,
  };
}

function jsonRpcResult(id: JsonRpcId, result: Record<string, unknown>) {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

function jsonResponse(payload: Record<string, unknown>) {
  return Response.json(payload, {
    headers: noStoreHeaders(),
  });
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
}
