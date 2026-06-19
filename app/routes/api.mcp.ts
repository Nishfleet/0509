import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { AppEnv } from "~/lib/env.server";
import type { CustomerAgentActionName } from "~/lib/customer-agent-actions.server";
import type { CustomerApiKeyRecord } from "~/lib/types";
import type { WorkspaceReadiness } from "~/lib/workspace-readiness.server";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const WRITE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const MCP_TOOLS = [
  {
    name: "get_workspace_readiness",
    title: "Get Workspace Readiness",
    description:
      "Read the account setup state for Five to Nine monitoring, proof, delivery, billing, API, and MCP readiness.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json", "slack"],
          default: "json",
          description: "Use json for structured agent context or slack for a Slack-ready summary.",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "get_collection_export",
    title: "Get Collection Export",
    description:
      "Read an account-owned Five to Nine collection with saved competitor proof and insight-depth summaries.",
    inputSchema: resourceInputSchema("collectionId"),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "get_watchlist_export",
    title: "Get Watchlist Export",
    description:
      "Read an account-owned Five to Nine watchlist with recent proof-backed changes and next-move intelligence.",
    inputSchema: resourceInputSchema("watchlistId"),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "get_digest_export",
    title: "Get Digest Export",
    description:
      "Read an account-owned Five to Nine digest with priority, recommendation, proof trail, and insight-depth summaries.",
    inputSchema: resourceInputSchema("digestId"),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "create_watchlist",
    title: "Create Watchlist",
    description:
      "Create an account-owned competitor watchlist with plan-limit checks and an audited first-scan queue.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Optional display name. Defaults to '<competitor> watch'.",
        },
        targetLabel: {
          type: "string",
          description: "Competitor or brand name to monitor.",
        },
        competitorWebsite: {
          type: "string",
          description: "Optional competitor website, such as brand.com.",
        },
        targetCountry: {
          type: "string",
          default: "all",
          description: "Country name used by Five to Nine search filters.",
        },
        trackingRole: {
          type: "string",
          enum: ["competitor", "self"],
          default: "competitor",
        },
        queueFirstScan: {
          type: "boolean",
          default: true,
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "refresh_watchlist",
    title: "Refresh Watchlist",
    description:
      "Run a paid-plan manual refresh for an active account-owned watchlist and audit the action.",
    inputSchema: watchlistMutationInputSchema(),
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "pause_watchlist",
    title: "Pause Watchlist",
    description:
      "Pause an account-owned watchlist so scheduled scans stop and the plan slot is freed.",
    inputSchema: watchlistMutationInputSchema(),
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "resume_watchlist",
    title: "Resume Watchlist",
    description:
      "Resume an account-owned watchlist after checking the workspace's active watchlist limit.",
    inputSchema: watchlistMutationInputSchema(),
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "add_external_proof",
    title: "Add External Proof",
    description:
      "Save a manual cross-channel proof URL into an account-owned board with audit logging.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: {
          type: "string",
          description: "Five to Nine board owned by the API-key account.",
        },
        advertiser: {
          type: "string",
        },
        proofUrl: {
          type: "string",
        },
        channel: {
          type: "string",
          enum: ["TikTok", "Google / YouTube", "LinkedIn", "Pinterest", "Meta", "Landing page", "Other"],
          default: "Other",
        },
        hook: {
          type: "string",
          description: "Visible headline, hook, or proof summary.",
        },
        offer: {
          type: "string",
        },
        cta: {
          type: "string",
        },
        note: {
          type: "string",
        },
        observedAt: {
          type: "string",
          description: "ISO timestamp or YYYY-MM-DD.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["collectionId", "advertiser", "proofUrl", "hook"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "create_share_link",
    title: "Create Share Link",
    description:
      "Create a live share link for an account-owned board, watchlist, or digest.",
    inputSchema: {
      type: "object",
      properties: {
        resourceType: {
          type: "string",
          enum: ["collection", "watchlist", "digest"],
        },
        resourceId: {
          type: "string",
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["resourceType", "resourceId"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "create_report",
    title: "Create Report",
    description:
      "Build a client-ready report payload for an account-owned board or watchlist.",
    inputSchema: reportInputSchema(),
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "share_report",
    title: "Share Report",
    description:
      "Build and share a snapshot report for an account-owned board or watchlist.",
    inputSchema: reportInputSchema(),
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "create_counter_move_brief",
    title: "Create Counter-Move Brief",
    description:
      "Build a proof-backed counter-move brief from recent account-owned watchlist changes.",
    inputSchema: {
      type: "object",
      properties: {
        watchlistId: {
          type: "string",
          description: "Five to Nine watchlist owned by the API-key account.",
        },
        limit: {
          type: "number",
          default: 5,
          description: "Maximum moves to include, capped at 20.",
        },
        timeZone: {
          type: "string",
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["watchlistId"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
];

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
      "Manual external proof links saved in account-owned collections",
    ],
    notLiveYet: [
      "TikTok ingestion",
      "Google or YouTube ingestion",
      "LinkedIn or Pinterest ingestion",
      "fully general write API beyond audited agent actions",
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
        "Use these read-only tools to retrieve Five to Nine workspace readiness plus account-owned collections, watchlists, and digests. Manual external proof links may appear in collection exports, but do not treat the endpoint as automated TikTok, Google, LinkedIn, Pinterest, write API, or unsupported-channel coverage.",
    });
  }

  if (message.method === "tools/list") {
    return jsonRpcResult(message.id, {
      tools: MCP_TOOLS,
    });
  }

  if (message.method === "tools/call") {
    const result = await callTool(env, auth.apiKey, message.params, new URL(request.url).origin);
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
  origin: string,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  if (!params || typeof params !== "object") {
    return { ok: false, message: "tools/call params must be an object." };
  }

  const name = stringField(params, "name");
  const args = objectField(params, "arguments") ?? {};
  if (!name) {
    return { ok: false, message: "tools/call requires name." };
  }

  const format = normalizeAgentFormat(stringField(args, "format"));
  if (!format) {
    return { ok: false, message: "format must be json or slack." };
  }

  if (name === "get_workspace_readiness") {
    return buildWorkspaceReadinessToolResult(env, apiKey.userId, format);
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

  if (name === "create_watchlist") {
    return buildAgentActionToolResult(env, apiKey, "watchlist.create", args, origin);
  }

  if (name === "refresh_watchlist") {
    return buildAgentActionToolResult(env, apiKey, "watchlist.refresh", args, origin);
  }

  if (name === "pause_watchlist") {
    return buildAgentActionToolResult(env, apiKey, "watchlist.pause", args, origin);
  }

  if (name === "resume_watchlist") {
    return buildAgentActionToolResult(env, apiKey, "watchlist.resume", args, origin);
  }

  if (name === "add_external_proof") {
    return buildAgentActionToolResult(env, apiKey, "proof.add_external", args, origin);
  }

  if (name === "create_share_link") {
    return buildAgentActionToolResult(env, apiKey, "share.create", args, origin);
  }

  if (name === "create_report") {
    return buildAgentActionToolResult(env, apiKey, "report.create", args, origin);
  }

  if (name === "share_report") {
    return buildAgentActionToolResult(env, apiKey, "report.share", args, origin);
  }

  if (name === "create_counter_move_brief") {
    return buildAgentActionToolResult(env, apiKey, "counter_move_brief.create", args, origin);
  }

  return { ok: false, message: `Unknown tool: ${name}` };
}

async function buildAgentActionToolResult(
  env: AppEnv,
  apiKey: CustomerApiKeyRecord,
  actionName: CustomerAgentActionName,
  args: object,
  origin: string,
) {
  const {
    customerAgentActionErrorPayload,
    runCustomerAgentAction,
  } = await import("~/lib/customer-agent-actions.server");

  try {
    return structuredToolResult(await runCustomerAgentAction(env, {
      userId: apiKey.userId,
      apiKeyId: apiKey.id,
      idempotencyKey: stringField(args, "idempotencyKey"),
      source: "mcp",
      origin,
    }, actionName, args as Record<string, unknown>));
  } catch (error) {
    const payload = customerAgentActionErrorPayload(error).body;
    return errorToolResult(payload);
  }
}

async function buildWorkspaceReadinessToolResult(
  env: AppEnv,
  userId: string,
  format: AgentFormat,
) {
  const { getWorkspaceReadiness } = await import("~/lib/workspace-readiness.server");
  const readiness = await getWorkspaceReadiness(env, userId);
  const structuredContent = readiness as unknown as Record<string, unknown>;

  if (format === "slack") {
    return textToolResult(formatWorkspaceReadinessSummary(readiness), structuredContent);
  }

  return structuredToolResult(structuredContent);
}

function formatWorkspaceReadinessSummary(readiness: WorkspaceReadiness) {
  const lines = [
    `*Five to Nine workspace readiness:* ${readiness.readyCount} of ${readiness.totalCount} ready`,
    ...readiness.items
      .filter((item) => item.status !== "not_applicable")
      .map((item) => `- ${item.label}: ${item.status.replaceAll("_", " ")} - ${item.detail}`),
  ];

  return lines.join("\n");
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

function structuredToolResult(structuredContent: object) {
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

function errorToolResult(structuredContent: Record<string, unknown>) {
  return {
    ok: true as const,
    value: {
      content: [
        {
          type: "text",
          text: String(structuredContent.message ?? "Agent action failed."),
        },
      ],
      structuredContent,
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

function watchlistMutationInputSchema() {
  return {
    type: "object",
    properties: {
      watchlistId: {
        type: "string",
        description: "Five to Nine watchlist owned by the API-key account.",
      },
      idempotencyKey: idempotencyKeySchema(),
    },
    required: ["watchlistId"],
    additionalProperties: false,
  };
}

function reportInputSchema() {
  return {
    type: "object",
    properties: {
      reportId: {
        type: "string",
        description: "Optional report id such as collection:abc or watchlist:abc.",
      },
      resourceType: {
        type: "string",
        enum: ["collection", "watchlist"],
      },
      resourceId: {
        type: "string",
      },
      idempotencyKey: idempotencyKeySchema(),
    },
    additionalProperties: false,
  };
}

function idempotencyKeySchema() {
  return {
    type: "string",
    description: "Optional stable key for safe retry. Replays only when the previous matching action succeeded.",
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
