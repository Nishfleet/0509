import type { PlanFeature } from "~/lib/plan-entitlements";

export const CHANGE_HISTORY_ACTION_NAMES = [
  "get_change_history",
  "get_offer_state_at",
  "diff_offer",
  "list_suppressed",
] as const;

export type ChangeHistoryActionName = (typeof CHANGE_HISTORY_ACTION_NAMES)[number];

const CHANGE_HISTORY_ACTION_NAME_SET: ReadonlySet<string> = new Set(CHANGE_HISTORY_ACTION_NAMES);

export function isChangeHistoryActionName(name: string | null | undefined): name is ChangeHistoryActionName {
  return typeof name === "string" && CHANGE_HISTORY_ACTION_NAME_SET.has(name);
}

/**
 * Packaging flag for BET 6. Default closed: Agency-only via mcp_access /
 * api_access. Open only after Nish sign-off — a worker sets
 * CHANGE_HISTORY_READ_OPEN=1. Does not change who can mint customer API keys.
 */
export function isChangeHistoryReadOpen(env: { CHANGE_HISTORY_READ_OPEN?: string }): boolean {
  const value = env.CHANGE_HISTORY_READ_OPEN?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function changeHistoryPlanFeature(
  env: { CHANGE_HISTORY_READ_OPEN?: string },
  surface: "mcp" | "api",
): PlanFeature {
  if (isChangeHistoryReadOpen(env)) {
    return "weekly_digest";
  }
  return surface === "mcp" ? "mcp_access" : "api_access";
}
