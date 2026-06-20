import type { LoaderFunctionArgs } from "react-router";

import {
  AGENT_BLOCKED_CAPABILITIES,
  AGENT_FIRST_WORKFLOW,
  BROAD_WRITE_API_NON_GOAL,
  CUSTOMER_SUPPORT_PATHS,
  READ_ONLY_API_KEY_REQUIREMENT,
  WRITE_ENABLED_API_KEY_REQUIREMENT,
  apiActionNames,
  auditedAgentActionGroups,
} from "~/lib/agent-action-catalog";

export async function loader({ request }: LoaderFunctionArgs) {
  const origin = new URL(request.url).origin;
  return Response.json(
    {
      name: "Five to Nine Customer API",
      status: "live",
      auth: {
        type: "bearer",
        header: "Authorization: Bearer <Five to Nine API key>",
        createKeysIn: `${origin}/app/sources`,
      },
      endpoints: [
        {
          method: "POST",
          path: "/api/mcp",
          formats: ["mcp-json-rpc"],
          requiresWriteEnabled: false,
          credentialRequirement:
            `MCP discovery, readiness, and export tools: ${READ_ONLY_API_KEY_REQUIREMENT} Audited workspace action tools: ${WRITE_ENABLED_API_KEY_REQUIREMENT}`,
        },
        {
          method: "GET",
          path: "/api/v1/workspace-readiness",
          formats: ["json"],
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        },
        {
          method: "POST",
          path: "/api/v1/actions",
          formats: ["json"],
          actions: apiActionNames(),
          requiresWriteEnabled: true,
          credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
        },
        {
          method: "GET",
          path: "/api/v1/collections/{collectionId}",
          formats: ["json", "csv", "slack"],
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        },
        {
          method: "GET",
          path: "/api/v1/watchlists/{watchlistId}",
          formats: ["json", "csv", "slack"],
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        },
        {
          method: "GET",
          path: "/api/v1/digests/{digestId}",
          formats: ["json", "csv", "slack"],
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        },
      ],
      liveDataScope: [
        "Meta ad proof saved in this account",
        "Landing-page proof captured by this account",
        "Watchlist changes and digest items owned by this account",
        "Manual external proof links, scoped memory, client rooms, redacted delivery settings, and existing web mention observations owned by this account",
      ],
      agentActivation: {
        firstWorkflow: AGENT_FIRST_WORKFLOW,
        readinessEndpoint: "/api/v1/workspace-readiness",
        actionGroups: auditedAgentActionGroups(),
        supportPaths: CUSTOMER_SUPPORT_PATHS,
        blockedCapabilities: AGENT_BLOCKED_CAPABILITIES,
      },
      notLiveYet: [
        "TikTok ingestion",
        "Google or YouTube ingestion",
        "LinkedIn or Pinterest ingestion",
        BROAD_WRITE_API_NON_GOAL,
      ],
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
