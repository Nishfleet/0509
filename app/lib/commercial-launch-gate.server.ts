import { listSkusMissingProviderConfiguration } from "~/lib/billing-sku-catalog";
import type { AppEnv } from "~/lib/env.server";
import {
  isMonitoringWorkflowBindingAvailable,
  resolveMonitoringFanoutMode,
} from "~/lib/monitoring-fanout.server";
import type { PlanFamily } from "~/lib/plan-entitlements";
import type { PricingPlanSlug } from "~/lib/pricing";

export type PlanSaleState = "open" | "held_fanout";

export interface MonitoringFanoutProofSummary {
  mode: ReturnType<typeof resolveMonitoringFanoutMode>;
  workflowBindingAvailable: boolean;
  globalEnabled: boolean;
  allowlistConfigured: boolean;
  internalWorkspaceDocumented: boolean;
  agencySaleOpen: boolean;
  blocker: string | null;
}

export interface CommercialLaunchSummary {
  scoutSaleOpen: boolean;
  starterSaleOpen: boolean;
  agencySaleOpen: boolean;
  fanout: MonitoringFanoutProofSummary;
  missingCheckoutSkus: ReturnType<typeof listSkusMissingProviderConfiguration>;
}

const PAID_PLAN_SLUGS: PricingPlanSlug[] = ["scout", "starter", "agency"];

export function monitoringFanoutInternalWorkspaceUserId(env: AppEnv) {
  return env.MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID?.trim() ?? "";
}

export function summarizeMonitoringFanoutProof(env: AppEnv): MonitoringFanoutProofSummary {
  const mode = resolveMonitoringFanoutMode(env);
  const workflowBindingAvailable = isMonitoringWorkflowBindingAvailable(env);
  const globalEnabled = env.MONITORING_FANOUT_GLOBAL === "1";
  const allowlist = env.MONITORING_FANOUT_ALLOWLIST?.trim() ?? "";
  const allowlistConfigured = allowlist.length > 0 && allowlist !== "*";
  const internalWorkspaceDocumented = Boolean(monitoringFanoutInternalWorkspaceUserId(env));

  let blocker: string | null = null;
  let agencySaleOpen = false;

  if (!workflowBindingAvailable) {
    blocker = "workflow_binding_missing";
  } else if (mode === "inline") {
    blocker = "fanout_mode_inline";
  } else if (mode === "shadow") {
    blocker = "fanout_shadow_only";
  } else if (!internalWorkspaceDocumented) {
    blocker = "internal_workspace_undocumented";
  } else if (!globalEnabled && !allowlistConfigured) {
    blocker = "fanout_not_proven";
  } else {
    agencySaleOpen = true;
  }

  return {
    mode,
    workflowBindingAvailable,
    globalEnabled,
    allowlistConfigured,
    internalWorkspaceDocumented,
    agencySaleOpen,
    blocker,
  };
}

export function planSaleState(env: AppEnv, plan: PricingPlanSlug): PlanSaleState {
  if (plan === "agency" && !summarizeMonitoringFanoutProof(env).agencySaleOpen) {
    return "held_fanout";
  }

  return "open";
}

export function isPlanCheckoutAllowed(env: AppEnv, plan: PricingPlanSlug | PlanFamily) {
  return planSaleState(env, plan as PricingPlanSlug) === "open";
}

export function summarizeCommercialLaunch(env: AppEnv): CommercialLaunchSummary {
  const fanout = summarizeMonitoringFanoutProof(env);
  const agencyOpen = fanout.agencySaleOpen;
  return {
    scoutSaleOpen: true,
    starterSaleOpen: true,
    agencySaleOpen: agencyOpen,
    fanout,
    missingCheckoutSkus: listSkusMissingProviderConfiguration(env),
  };
}

import { agencyCheckoutHeldCustomerCopy } from "~/lib/customer-billing-copy";

export { agencyCheckoutHeldCustomerCopy };

export function planCheckoutHeldCustomerCopy(plan: PricingPlanSlug) {
  if (plan === "agency") {
    return agencyCheckoutHeldCustomerCopy();
  }
  return `${plan.charAt(0).toUpperCase() + plan.slice(1)} checkout is temporarily unavailable. Email support and we will help.`;
}

export function publicPricingPlansForSale(env: AppEnv) {
  return PAID_PLAN_SLUGS.filter((plan) => isPlanCheckoutAllowed(env, plan));
}
