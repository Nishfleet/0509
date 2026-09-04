import type { AppEnv } from "~/lib/env.server";
import {
  canUsePlanFeature,
  type PlanFeature,
  type PlanFamily,
} from "~/lib/plan-entitlements";
import { getUserPlan } from "~/lib/plan.server";

export type ExportFormat = "csv" | "json" | "slack";

/**
 * BET 6 tier table — the single source of truth for which customer API / MCP
 * tools are readable on which plan. Read tools are covered by the route-level
 * `api_access` / `mcp_access` features (free + Scout); write tools require
 * `mcp_account_actions` (Agency) on top. Routes, discovery metadata, the
 * `/api/docs` per-tool table, and the integration test all read from here so
 * the plan boundary cannot drift.
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

export const CUSTOMER_AGENT_ACTION_FEATURES = {
  "share.create": "share_links",
  "report.create": "client_reports",
  "report.share": "share_links",
  "counter_move_brief.create": "client_reports",
  "delivery_settings.update": null,
  "delivery_target.update": null,
  "delivery_targets.list": null,
} as const satisfies Record<string, PlanFeature | null>;

export const ROUTE_FEATURE_REQUIREMENTS = [
  { routeId: "api.v1.$resourceType.$resourceId", feature: "api_access" as PlanFeature },
  { routeId: "api.v1.actions", feature: "api_access" as PlanFeature },
  { routeId: "api.mcp", feature: "mcp_access" as PlanFeature },
  { routeId: "export.$resourceType.$resourceId", feature: "export_json" as PlanFeature },
  { routeId: "app.reports", feature: "client_reports" as PlanFeature },
  { routeId: "app.team", feature: "team_workspace" as PlanFeature },
  { routeId: "team.accept", feature: "team_workspace" as PlanFeature },
  { routeId: "app.watchlists", action: "save-delivery-config", feature: "slack_delivery" as PlanFeature },
  { routeId: "app.watchlists", action: "save-delivery-config", feature: "high_priority_alerts" as PlanFeature },
  { routeId: "app.watchlists", action: "add-delivery-target", feature: "slack_delivery" as PlanFeature },
  { routeId: "app.watchlists", action: "send-test-email", feature: "email_delivery" as PlanFeature },
  { routeId: "app.notifications", action: "save-slack-webhook", feature: "slack_delivery" as PlanFeature },
  { routeId: "app.notifications", action: "save-teams-webhook", feature: "teams_delivery" as PlanFeature },
  { routeId: "app.account", action: "save-report-branding", feature: "agency_branding" as PlanFeature },
  { routeId: "share.$token", feature: "agency_branding" as PlanFeature },
	{ routeId: "share.$token.pdf", feature: "pdf_reports" as PlanFeature },
	{ routeId: "app.reports", action: "download-pdf", feature: "pdf_reports" as PlanFeature },
  { routeId: "app.reports", surface: "preparedBy", feature: "agency_branding" as PlanFeature },
  { routeId: "delivery.server", surface: "deliverWeeklyDigest", feature: "slack_delivery" as PlanFeature },
  { routeId: "delivery.server", surface: "deliverWatchlistAlerts", feature: "high_priority_alerts" as PlanFeature },
] as const;

export interface DeliveryConfigSaveInput {
  instantEnabled?: boolean;
  slackEnabled?: boolean;
  teamsEnabled?: boolean;
  emailEnabled?: boolean;
  channel?: string;
}

export interface DeliveryConfigShape {
  instantEnabled: boolean;
  slackEnabled: boolean;
  teamsEnabled: boolean;
  emailEnabled: boolean;
}

export function exportFormatFeature(format: ExportFormat): PlanFeature {
  if (format === "csv") return "export_csv";
  if (format === "slack") return "export_slack_ready";
  return "export_json";
}

export function normalizeExportFormat(value: string | null | undefined): ExportFormat {
  if (value === "csv") return "csv";
  if (value === "slack") return "slack";
  return "json";
}

export async function requireWorkspacePlanFeature(
  env: AppEnv,
  workspaceUserId: string,
  feature: PlanFeature,
) {
  const plan = await getUserPlan(env, workspaceUserId);
  if (!canUsePlanFeature(plan, feature)) {
    return {
      ok: false as const,
      plan,
      response: planFeatureDeniedResponse(feature, plan),
    };
  }
  return { ok: true as const, plan };
}

export function planFeatureDeniedResponse(feature: PlanFeature, plan: PlanFamily) {
  return Response.json(
    {
      error: "plan_gated",
      feature,
      plan,
      message: "This capability is not included in your current plan.",
    },
    {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function planFeatureDeniedHtml(message = "This capability is not included in your current plan.") {
  return new Response(message, { status: 403 });
}

export async function requireExportFeature(
  env: AppEnv,
  workspaceUserId: string,
  format: ExportFormat,
) {
  const feature = exportFormatFeature(format);
  return requireWorkspacePlanFeature(env, workspaceUserId, feature);
}

export async function requireCustomerAgentActionFeature(
  env: AppEnv,
  workspaceUserId: string,
  actionName: string,
  input: Record<string, unknown>,
) {
  const mapped = CUSTOMER_AGENT_ACTION_FEATURES[actionName as keyof typeof CUSTOMER_AGENT_ACTION_FEATURES];
  if (mapped) {
    const gate = await requireWorkspacePlanFeature(env, workspaceUserId, mapped);
    if (!gate.ok) return gate;
  }

  if (actionName === "delivery_settings.update" || actionName === "delivery_target.update") {
    if (
      readBoolean(input, "slackEnabled") ||
      readString(input, "channel") === "slack" ||
      readBoolean(input, "teamsEnabled") ||
      readString(input, "channel") === "teams"
    ) {
      const gate = await requireWorkspacePlanFeature(env, workspaceUserId, "slack_delivery");
      if (!gate.ok) return gate;
    }
    if (readBoolean(input, "instantEnabled")) {
      const gate = await requireWorkspacePlanFeature(env, workspaceUserId, "high_priority_alerts");
      if (!gate.ok) return gate;
    }
  }

  return { ok: true as const, plan: (await getUserPlan(env, workspaceUserId)) };
}

function readBoolean(input: Record<string, unknown>, key: string) {
  return input[key] === true;
}

function readString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

export function planFeatureDeniedActionResult(feature: PlanFeature, plan: PlanFamily) {
  return {
    ok: false as const,
    error: "plan_gated" as const,
    feature,
    plan,
    message: "This capability is not included in your current plan.",
  };
}

export async function requireDeliveryConfigSave(
  env: AppEnv,
  workspaceUserId: string,
  input: DeliveryConfigSaveInput,
) {
  const checks: Array<[boolean, PlanFeature]> = [
    [Boolean(input.slackEnabled) || input.channel === "slack", "slack_delivery"],
    [Boolean(input.teamsEnabled) || input.channel === "teams", "teams_delivery"],
    [Boolean(input.instantEnabled), "high_priority_alerts"],
    [Boolean(input.emailEnabled), "email_delivery"],
  ];

  for (const [enabled, feature] of checks) {
    if (!enabled) continue;
    const gate = await requireWorkspacePlanFeature(env, workspaceUserId, feature);
    if (!gate.ok) {
      return { ok: false as const, feature, plan: gate.plan };
    }
  }

  return { ok: true as const, plan: await getUserPlan(env, workspaceUserId) };
}

export function applyDeliveryEntitlements<T extends DeliveryConfigShape>(
  plan: PlanFamily,
  config: T,
): T {
  return {
    ...config,
    slackEnabled: config.slackEnabled && canUsePlanFeature(plan, "slack_delivery"),
    teamsEnabled: config.teamsEnabled && canUsePlanFeature(plan, "teams_delivery"),
    instantEnabled: config.instantEnabled && canUsePlanFeature(plan, "high_priority_alerts"),
    emailEnabled: config.emailEnabled && canUsePlanFeature(plan, "email_delivery"),
  };
}

export async function resolveWorkspacePreparedBy(env: AppEnv, workspaceUserId: string) {
  const plan = await getUserPlan(env, workspaceUserId);
  if (!canUsePlanFeature(plan, "agency_branding")) {
    return null;
  }

  const { getWorkspaceBranding } = await import("~/lib/data.server");
  const branding = await getWorkspaceBranding(env, workspaceUserId);
  return branding.brandName;
}

export interface WorkspaceBrandIdentity {
	brandName: string | null;
	brandWebsite: string | null;
	brandLogo: string | null;
}

/**
 * Full brand identity for branded shared reports (Agency plan). Sibling of
 * resolveWorkspacePreparedBy — that function's signature/behavior stays
 * untouched for its existing consumers; render work adopts this one later.
 */
export async function resolveWorkspaceBrandIdentity(
	env: AppEnv,
	workspaceUserId: string,
): Promise<WorkspaceBrandIdentity | null> {
	const plan = await getUserPlan(env, workspaceUserId);
	if (!canUsePlanFeature(plan, "agency_branding")) {
		return null;
	}

	const { getWorkspaceBranding } = await import("~/lib/data.server");
	const branding = await getWorkspaceBranding(env, workspaceUserId);
	return {
		brandName: branding.brandName,
		brandWebsite: branding.brandWebsite,
		brandLogo: branding.brandLogo,
	};
}
