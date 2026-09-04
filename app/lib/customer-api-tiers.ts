/**
 * BET 6 customer-API tier table — the single source of truth for which
 * customer API / MCP tools are readable on which plan. Read tools are covered
 * by the route-level `api_access` / `mcp_access` features (free + Scout);
 * write tools require `mcp_account_actions` (Agency) on top.
 *
 * Plain module (no `.server` suffix) so the `/api/docs` route component can
 * render the per-tool tier table client-safely. `plan-feature-gate.server.ts`
 * re-exports these for server gates, keeping the gate module the one import
 * point routes use — one definition, no drift.
 */

export const MCP_READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  "get_workspace_readiness",
  "get_collection_export",
  "get_watchlist_export",
  "watchlist_runs.list",
  "get_digest_export",
  "list_memory",
  "list_client_rooms",
  "list_support_cases",
  "list_web_mentions",
]);

export const MCP_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "retest_meta_source",
  "create_watchlist",
  "update_watchlist",
  "refresh_watchlist",
  "pause_watchlist",
  "resume_watchlist",
  "create_collection",
  "add_external_proof",
  "list_delivery_targets",
  "update_delivery_settings",
  "update_delivery_target",
  "create_share_link",
  "create_report",
  "share_report",
  "create_counter_move_brief",
  "upsert_memory",
  "upsert_client_room",
  "create_support_case",
]);

export const CUSTOMER_API_READ_PLAN_REQUIREMENT = "Free and Scout";
export const CUSTOMER_API_WRITE_PLAN_REQUIREMENT = "Agency";

export function isMcpWriteToolName(toolName: string) {
  return MCP_WRITE_TOOL_NAMES.has(toolName);
}

export function customerApiToolPlanRequirement(toolName: string) {
  return isMcpWriteToolName(toolName)
    ? CUSTOMER_API_WRITE_PLAN_REQUIREMENT
    : CUSTOMER_API_READ_PLAN_REQUIREMENT;
}