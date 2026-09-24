import type { ZodType } from "zod";
import { createDocument } from "zod-openapi";

import { alertsResultSchema, briefResultSchema, competitorsResultSchema } from "./schemas";

const API_PATHS = {
  brief: "/api/v1/brief",
  competitors: "/api/v1/competitors",
  alerts: "/api/v1/alerts",
} as const;

function read(summary: string, schema: ZodType) {
  return {
    get: {
      summary,
      security: [{ apiKey: [] }],
      responses: {
        "200": { description: summary, content: { "application/json": { schema } } },
        "401": { description: "Missing or invalid API key" },
        "403": { description: "The key's owner has not finished signing up" },
        "429": { description: "Too many requests; retry after a minute" },
      },
    },
  };
}

export function openApiDocument(origin: string) {
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Five to Nine API",
      version: "1.0.0",
      description:
        "Read-only access to your own Five to Nine workspace. Create a key in Settings, then send it as 'Authorization: Bearer <key>'. AI agents can use the MCP server at /mcp instead.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "An API key from Settings" } },
    },
    paths: {
      [API_PATHS.brief]: read("Your latest weekly brief", briefResultSchema),
      [API_PATHS.competitors]: read("Your tracked and suggested competitors", competitorsResultSchema),
      [API_PATHS.alerts]: read("Your recent alerts", alertsResultSchema),
    },
  });
}
