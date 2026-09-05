import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import {
  AGENT_BLOCKED_CAPABILITIES,
  AGENT_FIRST_WORKFLOW,
  BROAD_WRITE_API_NON_GOAL,
  CUSTOMER_SUPPORT_PATHS,
  READ_ONLY_API_KEY_REQUIREMENT,
  WRITE_ENABLED_API_KEY_REQUIREMENT,
} from "~/lib/agent-action-catalog";
import { mcpActionGroups } from "~/lib/mcp-agent-action-groups";
import {
  isSlackDeliveryCustomerFacing,
  slackDeliveryUnavailableMessage,
} from "~/lib/ga-customer-surface";
import type { AppEnv } from "~/lib/env.server";
import type { CustomerAgentActionName } from "~/lib/customer-agent-actions.server";
import type { CustomerApiKeyRecord } from "~/lib/types";
import type { WorkspaceReadiness } from "~/lib/workspace-readiness.server";
import { decodeListCursor } from "~/lib/list-pagination";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const API_PLAN_REQUIREMENT = "Agency";
const MAX_AUTHENTICATED_API_BODY_BYTES = 64 * 1024;
type ApiLimitContext = {
  identity: {
    workspaceUserId: string;
    actorUserId: string;
    apiKeyId: string;
  };
  isIdentityActive: () => boolean | Promise<boolean>;
};
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
const WRITE_TOOL_NAMES = new Set([
  "retest_meta_source",
  "create_watchlist",
  "update_watchlist",
  "refresh_watchlist",
  "pause_watchlist",
  "resume_watchlist",
  "create_collection",
  "add_external_proof",
  "create_share_link",
  "create_report",
  "share_report",
  "create_counter_move_brief",
  "upsert_memory",
  "list_memory",
  "upsert_client_room",
  "list_client_rooms",
  "create_support_case",
  "list_support_cases",
  "list_delivery_targets",
  "update_delivery_settings",
  "update_delivery_target",
  "list_web_mentions",
]);
const TOOL_ACTION_NAMES: Readonly<Record<string, CustomerAgentActionName>> = {
  retest_meta_source: "source.meta.retest",
  create_watchlist: "watchlist.create",
  update_watchlist: "watchlist.update",
  refresh_watchlist: "watchlist.refresh",
  pause_watchlist: "watchlist.pause",
  resume_watchlist: "watchlist.resume",
  create_collection: "collection.create",
  add_external_proof: "proof.add_external",
  list_delivery_targets: "delivery_targets.list",
  update_delivery_settings: "delivery_settings.update",
  update_delivery_target: "delivery_target.update",
  create_share_link: "share.create",
  create_report: "report.create",
  share_report: "report.share",
  create_counter_move_brief: "counter_move_brief.create",
  upsert_memory: "memory.upsert",
  list_memory: "memory.list",
  upsert_client_room: "client_room.upsert",
  list_client_rooms: "client_room.list",
  create_support_case: "support_case.create",
  list_support_cases: "support_case.list",
  list_web_mentions: "web_mentions.list",
};
const MCP_TOOLS = [
  {
    name: "get_workspace_readiness",
    title: "Get Workspace Readiness",
    description:
      "Read the account setup state for Five to Nine monitoring, evidence, delivery, billing, API, and tool readiness.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: customerAgentFormatValues(),
          default: "json",
          description: customerAgentFormatDescription(),
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
      "Read an account-owned Five to Nine collection with saved competitor evidence and insight-depth summaries.",
    inputSchema: resourceInputSchema("collectionId", { paginated: true }),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "get_watchlist_export",
    title: "Get Watchlist Export",
    description:
      "Read an account-owned Five to Nine watchlist with recent source-backed changes and next-move intelligence.",
    inputSchema: resourceInputSchema("watchlistId", { paginated: true }),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "watchlist_runs.list",
    title: "List Watchlist Run History",
    description:
      "Read the latest monitoring run for an account-owned watchlist, including every capture attempt — succeeded, failed, and skipped — with a public reason code for each non-success capture. A failed capture is never an alert, but it is always visible here so the silence is provable.",
    inputSchema: {
      type: "object",
      properties: {
        watchlistId: {
          type: "string",
          description: "Five to Nine watchlist owned by the API-key account.",
        },
      },
      required: ["watchlistId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "get_digest_export",
    title: "Get Digest Export",
    description:
      "Read an account-owned Five to Nine digest with priority, recommendation, source trail, and insight-depth summaries.",
    inputSchema: resourceInputSchema("digestId"),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "retest_meta_source",
    title: "Retest Meta Source",
    description:
      "Retest the saved account-owned Meta source connection without accepting or returning the credential.",
    inputSchema: {
      type: "object",
      properties: {
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["idempotencyKey"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
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
      required: ["idempotencyKey"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "update_watchlist",
    title: "Update Watchlist",
    description:
      "Update an account-owned watchlist's label, website target, self/competitor role, or alert tuning target with duplicate-target protection.",
    inputSchema: {
      type: "object",
      properties: {
        watchlistId: {
          type: "string",
          description: "Five to Nine watchlist owned by the API-key account.",
        },
        name: {
          type: "string",
        },
        targetLabel: {
          type: "string",
        },
        competitorWebsite: {
          type: "string",
        },
        targetCountry: {
          type: "string",
        },
        trackingRole: {
          type: "string",
          enum: ["competitor", "self"],
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["watchlistId", "idempotencyKey"],
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
    name: "create_collection",
    title: "Create Collection",
    description:
      "Create an account-owned collection for saved evidence links after checking the workspace collection limit.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        description: {
          type: "string",
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["name", "idempotencyKey"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "add_external_proof",
    title: "Add External Evidence",
    description:
      "Save a manual cross-channel evidence URL into an account-owned collection with audit logging.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: {
          type: "string",
          description: "Five to Nine collection owned by the API-key account.",
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
          description: "Visible headline, hook, or evidence summary.",
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
        spend: {
          type: "string",
        },
        impressions: {
          type: "string",
        },
        reach: {
          type: "string",
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["collectionId", "advertiser", "proofUrl", "hook", "idempotencyKey"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "list_delivery_targets",
    title: "List Delivery Targets",
    description:
      "List redacted account-owned delivery targets. Webhooks, phone numbers, provider identifiers, and raw secret-like metadata are not returned.",
    inputSchema: {
      type: "object",
      properties: {
        watchlistId: {
          type: "string",
        },
        channel: {
          type: "string",
          enum: ["email"],
        },
        limit: {
          type: "number",
          default: 50,
        },
      },
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "update_delivery_settings",
    title: "Update Delivery Settings",
    description:
      "Update per-watchlist delivery policy after explicit approval. This does not send evidence, test webhooks, or configure secret-bearing integrations.",
    inputSchema: {
      type: "object",
      properties: {
        watchlistId: {
          type: "string",
        },
        explicitApproval: {
          type: "boolean",
        },
        sensitivityMode: {
          type: "string",
          enum: ["quiet", "balanced", "aggressive", "auto"],
        },
        instantEnabled: {
          type: "boolean",
        },
        digestEnabled: {
          type: "boolean",
        },
        emailEnabled: {
          type: "boolean",
        },
        quietHours: {
          anyOf: [
            {
              type: "object",
              properties: {
                startHour: { type: "number" },
                endHour: { type: "number" },
              },
              required: ["startHour", "endHour"],
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
        timezone: {
          type: ["string", "null"],
          description: "IANA timezone name such as Asia/Kolkata or UTC. Invalid timezone names are rejected.",
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["watchlistId", "explicitApproval", "idempotencyKey"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "update_delivery_target",
    title: "Update Delivery Target",
    description:
      "Pause or resume an existing account-owned delivery target after explicit approval. This cannot change destination secrets or trigger sends.",
    inputSchema: {
      type: "object",
      properties: {
        targetId: {
          type: "string",
        },
        isPaused: {
          type: "boolean",
        },
        explicitApproval: {
          type: "boolean",
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["targetId", "isPaused", "explicitApproval", "idempotencyKey"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "create_share_link",
    title: "Create Share Link",
    description:
      "Create a live share link for an account-owned collection, watchlist, or digest.",
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
      required: ["resourceType", "resourceId", "idempotencyKey"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "create_report",
    title: "Create Report",
    description:
      "Build a client-ready report payload for an account-owned collection or watchlist.",
    inputSchema: reportInputSchema(),
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "share_report",
    title: "Share Report",
    description:
      "Build and share a snapshot report for an account-owned collection or watchlist.",
    inputSchema: reportInputSchema({ requiresIdempotency: true, requiresReview: true }),
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "create_counter_move_brief",
    title: "Create Counter-Move Brief",
    description:
      "Build a source-backed counter-move brief from recent account-owned watchlist changes.",
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
        ownerLabel: {
          type: "string",
          description: "Safe non-secret owner label for the follow-up, such as Growth lead.",
        },
        followUpChannel: {
          type: "string",
          enum: ["app", "email", "client_room"],
          default: "app",
        },
        expiryDays: {
          type: "number",
          default: 7,
          minimum: 1,
          maximum: 30,
        },
        idempotencyKey: idempotencyKeySchema(),
      },
      required: ["watchlistId", "idempotencyKey"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "upsert_memory",
    title: "Upsert Memory",
    description:
      "Save scoped, secret-sanitized account memory for future agent runs.",
    inputSchema: memoryMutationInputSchema(),
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "list_memory",
    title: "List Memory",
    description:
      "Read scoped account memory saved for future agent runs.",
    inputSchema: {
      type: "object",
      properties: {
        scope: memoryScopeSchema(),
        limit: {
          type: "number",
          default: 50,
        },
        watchlistId: {
          type: "string",
          description: "Optional owned watchlist id for scoped memory.",
        },
        clientRoomId: {
          type: "string",
          description: "Optional owned client room id for scoped memory.",
        },
      },
      not: { required: ["watchlistId", "clientRoomId"] },
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "upsert_client_room",
    title: "Upsert Client Room",
    description:
      "Save an account-owned client room that groups owned collections, watchlists, digests, reports, and memory context.",
    inputSchema: clientRoomMutationInputSchema(),
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "list_client_rooms",
    title: "List Client Rooms",
    description:
      "Read account-owned client rooms and their linked Five to Nine resources.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "archived", "all"],
          default: "active",
        },
        limit: {
          type: "number",
          default: 50,
        },
      },
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "create_support_case",
    title: "Create Support Case",
    description:
      "Open an account support case for billing, source, delivery, account, team, security, migration, or setup help. Do not include secrets, tokens, webhook URLs, card numbers, or private credentials.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["billing", "source", "delivery", "account", "team", "security", "migration", "other"],
        },
        priority: {
          type: "string",
          enum: ["normal", "urgent"],
          default: "normal",
        },
        subject: {
          type: "string",
          maxLength: 160,
        },
        detail: {
          type: "string",
          maxLength: 4000,
        },
        idempotencyKey: {
          ...idempotencyKeySchema(),
          maxLength: 120,
          description:
            "Stable key for safe retry. Replays a matching success and retries a matching failed or stale support-case action.",
        },
      },
      required: ["category", "subject", "detail", "idempotencyKey"],
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "list_support_cases",
    title: "List Support Cases",
    description:
      "Read account support case summaries without exposing private support notes.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "closed", "all"],
          default: "all",
        },
        limit: {
          type: "number",
          default: 20,
        },
      },
      additionalProperties: false,
    },
    annotations: WRITE_TOOL_ANNOTATIONS,
  },
  {
    name: "list_web_mentions",
    title: "List Presence Observations",
    description:
      "Read existing source-backed website, blog, and Substack mention observations tied to account-owned watchlists. X, Reddit, YouTube, LinkedIn, and broad social listening are not live.",
    inputSchema: {
      type: "object",
      properties: {
        watchlistId: {
          type: "string",
        },
        sources: {
          type: "array",
          items: {
            type: "string",
            enum: ["blog", "substack", "web"],
          },
        },
        includeInactive: {
          type: "boolean",
          default: false,
        },
        targetLimit: {
          type: "number",
          default: 50,
        },
        limit: {
          type: "number",
          default: 50,
        },
      },
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
    planRequirement: API_PLAN_REQUIREMENT,
    endpoint: `${origin}/api/mcp`,
    transport: "streamable-http-json-rpc",
    protocolVersion: MCP_PROTOCOL_VERSION,
    auth: {
      type: "bearer",
      header: "Authorization: Bearer <Five to Nine API key>",
      createKeysIn: `${origin}/app/developer-access`,
      setup: `${origin}/mcp/setup`,
    },
    tools: MCP_TOOLS.map(mcpToolDiscoveryEntry),
    liveDataScope: [
      "Account-owned collections",
      "Account-owned watchlists",
      "Account-owned digests",
      "Saved Meta and landing-page evidence already captured in Five to Nine",
      "Manual external evidence links saved in account-owned collections",
      "Client rooms and scoped account memory saved by this account",
      "Account support case summaries created by this account",
      "Redacted delivery settings and delivery target state owned by this account",
      "Existing source-backed website, blog, and Substack mention observations tied to watchlists",
    ],
    agentActivation: {
      firstWorkflow: AGENT_FIRST_WORKFLOW,
      actionGroups: mcpActionGroups(),
      supportPaths: CUSTOMER_SUPPORT_PATHS,
      blockedCapabilities: AGENT_BLOCKED_CAPABILITIES,
    },
    notLiveYet: [
      "TikTok ingestion",
      "Google or YouTube ingestion",
      "Reddit, LinkedIn, or Pinterest ingestion",
      BROAD_WRITE_API_NON_GOAL,
    ],
  });
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const {
    createAuthenticatedApiLimitContext,
    enforceAuthenticatedApiLimit,
  } = await import("~/lib/authenticated-api-limits.server");
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
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
  const mcpGate = await requireWorkspacePlanFeature(env, workspaceUserId, "mcp_access");
  if (!mcpGate.ok) {
    return mcpGate.response;
  }

  const rpcRequest = await readJsonRpcRequest(request);
  if (!rpcRequest.ok) {
    if (rpcRequest.response) return rpcRequest.response;
    return jsonRpcError(null, -32700, "Parse error");
  }

  if (!isJsonRpcRequest(rpcRequest.value)) {
    return jsonRpcError(null, -32600, "Invalid Request");
  }

  const message = rpcRequest.value;
  const actionName = message.method === "tools/call"
    ? toolActionNameFromParams(message.params)
    : null;
  const limitResponse = await enforceAuthenticatedApiLimit({
    env,
    ...apiLimit,
    operation: actionName ? "api.mcp.action" : "api.mcp",
    ...(actionName ? { actionName } : { actionClass: "read" as const }),
    request,
  });
  if (limitResponse) {
    if (typeof message.id === "undefined") {
      return new Response(null, {
        status: 202,
        headers: noStoreHeaders(),
      });
    }
    return jsonRpcLimitResponse(message.id, limitResponse);
  }

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
        `Use these Agency tools to retrieve Five to Nine account readiness plus account-owned collections, watchlists, digests, memory, and client rooms. Readiness and export tools work with any active Agency customer API key; account action tools require a write-enabled key. Start by checking readiness, then set up or tune watchlists, package evidence, and save memory. Manual external evidence links may appear in collection exports, but do not treat the endpoint as automated TikTok, Google, LinkedIn, Pinterest, broad public write API, or these unavailable capabilities: ${AGENT_BLOCKED_CAPABILITIES.join(", ")}.`,
    });
  }

  if (message.method === "tools/list") {
    return jsonRpcResult(message.id, {
      tools: toolsForApiKey(auth.apiKey),
    });
  }

  if (message.method === "tools/call") {
    const executionContext = cloudflare?.ctx ?? null;
    const result = await callTool(
      env,
      auth.apiKey,
      message.params,
      new URL(request.url).origin,
      executionContext,
      apiLimit,
    );
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
  executionContext: ExecutionContext | null,
  apiLimit: ApiLimitContext,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  if (!params || typeof params !== "object") {
    return { ok: false, message: "tools/call params must be an object." };
  }

  const name = stringField(params, "name");
  const args = objectField(params, "arguments") ?? {};
  if (!name) {
    return { ok: false, message: "tools/call requires name." };
  }
  if (isWriteToolName(name) && !apiKey.actionsWriteEnabled) {
    return { ok: false, message: "This API key is read-only. Create a write-enabled key for audited action tools." };
  }

  const format = normalizeAgentFormat(stringField(args, "format"));
  if (!format) {
    return { ok: false, message: "format must be json." };
  }
  if (format === "slack" && !isSlackDeliveryCustomerFacing()) {
    return { ok: false, message: slackDeliveryUnavailableMessage() };
  }

  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const { requireExportFeature, requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const workspaceUserId = await resolveWorkspaceDataUserId(env, apiKey.userId);

  const exportToolNames = new Set([
    "get_collection_export",
    "get_watchlist_export",
    "get_digest_export",
  ]);
  if (exportToolNames.has(name)) {
    const exportGate = await requireExportFeature(env, workspaceUserId, format);
    if (!exportGate.ok) {
      return { ok: false, message: "This export format is not included in your current plan." };
    }
  }

  if (isWriteToolName(name)) {
    const actionsGate = await requireWorkspacePlanFeature(env, workspaceUserId, "mcp_account_actions");
    if (!actionsGate.ok) {
      return { ok: false, message: "Account actions require the Agency plan." };
    }
  }

  if (name === "get_workspace_readiness") {
    return buildWorkspaceReadinessToolResult(env, apiKey.userId, format);
  }

  if (name === "get_collection_export") {
    return buildCollectionToolResult(env, apiKey.userId, args, format);
  }

  if (name === "get_watchlist_export") {
    return buildWatchlistToolResult(env, apiKey.userId, args, format);
  }

  if (name === "watchlist_runs.list") {
    return buildWatchlistRunsToolResult(env, apiKey.userId, args);
  }

  if (name === "get_digest_export") {
    return buildDigestToolResult(env, apiKey.userId, stringField(args, "digestId"), format);
  }

  if (name === "retest_meta_source") {
    return buildAgentActionToolResult(env, apiKey, "source.meta.retest", args, origin, executionContext, apiLimit);
  }

  if (name === "create_watchlist") {
    return buildAgentActionToolResult(env, apiKey, "watchlist.create", args, origin, executionContext, apiLimit);
  }

  if (name === "update_watchlist") {
    return buildAgentActionToolResult(env, apiKey, "watchlist.update", args, origin, executionContext, apiLimit);
  }

  if (name === "refresh_watchlist") {
    return buildAgentActionToolResult(env, apiKey, "watchlist.refresh", args, origin, executionContext, apiLimit);
  }

  if (name === "pause_watchlist") {
    return buildAgentActionToolResult(env, apiKey, "watchlist.pause", args, origin, executionContext, apiLimit);
  }

  if (name === "resume_watchlist") {
    return buildAgentActionToolResult(env, apiKey, "watchlist.resume", args, origin, executionContext, apiLimit);
  }

  if (name === "create_collection") {
    return buildAgentActionToolResult(env, apiKey, "collection.create", args, origin, executionContext, apiLimit);
  }

  if (name === "add_external_proof") {
    return buildAgentActionToolResult(env, apiKey, "proof.add_external", args, origin, executionContext, apiLimit);
  }

  if (name === "list_delivery_targets") {
    return buildAgentActionToolResult(env, apiKey, "delivery_targets.list", args, origin, executionContext, apiLimit);
  }

  if (name === "update_delivery_settings") {
    return buildAgentActionToolResult(env, apiKey, "delivery_settings.update", args, origin, executionContext, apiLimit);
  }

  if (name === "update_delivery_target") {
    return buildAgentActionToolResult(env, apiKey, "delivery_target.update", args, origin, executionContext, apiLimit);
  }

  if (name === "create_share_link") {
    return buildAgentActionToolResult(env, apiKey, "share.create", args, origin, executionContext, apiLimit);
  }

  if (name === "create_report") {
    return buildAgentActionToolResult(env, apiKey, "report.create", args, origin, executionContext, apiLimit);
  }

  if (name === "share_report") {
    return buildAgentActionToolResult(env, apiKey, "report.share", args, origin, executionContext, apiLimit);
  }

  if (name === "create_counter_move_brief") {
    return buildAgentActionToolResult(env, apiKey, "counter_move_brief.create", args, origin, executionContext, apiLimit);
  }

  if (name === "upsert_memory") {
    return buildAgentActionToolResult(env, apiKey, "memory.upsert", args, origin, executionContext, apiLimit);
  }

  if (name === "list_memory") {
    return buildAgentActionToolResult(env, apiKey, "memory.list", args, origin, executionContext, apiLimit);
  }

  if (name === "upsert_client_room") {
    return buildAgentActionToolResult(env, apiKey, "client_room.upsert", args, origin, executionContext, apiLimit);
  }

  if (name === "list_client_rooms") {
    return buildAgentActionToolResult(env, apiKey, "client_room.list", args, origin, executionContext, apiLimit);
  }

  if (name === "create_support_case") {
    return buildAgentActionToolResult(env, apiKey, "support_case.create", args, origin, executionContext, apiLimit);
  }

  if (name === "list_support_cases") {
    return buildAgentActionToolResult(env, apiKey, "support_case.list", args, origin, executionContext, apiLimit);
  }

  if (name === "list_web_mentions") {
    return buildAgentActionToolResult(env, apiKey, "web_mentions.list", args, origin, executionContext, apiLimit);
  }

  return { ok: false, message: `Unknown tool: ${name}` };
}

async function buildAgentActionToolResult(
  env: AppEnv,
  apiKey: CustomerApiKeyRecord,
  actionName: CustomerAgentActionName,
  args: object,
  origin: string,
  executionContext: ExecutionContext | null,
  apiLimit: ApiLimitContext,
) {
  const {
    customerAgentActionErrorPayload,
    runCustomerAgentAction,
  } = await import("~/lib/customer-agent-actions.server");
  const { verifyAuthenticatedApiIdentity } = await import("~/lib/authenticated-api-limits.server");

  try {
    const result = await runCustomerAgentAction(env, {
      userId: apiKey.userId,
      apiKeyId: apiKey.id,
      idempotencyKey: stringField(args, "idempotencyKey"),
      source: "mcp",
      origin,
      executionContext,
      authorizeExternalEffect: async () => {
        const response = await verifyAuthenticatedApiIdentity({
          ...apiLimit,
          operation: "api.mcp.external-effect",
          actionName,
        });
        if (response) throw response;
      },
    }, actionName, args as Record<string, unknown>);
    if (actionName === "report.create" || actionName === "report.share") {
      const { adaptLegacyReportTransportResult } = await import("~/lib/report");
      return structuredToolResult(adaptLegacyReportTransportResult(result));
    }
    return structuredToolResult(result);
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
  const { resolveWorkspace } = await import("~/lib/workspace.server");
  const workspace = await resolveWorkspace(env, userId);
  const readiness = await getWorkspaceReadiness(env, workspace.workspaceUserId, {
    isMember: workspace.isMember,
    billingOwnerName: workspace.ownerName,
    canManageBilling: !workspace.isMember,
  });
  const structuredContent = readiness as unknown as Record<string, unknown>;

  if (format === "slack") {
    return textToolResult(formatWorkspaceReadinessSummary(readiness), structuredContent);
  }

  return structuredToolResult(structuredContent);
}

function formatWorkspaceReadinessSummary(readiness: WorkspaceReadiness) {
  const lines = [
    `*Five to Nine account readiness:* ${readiness.readyCount} of ${readiness.totalCount} ready`,
    ...readiness.items
      .filter((item) => item.status !== "not_applicable")
      .map((item) => `- ${item.label}: ${item.status.replaceAll("_", " ")} - ${item.detail}`),
  ];

  return lines.join("\n");
}

async function buildCollectionToolResult(
  env: AppEnv,
  userId: string,
  args: object,
  format: AgentFormat,
) {
  const collectionId = stringField(args, "collectionId");
  if (!collectionId) {
    return { ok: false as const, message: "collectionId is required." };
  }

  const pageInput = readMcpPageInput(args);
  if (!pageInput.ok) return pageInput.result;

  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const workspaceUserId = await resolveWorkspaceDataUserId(env, userId);
  const {
    getCollection,
    listCollectionItemsPage,
  } = await import("~/lib/data.server");
  const {
    buildCollectionExportPayload,
    collectionExportResponse,
  } = await import("~/lib/resource-export");
  const collection = await getCollection(env, collectionId, workspaceUserId);
  if (!collection) {
    return toolNotFound("No account-owned collection was found for this API key.");
  }

  const page = await listCollectionItemsPage(env, collection.id, pageInput.value);
  if (format === "slack") {
    return textToolResult(await collectionExportResponse(collection, page.items, "slack").text(), {
      resourceType: "collection",
      resourceId: collection.id,
      format,
      pagination: { limit: pageInput.value.limit, nextCursor: page.nextCursor },
    });
  }

  return structuredToolResult({
    ...buildCollectionExportPayload(collection, page.items),
    pagination: { limit: pageInput.value.limit, nextCursor: page.nextCursor },
  });
}

async function buildWatchlistToolResult(
  env: AppEnv,
  userId: string,
  args: object,
  format: AgentFormat,
) {
  const watchlistId = stringField(args, "watchlistId");
  if (!watchlistId) {
    return { ok: false as const, message: "watchlistId is required." };
  }

  const pageInput = readMcpPageInput(args);
  if (!pageInput.ok) return pageInput.result;

  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const workspaceUserId = await resolveWorkspaceDataUserId(env, userId);
  const {
    getWatchlist,
    listWatchEventsPage,
  } = await import("~/lib/data.server");
  const {
    buildWatchlistExportPayload,
    watchlistExportResponse,
  } = await import("~/lib/resource-export");
  const watchlist = await getWatchlist(env, watchlistId, workspaceUserId);
  if (!watchlist) {
    return toolNotFound("No account-owned watchlist was found for this API key.");
  }

  const page = await listWatchEventsPage(env, watchlist.id, pageInput.value);
  if (format === "slack") {
    return textToolResult(await watchlistExportResponse(watchlist, page.items, "slack").text(), {
      resourceType: "watchlist",
      resourceId: watchlist.id,
      format,
      pagination: { limit: pageInput.value.limit, nextCursor: page.nextCursor },
    });
  }

  return structuredToolResult({
    ...buildWatchlistExportPayload(watchlist, page.items),
    pagination: { limit: pageInput.value.limit, nextCursor: page.nextCursor },
  });
}

async function buildWatchlistRunsToolResult(
  env: AppEnv,
  userId: string,
  args: object,
) {
  const watchlistId = stringField(args, "watchlistId");
  if (!watchlistId) {
    return { ok: false as const, message: "watchlistId is required." };
  }

  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const workspaceUserId = await resolveWorkspaceDataUserId(env, userId);
  const { getWatchlist } = await import("~/lib/data.server");
  const { getLatestWatchlistRun } = await import("~/lib/data/watchlist-runs.server");
  const { listCaptureAttemptsForRun } = await import("~/lib/data/watchlist-run-capture-attempts.server");

  const watchlist = await getWatchlist(env, watchlistId, workspaceUserId);
  if (!watchlist) {
    return toolNotFound("No account-owned watchlist was found for this API key.");
  }

  const run = await getLatestWatchlistRun(env, watchlist.id);
  if (!run) {
    return structuredToolResult({
      watchlist_id: watchlist.id,
      run: null,
      capture_attempts: [],
    });
  }

  const captureAttempts = await listCaptureAttemptsForRun(env, run);

  return structuredToolResult({
    watchlist_id: watchlist.id,
    run: {
      id: run.id,
      status: run.status,
      trigger_type: run.triggerType,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      pages_scanned: run.pagesScanned,
      page_budget: run.pageBudget,
      error_code: run.errorCode,
      error_message: run.errorMessage,
    },
    capture_attempts: captureAttempts.map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      reason_code: attempt.reasonCode,
      screenshot_artifact_key: attempt.screenshotArtifactKey,
      error_message: attempt.errorMessage,
      url_checked: attempt.urlChecked,
      checked_at: attempt.checkedAt,
    })),
  });
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

  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const workspaceUserId = await resolveWorkspaceDataUserId(env, userId);
  const {
    getDigest,
  } = await import("~/lib/data.server");
  const {
    buildDigestExportPayload,
    digestExportResponse,
  } = await import("~/lib/resource-export");
  const digest = await getDigest(env, digestId);
  if (!digest || digest.userId !== workspaceUserId) {
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

function toolsForApiKey(apiKey: CustomerApiKeyRecord) {
  const tools = apiKey.actionsWriteEnabled
    ? MCP_TOOLS
    : MCP_TOOLS.filter((tool) => !isWriteToolName(tool.name));

  return tools.map(mcpToolDiscoveryEntry);
}

function isWriteToolName(name: string) {
  return WRITE_TOOL_NAMES.has(name);
}

function mcpToolDiscoveryEntry(tool: (typeof MCP_TOOLS)[number]) {
  const requiresWriteEnabled = isWriteToolName(tool.name);
  return {
    ...tool,
    planRequirement: API_PLAN_REQUIREMENT,
    requiresWriteEnabled,
    credentialRequirement: requiresWriteEnabled
      ? WRITE_ENABLED_API_KEY_REQUIREMENT
      : READ_ONLY_API_KEY_REQUIREMENT,
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

function toolActionNameFromParams(params: unknown) {
  if (!params || typeof params !== "object") return null;
  const name = stringField(params, "name");
  return name ? TOOL_ACTION_NAMES[name] ?? null : null;
}

function readMcpPageInput(args: object) {
  const record = args as Record<string, unknown>;
  const rawLimit = record.limit;
  const limit = typeof rawLimit === "undefined" ? 100 : rawLimit;
  const rawCursor = record.cursor;
  const cursor = typeof rawCursor === "undefined" ? null : rawCursor;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    (cursor !== null && (
      typeof cursor !== "string" ||
      cursor.length > 512 ||
      !decodeListCursor(cursor)
    ))
  ) {
    return {
      ok: false as const,
      result: {
        ok: false as const,
        message: "Use limit 1–200 and a cursor returned by Five to Nine.",
      },
    };
  }
  return { ok: true as const, value: { limit, cursor } };
}

async function readJsonRpcRequest(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUTHENTICATED_API_BODY_BYTES) {
    return { ok: false as const, response: mcpRequestTooLargeResponse() };
  }
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_AUTHENTICATED_API_BODY_BYTES) {
      return { ok: false as const, response: mcpRequestTooLargeResponse() };
    }
    return {
      ok: true as const,
      value: JSON.parse(body),
    };
  } catch {
    return { ok: false as const, response: null };
  }
}

function mcpRequestTooLargeResponse() {
  return Response.json(
    {
      error: "request_too_large",
      message: "Authenticated MCP payloads must be 64 KB or smaller.",
    },
    { status: 413, headers: noStoreHeaders() },
  );
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

function resourceInputSchema(idName: string, options: { paginated?: boolean } = {}) {
  return {
    type: "object",
    properties: {
      [idName]: {
        type: "string",
        description: `Five to Nine ${idName} owned by the API-key account.`,
      },
      format: {
        type: "string",
        enum: customerAgentFormatValues(),
        default: "json",
        description: customerAgentFormatDescription(),
      },
      ...(options.paginated ? {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 100,
        },
        cursor: {
          type: "string",
          maxLength: 512,
          description: "Opaque nextCursor returned by the previous page.",
        },
      } : {}),
    },
    required: [idName],
    additionalProperties: false,
  };
}

function customerAgentFormatValues(): AgentFormat[] {
  return ["json"];
}

function customerAgentFormatDescription() {
  return "Use json for structured agent context.";
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
    required: ["watchlistId", "idempotencyKey"],
    additionalProperties: false,
  };
}

function reportInputSchema(
  options: { requiresIdempotency?: boolean; requiresReview?: boolean } = {},
) {
  const required = [
    ...(options.requiresIdempotency ? ["idempotencyKey"] : []),
    ...(options.requiresReview ? ["reviewed"] : []),
  ];
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
      ...(options.requiresReview ? {
        reviewed: {
          type: "boolean",
          const: true,
          description: "Confirms the current proof was explicitly reviewed before this share is created.",
        },
      } : {}),
      idempotencyKey: idempotencyKeySchema(),
    },
    required,
    anyOf: [
      { required: ["reportId"] },
      { required: ["resourceType", "resourceId"] },
    ],
    additionalProperties: false,
  };
}

function memoryMutationInputSchema() {
  return {
    type: "object",
    properties: {
      scope: memoryScopeSchema(),
      key: {
        type: "string",
      },
      value: {
        type: ["object", "string", "number", "boolean", "array", "null"],
      },
      source: {
        type: "string",
      },
      watchlistId: {
        type: "string",
      },
      clientRoomId: {
        type: "string",
      },
      idempotencyKey: idempotencyKeySchema(),
    },
    required: ["key", "value", "idempotencyKey"],
    additionalProperties: false,
  };
}

function clientRoomMutationInputSchema() {
  return {
    type: "object",
    properties: {
      roomId: {
        type: "string",
        minLength: 1,
        description: "Optional existing client room id to update.",
      },
      expectedUpdatedAt: {
        type: "string",
        minLength: 1,
        description: "Required last observed updatedAt value when roomId is provided.",
      },
      name: {
        type: "string",
      },
      clientLabel: {
        type: "string",
      },
      status: {
        type: "string",
        enum: ["active", "archived"],
        default: "active",
      },
      resourceRefs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            resourceType: {
              type: "string",
              enum: ["collection", "watchlist", "digest", "report"],
            },
            resourceId: {
              type: "string",
            },
            label: {
              type: "string",
            },
          },
          required: ["resourceType", "resourceId"],
          additionalProperties: false,
        },
      },
      notes: {
        type: "object",
        additionalProperties: true,
      },
      idempotencyKey: idempotencyKeySchema(),
    },
    required: ["name", "idempotencyKey"],
    oneOf: [
      { required: ["roomId", "expectedUpdatedAt"] },
      {
        not: {
          anyOf: [
            { required: ["roomId"] },
            { required: ["expectedUpdatedAt"] },
          ],
        },
      },
    ],
    additionalProperties: false,
  };
}

function memoryScopeSchema() {
  return {
    type: "string",
    enum: ["workspace", "customer", "brand", "competitor"],
    default: "workspace",
  };
}

function idempotencyKeySchema() {
  return {
    type: "string",
    description: "Stable key for safe retry. Replays only when the previous matching action succeeded.",
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

function jsonRpcLimitResponse(id: JsonRpcId, response: Response) {
  const isRateLimited = response.status === 429;
  const retryAfterSeconds = retryAfterSecondsFromResponse(response);
  const retryAfter = response.headers.get("Retry-After")?.trim();
  return Response.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: isRateLimited ? -32029 : -32003,
        message: isRateLimited
          ? "Too many authenticated requests. Please try again shortly."
          : "Authenticated request limits are temporarily unavailable. Please try again shortly.",
        data: {
          error: isRateLimited ? "rate_limited" : "rate_limit_unavailable",
          retryAfterSeconds,
        },
      },
    },
    {
      status: response.status,
      headers: {
        ...noStoreHeaders(),
        ...(retryAfter ? { "Retry-After": retryAfter } : {}),
      },
    },
  );
}

function retryAfterSecondsFromResponse(response: Response) {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value >= 1 ? Math.ceil(value) : 1;
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
