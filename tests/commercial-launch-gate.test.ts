import { describe, expect, it } from "vitest";

import {
  isPlanCheckoutAllowed,
  summarizeCommercialLaunch,
  summarizeMonitoringFanoutProof,
} from "~/lib/commercial-launch-gate.server";
import type { AppEnv } from "~/lib/env.server";

const workflowBinding = {
  create: () => Promise.resolve({ id: "wf_test" }),
  createBatch: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
} as unknown as AppEnv["MONITORING_WORKFLOW"];

const baseFanoutEnv = {
  MONITORING_FANOUT_MODE: "fanout",
  MONITORING_FANOUT_GLOBAL: "1",
  MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID: "user_internal",
  MONITORING_WORKFLOW: workflowBinding,
  DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_m",
  DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_y",
  DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_m",
  DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_y",
  DODO_0509_PRODUCT_AGENCY_MONTHLY_ID: "prod_agency_m",
  DODO_0509_PRODUCT_AGENCY_YEARLY_ID: "prod_agency_y",
  DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
  DODO_0509_PRODUCT_PROOF_PACK_2000_ID: "prod_pack_2000",
  DODO_0509_PRODUCT_PROOF_PACK_7500_ID: "prod_pack_7500",
} satisfies AppEnv;

describe("commercial launch gate", () => {
  it("holds Agency when fan-out stays inline in production", () => {
    const proof = summarizeMonitoringFanoutProof({
      MONITORING_FANOUT_MODE: "inline",
      MONITORING_WORKFLOW: workflowBinding,
    });

    expect(proof.mode).toBe("inline");
    expect(proof.agencySaleOpen).toBe(false);
    expect(proof.blocker).toBe("fanout_mode_inline");
    expect(isPlanCheckoutAllowed({ MONITORING_FANOUT_MODE: "inline" }, "agency")).toBe(false);
  });

  it("holds Agency when internal workspace is undocumented even in fan-out mode", () => {
    const proof = summarizeMonitoringFanoutProof({
      MONITORING_FANOUT_MODE: "fanout",
      MONITORING_FANOUT_GLOBAL: "1",
      MONITORING_WORKFLOW: workflowBinding,
    });

    expect(proof.agencySaleOpen).toBe(false);
    expect(proof.blocker).toBe("internal_workspace_undocumented");
  });

  it("holds Agency in shadow mode even with internal workspace documented", () => {
    const proof = summarizeMonitoringFanoutProof({
      MONITORING_FANOUT_MODE: "shadow",
      MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID: "user_internal",
      MONITORING_WORKFLOW: workflowBinding,
    });

    expect(proof.mode).toBe("shadow");
    expect(proof.agencySaleOpen).toBe(false);
    expect(proof.blocker).toBe("fanout_shadow_only");
    expect(isPlanCheckoutAllowed(
      {
        MONITORING_FANOUT_MODE: "shadow",
        MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID: "user_internal",
      },
      "agency",
    )).toBe(false);
  });

  it("holds Agency when fan-out is allowlisted but not globally enabled without internal workspace", () => {
    const proof = summarizeMonitoringFanoutProof({
      MONITORING_FANOUT_MODE: "fanout",
      MONITORING_FANOUT_ALLOWLIST: "user_internal",
      MONITORING_WORKFLOW: workflowBinding,
    });

    expect(proof.allowlistConfigured).toBe(true);
    expect(proof.agencySaleOpen).toBe(false);
    expect(proof.blocker).toBe("internal_workspace_undocumented");
  });

  it("opens Scout and Starter regardless of SKU env in the commercial gate", () => {
    expect(isPlanCheckoutAllowed({}, "scout")).toBe(true);
    expect(isPlanCheckoutAllowed({}, "starter")).toBe(true);
  });

  it("opens Agency only when fan-out is proven and SKUs are configured", () => {
    const summary = summarizeCommercialLaunch(baseFanoutEnv);

    expect(summary.agencySaleOpen).toBe(true);
    expect(summary.scoutSaleOpen).toBe(true);
    expect(summary.starterSaleOpen).toBe(true);
    expect(isPlanCheckoutAllowed(baseFanoutEnv, "agency")).toBe(true);
  });

  it("reports missing checkout SKUs without blocking Scout or Starter sale flags", () => {
    const summary = summarizeCommercialLaunch({});
    expect(summary.scoutSaleOpen).toBe(true);
    expect(summary.starterSaleOpen).toBe(true);
    expect(summary.missingCheckoutSkus.length).toBeGreaterThan(0);
  });
});
