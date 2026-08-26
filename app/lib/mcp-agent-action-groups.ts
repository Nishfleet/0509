import {
  AGENT_ACTION_GROUPS,
  type AgentCatalogActionName,
} from "~/lib/agent-action-catalog";

export const MCP_TOOL_NAME_BY_AGENT_ACTION = {
  get_workspace_readiness: "get_workspace_readiness",
  "source.meta.retest": "retest_meta_source",
  "watchlist.create": "create_watchlist",
  "watchlist.update": "update_watchlist",
  "watchlist.refresh": "refresh_watchlist",
  "watchlist.pause": "pause_watchlist",
  "watchlist.resume": "resume_watchlist",
  "collection.create": "create_collection",
  "proof.add_external": "add_external_proof",
  "share.create": "create_share_link",
  "report.create": "create_report",
  "report.share": "share_report",
  "counter_move_brief.create": "create_counter_move_brief",
  "memory.upsert": "upsert_memory",
  "memory.list": "list_memory",
  "client_room.upsert": "upsert_client_room",
  "client_room.list": "list_client_rooms",
  "support_case.create": "create_support_case",
  "support_case.list": "list_support_cases",
  "delivery_targets.list": "list_delivery_targets",
  "delivery_settings.update": "update_delivery_settings",
  "delivery_target.update": "update_delivery_target",
  "web_mentions.list": "list_web_mentions",
} as const satisfies Record<AgentCatalogActionName, string>;

export function mcpActionGroups() {
  return AGENT_ACTION_GROUPS.map((group) => ({
    ...group,
    actions: group.actions.map((actionName) => MCP_TOOL_NAME_BY_AGENT_ACTION[actionName]),
  }));
}
