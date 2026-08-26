import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BROAD_WRITE_API_NON_GOAL,
} from "~/lib/agent-action-catalog";

const EXPECTED_MCP_ACTION_GROUPS = [
  {
    label: "Readiness and setup",
    requiresWriteEnabled: false,
    actions: ["get_workspace_readiness"],
  },
  {
    label: "Source health",
    requiresWriteEnabled: true,
    actions: ["retest_meta_source"],
  },
  {
    label: "Watchlists",
    requiresWriteEnabled: true,
    actions: ["create_watchlist", "update_watchlist", "refresh_watchlist", "pause_watchlist", "resume_watchlist"],
  },
  {
    label: "Evidence and reports",
    requiresWriteEnabled: true,
    actions: [
      "create_collection",
      "add_external_proof",
      "create_share_link",
      "create_report",
      "share_report",
      "create_counter_move_brief",
    ],
  },
  {
    label: "Context and client rooms",
    requiresWriteEnabled: true,
    actions: ["upsert_memory", "list_memory", "upsert_client_room", "list_client_rooms"],
  },
  {
    label: "Support",
    requiresWriteEnabled: true,
    actions: ["create_support_case", "list_support_cases"],
  },
  {
    label: "Delivery controls",
    requiresWriteEnabled: true,
    actions: ["list_delivery_targets", "update_delivery_settings", "update_delivery_target"],
  },
  {
    label: "Presence observations",
    requiresWriteEnabled: true,
    actions: ["list_web_mentions"],
  },
  {
    label: "Offer change history",
    requiresWriteEnabled: false,
    actions: ["get_change_history", "get_offer_state_at", "diff_offer", "list_suppressed"],
  },
] as const;

const READ_EXPORT_TOOL_NAMES = [
  "get_collection_export",
  "get_watchlist_export",
  "get_digest_export",
] as const;
const READ_EXPORT_TOOL_NAME_SET = new Set<string>(READ_EXPORT_TOOL_NAMES);
const READ_ONLY_API_KEY_REQUIREMENT = "Requires an active Agency customer API key.";
const WRITE_ENABLED_API_KEY_REQUIREMENT = "Requires a write-enabled Agency customer API key.";

async function loadDocs() {
  const { loader } = await import("~/routes/api.mcp");
  return loader({
    context: { cloudflare: { env: {} } },
    request: new Request("https://0509.io/api/mcp"),
  } as never);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("MCP route discovery", () => {
  it("documents exact live action groups and write-key boundaries", async () => {
    const response = await loadDocs();
    const body = await response.json() as {
      status: string;
      planRequirement: string;
      endpoint: string;
      tools: Array<{
        name: string;
        planRequirement: string;
        requiresWriteEnabled: boolean;
        credentialRequirement: string;
        inputSchema: unknown;
      }>;
      agentActivation: {
        firstWorkflow: Array<{ label: string }>;
        actionGroups: Array<{
          label: string;
          actions: string[];
          requiresWriteEnabled: boolean;
          credentialRequirement: string;
        }>;
        supportPaths: Array<{ label: string }>;
        blockedCapabilities: string[];
      };
      notLiveYet: string[];
    };

    const toolNames = body.tools.map((tool) => tool.name);
    const groupedActionNames = body.agentActivation.actionGroups.flatMap((group) => group.actions);
    const expectedGroupedActionNames = EXPECTED_MCP_ACTION_GROUPS.flatMap((group) => group.actions);
    const expectedWriteToolNameSet = new Set<string>(
      EXPECTED_MCP_ACTION_GROUPS
        .filter((group) => group.requiresWriteEnabled)
        .flatMap((group) => group.actions),
    );

    expect(body.status).toBe("live");
    expect(body.planRequirement).toBe("Agency");
    expect(body.endpoint).toBe("https://0509.io/api/mcp");
    expect(body.agentActivation.firstWorkflow.map((step) => step.label)).toContain("Check readiness");
    expect(body.agentActivation.actionGroups.map(({ label, requiresWriteEnabled, actions }) => ({
      label,
      requiresWriteEnabled,
      actions,
    }))).toEqual(EXPECTED_MCP_ACTION_GROUPS);
    expect(
      body.agentActivation.actionGroups
        .filter((group) => group.requiresWriteEnabled)
        .every((group) => group.credentialRequirement.includes("write-enabled")),
    ).toBe(true);
    expect(groupedActionNames).toEqual(expectedGroupedActionNames);
    expect(new Set(groupedActionNames).size).toBe(groupedActionNames.length);
    groupedActionNames.forEach((actionName) => {
      expect(toolNames).toContain(actionName);
      expect(actionName).not.toMatch(/\./);
    });
    expect(toolNames.filter((name) => !READ_EXPORT_TOOL_NAME_SET.has(name)).sort()).toEqual(
      [...expectedGroupedActionNames].sort(),
    );
    body.tools
      .filter((tool) => tool.name === "get_workspace_readiness" || READ_EXPORT_TOOL_NAME_SET.has(tool.name))
      .forEach((tool) => {
        expect(JSON.stringify(tool.inputSchema)).toContain('"json"');
      });
    body.tools.forEach((tool) => {
      expect(JSON.stringify(tool.inputSchema)).not.toContain('"slack"');
      expect(JSON.stringify(tool.inputSchema)).not.toContain('"whatsapp"');
      expect(JSON.stringify(tool.inputSchema)).not.toContain("Slack-ready");
      expect(JSON.stringify(tool.inputSchema)).not.toContain('"reddit"');
    });
    expect(body.tools.find((tool) => tool.name === "list_web_mentions")?.inputSchema).toMatchObject({
      properties: {
        sources: {
          items: {
            enum: ["blog", "substack", "web"],
          },
        },
      },
    });
    body.tools.forEach((tool) => {
      const requiresWriteEnabled = expectedWriteToolNameSet.has(tool.name);
      expect(tool).toMatchObject({
        planRequirement: "Agency",
        requiresWriteEnabled,
        credentialRequirement: requiresWriteEnabled
          ? WRITE_ENABLED_API_KEY_REQUIREMENT
          : READ_ONLY_API_KEY_REQUIREMENT,
      });
    });
    expect(body.agentActivation.supportPaths.map((path) => path.label)).toContain("Security and deletion requests");
    expect(body.agentActivation.blockedCapabilities).toContain("secret-bearing integration setup");
    expect(body.agentActivation.blockedCapabilities).toContain("customer API key creation, rotation, and revocation");
		expect(body.agentActivation.blockedCapabilities).toContain("report branding configuration and logo uploads");
    expect(body.notLiveYet).toContain("TikTok ingestion");
    expect(body.notLiveYet).toContain("Reddit, LinkedIn, or Pinterest ingestion");
    expect(body.notLiveYet).toContain(BROAD_WRITE_API_NON_GOAL);
    expect(body.notLiveYet).not.toContain("secret-bearing integration setup");
    expect(body.notLiveYet).not.toContain("MCP server");
    expect(JSON.stringify(body)).not.toContain("account-owned boards");
    expect(JSON.stringify(body)).not.toContain("Reddit observations");
  });
});
