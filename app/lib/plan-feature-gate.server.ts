import type { AppEnv } from "~/lib/env.server";
import {
  canUsePlanFeature,
  type PlanFeature,
  type PlanFamily,
} from "~/lib/plan-entitlements";
import { getUserPlan } from "~/lib/plan.server";

export type ExportFormat = "csv" | "json" | "slack";

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
  { routeId: "api.v1.workspace-readiness", feature: "api_access" as PlanFeature },
  { routeId: "api.mcp", feature: "mcp_access" as PlanFeature },
  { routeId: "export.$resourceType.$resourceId", feature: "export_json" as PlanFeature },
  { routeId: "app.reports", feature: "client_reports" as PlanFeature },
  { routeId: "app.team", feature: "team_workspace" as PlanFeature },
  { routeId: "team.accept", feature: "team_workspace" as PlanFeature },
] as const;

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
    if (readBoolean(input, "slackEnabled") || readString(input, "channel") === "slack") {
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
