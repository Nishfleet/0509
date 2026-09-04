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
import {
  CUSTOMER_API_READ_PLAN_REQUIREMENT,
  CUSTOMER_API_WRITE_PLAN_REQUIREMENT,
} from "~/lib/plan-feature-gate.server";
import { isSlackDeliveryCustomerFacing } from "~/lib/ga-customer-surface";

const API_READ_PLAN_REQUIREMENT = CUSTOMER_API_READ_PLAN_REQUIREMENT;
const API_WRITE_PLAN_REQUIREMENT = CUSTOMER_API_WRITE_PLAN_REQUIREMENT;

function customerExportFormats() {
  return isSlackDeliveryCustomerFacing() ? ["json", "csv", "slack"] : ["json", "csv"];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const origin = new URL(request.url).origin;
  const toolActivation = {
    firstWorkflow: AGENT_FIRST_WORKFLOW,
    readinessEndpoint: "/api/v1/workspace-readiness",
    actionGroups: auditedAgentActionGroups(),
    supportPaths: CUSTOMER_SUPPORT_PATHS,
    blockedCapabilities: AGENT_BLOCKED_CAPABILITIES,
  };

  return Response.json(
    {
      name: "Five to Nine Customer API",
      status: "live",
      planRequirement: `Read-only: ${CUSTOMER_API_READ_PLAN_REQUIREMENT}. Agent actions: ${CUSTOMER_API_WRITE_PLAN_REQUIREMENT}.`,
      auth: {
        type: "bearer",
        header: "Authorization: Bearer <Five to Nine API key>",
        createKeysIn: `${origin}/app/developer-access`,
      },
      endpoints: [
        {
          method: "POST",
          path: "/api/mcp",
          formats: ["mcp-json-rpc"],
          planRequirement: API_READ_PLAN_REQUIREMENT,
          requiresWriteEnabled: false,
          credentialRequirement:
            `Read-only tools: ${READ_ONLY_API_KEY_REQUIREMENT} Agent action tools: ${WRITE_ENABLED_API_KEY_REQUIREMENT}`,
        },
        {
          method: "GET",
          path: "/api/v1/workspace-readiness",
          formats: ["json"],
          planRequirement: API_READ_PLAN_REQUIREMENT,
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        },
        {
          method: "POST",
          path: "/api/v1/actions",
          formats: ["json"],
          actions: apiActionNames(),
          planRequirement: API_WRITE_PLAN_REQUIREMENT,
          requiresWriteEnabled: true,
          credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
        },
        {
          method: "GET",
          path: "/api/v1/collections/{collectionId}",
          formats: customerExportFormats(),
          planRequirement: API_READ_PLAN_REQUIREMENT,
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        },
        {
          method: "GET",
          path: "/api/v1/watchlists/{watchlistId}",
          formats: customerExportFormats(),
          planRequirement: API_READ_PLAN_REQUIREMENT,
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        },
        {
          method: "GET",
          path: "/api/v1/watchlists/{watchlistId}/runs/latest",
          formats: ["json"],
          planRequirement: API_READ_PLAN_REQUIREMENT,
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        },
        {
          method: "GET",
          path: "/api/v1/digests/{digestId}",
          formats: customerExportFormats(),
          planRequirement: API_READ_PLAN_REQUIREMENT,
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        },
      ],
      liveDataScope: [
        "Meta ad evidence saved in this account",
        "Landing-page evidence captured by this account",
        "Watchlist changes and digest items owned by this account",
        "Manual external evidence links, scoped memory, client rooms, redacted delivery settings, and existing web mention observations owned by this account",
      ],
      agentActivation: toolActivation,
      toolActivation,
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
