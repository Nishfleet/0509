import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { readAgentAlerts, readAgentBrief, readAgentCompetitors } from "./read.server";
import { alertsResultSchema, briefResultSchema, competitorsResultSchema } from "./schemas";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TOOL_FAILED = "Five to Nine could not read this right now. Try again in a minute.";

function result<T extends Record<string, unknown>>(value: T) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}

export async function toolResult<T extends Record<string, unknown>>(read: () => Promise<T>) {
  try {
    return result(await read());
  } catch (error) {
    console.error(JSON.stringify({ event: "agent.mcp_tool_failed", message: error instanceof Error ? error.message : String(error) }));
    return { content: [{ type: "text" as const, text: TOOL_FAILED }], isError: true };
  }
}

function createServer(workspaceId: string): McpServer {
  const server = new McpServer(
    { name: "five-to-nine", title: "Five to Nine", version: "1.0.0" },
    {
      instructions:
        "Five to Nine watches the user's competitors (ads, website changes, mentions, hiring) and ranks the user against them every week. Everything here is read-only and limited to the signed-in user's own workspace.",
    },
  );

  server.registerTool(
    "get_brief",
    {
      title: "This week's brief",
      description:
        "The latest weekly brief: where the user ranks against their competitors, the changes worth reading first and why each matters, per-competitor standing, and whether the user's own site had problems.",
      outputSchema: briefResultSchema,
      annotations: READ_ONLY,
    },
    async () => toolResult(() => readAgentBrief(workspaceId)),
  );

  server.registerTool(
    "list_competitors",
    {
      title: "Competitors",
      description: "The competitors the user tracks, plus the brands suggested as competitors that are waiting for the user's yes.",
      outputSchema: competitorsResultSchema,
      annotations: READ_ONLY,
    },
    async () => toolResult(() => readAgentCompetitors(workspaceId)),
  );

  server.registerTool(
    "list_alerts",
    {
      title: "Alerts",
      description: "Recent alerts for the user: weekly briefs that could not be delivered, and takedown notices.",
      outputSchema: alertsResultSchema,
      annotations: READ_ONLY,
    },
    async () => toolResult(() => readAgentAlerts(workspaceId)),
  );

  return server;
}

export function serveMcp(request: Request, workspaceId: string): Promise<Response> {
  return createMcpHandler(() => createServer(workspaceId)).fetch(request);
}
