import {
  listSkusMissingProviderConfiguration,
  readProviderProductId,
  resolveBillingSku,
} from "~/lib/billing-sku-catalog";
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

export type PublicCommercialLaunchSummary = Pick<
  CommercialLaunchSummary,
  "scoutSaleOpen" | "starterSaleOpen" | "agencySaleOpen"
>;

const PAID_PLAN_SLUGS: PricingPlanSlug[] = ["scout", "starter", "agency"];

export function monitoringFanoutInternalWorkspaceUserId(env: AppEnv) {
  return env.MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID?.trim() ?? "";
}

function isAgencySaleOpen(env: AppEnv) {
  const mode = resolveMonitoringFanoutMode(env);
  const workflowBindingAvailable = isMonitoringWorkflowBindingAvailable(env);
  const globalEnabled = env.MONITORING_FANOUT_GLOBAL === "1";
  const allowlist = env.MONITORING_FANOUT_ALLOWLIST?.trim() ?? "";
  const allowlistConfigured = allowlist.length > 0 && allowlist !== "*";
  const internalWorkspaceDocumented = Boolean(monitoringFanoutInternalWorkspaceUserId(env));

  return (
    workflowBindingAvailable &&
    mode === "fanout" &&
    internalWorkspaceDocumented &&
    (globalEnabled || allowlistConfigured)
  );
}

function hasDodoCheckoutBaseConfiguration(env: AppEnv) {
  const apiKey =
    env.DODO_0509_API_KEY?.trim() ||
    env.DODO_PAYMENTS_API_KEY?.trim() ||
    env.DODO_API_KEY?.trim() ||
    "";
  return Boolean(apiKey && env.DODO_0509_BRAND_ID?.trim());
}

function hasMonthlyPlanCheckoutConfiguration(env: AppEnv, plan: PricingPlanSlug) {
  if (!hasDodoCheckoutBaseConfiguration(env)) return false;
  const sku = resolveBillingSku(`${plan}_monthly_v1`);
  return Boolean(sku && readProviderProductId(env, sku));
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
    agencySaleOpen = isAgencySaleOpen(env);
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
  if (plan === "agency" && !isAgencySaleOpen(env)) {
    return "held_fanout";
  }

  return "open";
}

export function isPlanCheckoutAllowed(env: AppEnv, plan: PricingPlanSlug | PlanFamily) {
  return planSaleState(env, plan as PricingPlanSlug) === "open";
}

function planSaleOpenSummary(env: AppEnv): PublicCommercialLaunchSummary {
  const agencyOpen =
    hasMonthlyPlanCheckoutConfiguration(env, "agency") && planSaleState(env, "agency") === "open";
  return {
    scoutSaleOpen: hasMonthlyPlanCheckoutConfiguration(env, "scout"),
    starterSaleOpen: hasMonthlyPlanCheckoutConfiguration(env, "starter"),
    agencySaleOpen: agencyOpen,
  };
}

export function summarizeCommercialLaunch(env: AppEnv): CommercialLaunchSummary {
  const fanout = summarizeMonitoringFanoutProof(env);
  return {
    ...planSaleOpenSummary(env),
    fanout,
    missingCheckoutSkus: listSkusMissingProviderConfiguration(env),
  };
}

export function publicCommercialLaunchSummary(env: AppEnv): PublicCommercialLaunchSummary {
  return planSaleOpenSummary(env);
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
