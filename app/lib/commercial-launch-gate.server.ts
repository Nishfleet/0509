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
import type { PricingPlanSlug } from "~/lib/pricing";

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

function planSaleOpenSummary(env: AppEnv): PublicCommercialLaunchSummary {
  // Every paid plan sells the same way: priced, and checked out through Dodo
  // whenever its monthly product is configured. There is no Agency review
  // step (Nish, 2026-09-12); the monitoring-fanout proof stays a capacity
  // measure in summarizeMonitoringFanoutProof, not a sale gate.
  return {
    scoutSaleOpen: hasMonthlyPlanCheckoutConfiguration(env, "scout"),
    starterSaleOpen: hasMonthlyPlanCheckoutConfiguration(env, "starter"),
    agencySaleOpen: hasMonthlyPlanCheckoutConfiguration(env, "agency"),
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
