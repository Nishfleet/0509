import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import {
  readAgentAlerts,
  readAgentBrief,
  readAgentCompetitor,
  readAgentCompetitors,
  readAgentStanding,
} from "./read.server";
import {
  alertsResultSchema,
  briefResultSchema,
  competitorArgsSchema,
  competitorResultSchema,
  competitorsResultSchema,
  standingResultSchema,
} from "./schemas";

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
    "get_standing",
    {
      title: "This week's standing",
      description: "Where the user ranks against their tracked competitors this week, the movement since last week, the one-line why, and one line per competitor. Paused competitors are left out.",
      outputSchema: standingResultSchema,
      annotations: READ_ONLY,
    },
    async () => result(await readAgentStanding(workspaceId)),
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
    "get_competitor",
    {
      title: "One competitor",
      description:
        "One tracked competitor: its state (on, or paused), how many of its pages are watched and when they were last checked, and its website changes from the last 90 days. Returns null for an id that is not one of the user's competitors.",
      inputSchema: competitorArgsSchema,
      outputSchema: competitorResultSchema,
      annotations: READ_ONLY,
    },
    async ({ competitorId }) => result(await readAgentCompetitor(workspaceId, competitorId)),
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
