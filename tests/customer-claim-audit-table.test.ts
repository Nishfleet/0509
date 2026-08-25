import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getPlanEntitlements,
  PLAN_FAMILIES,
} from "~/lib/plan-entitlements";
import { pricingPlans, usageBundles, EVIDENCE_USAGE_CUSTOMER_COPY } from "~/lib/pricing";

// BET 10 — claim-by-claim audit table. Every public sentence maps to a live
// query or test that passes, or to a copy change that brings the sentence back
// in line with the data. The audit table is a sibling of the existing
// customer-claim-surface-registry.json; this test enforces the issue #955
// acceptance criteria: the file parses, every claim has a mapped query/test,
// and a sample of the mapped queries run and return their recorded pass/fail.

type AuditClaim = {
  claimId: string;
  registryClaim: string;
  text: string;
  surface: string;
  liveQueryOrTest: string;
  currentResult: string;
  resultDetail: string;
  betOrCopyChange: string;
  nishReserved: boolean;
};

type AuditTable = {
  schemaVersion: number;
  claims: AuditClaim[];
  summary: {
    totalClaims: number;
    pass: number;
    failCopyChangeNeeded: number;
    nishReserved: number;
    passCodeDataPending: number;
    copyChangesNeeded: string[];
    nishReservedOpen: string[];
  };
};

const audit = JSON.parse(
  readFileSync("docs/customer-claim-audit-table.json", "utf8"),
) as AuditTable;

const ALLOWED_RESULTS = new Set([
  "pass",
  "fail_copy_change_needed",
  "nish_reserved",
  "pass_code_data_pending",
]);

describe("BET 10 claim-by-claim audit table", () => {
  it("parses and every claim has a mapped live query/test with a recorded result", () => {
    expect(audit.schemaVersion).toBe(1);
    expect(audit.claims.length).toBeGreaterThan(0);
    expect(audit.summary.totalClaims).toBe(audit.claims.length);

    const seenIds = new Set<string>();
    for (const claim of audit.claims) {
      expect(claim.claimId, "claimId").toBeTruthy();
      expect(seenIds.has(claim.claimId), `duplicate claimId ${claim.claimId}`).toBe(false);
      seenIds.add(claim.claimId);

      // Every entry records: the claim, the surface, the live query/test,
      // current pass/fail, and the bet or copy change needed.
      for (const field of [
        "claimId", "registryClaim", "text", "surface", "liveQueryOrTest",
        "currentResult", "resultDetail", "betOrCopyChange",
      ] as const) {
        expect(String(claim[field] ?? "").trim().length, `${claim.claimId}.${field}`)
          .toBeGreaterThan(0);
      }
      expect(ALLOWED_RESULTS.has(claim.currentResult), `${claim.claimId}.currentResult`).toBe(true);
      expect(typeof claim.nishReserved).toBe("boolean");
    }
  });

  it("summary counts match the actual claim results", () => {
    const counts = { pass: 0, fail_copy_change_needed: 0, nish_reserved: 0, pass_code_data_pending: 0 };
    for (const claim of audit.claims) {
      counts[claim.currentResult as keyof typeof counts] += 1;
    }
    expect(audit.summary.pass).toBe(counts.pass);
    expect(audit.summary.failCopyChangeNeeded).toBe(counts.fail_copy_change_needed);
    expect(audit.summary.nishReserved).toBe(counts.nish_reserved);
    expect(audit.summary.passCodeDataPending).toBe(counts.pass_code_data_pending);
    expect(audit.summary.pass + audit.summary.failCopyChangeNeeded +
      audit.summary.nishReserved + audit.summary.passCodeDataPending)
      .toBe(audit.summary.totalClaims);

    // Every fail_copy_change_needed claim has a matching summary entry.
    const failIds = audit.claims
      .filter((c) => c.currentResult === "fail_copy_change_needed")
      .map((c) => c.claimId);
    for (const id of failIds) {
      expect(audit.summary.copyChangesNeeded.some((entry) => entry.startsWith(id)),
        `copy change for ${id} missing from summary`).toBe(true);
    }
    // Every nish_reserved claim has a matching summary entry.
    const nishIds = audit.claims
      .filter((c) => c.nishReserved)
      .map((c) => c.claimId);
    for (const id of nishIds) {
      expect(audit.summary.nishReservedOpen.some((entry) => entry.startsWith(id)),
        `nish-reserved flag for ${id} missing from summary`).toBe(true);
    }
  });

  it("flags Nish-reserved claims without resolving them", () => {
    const nishClaims = audit.claims.filter((c) => c.nishReserved);
    expect(nishClaims.length).toBeGreaterThan(0);
    for (const claim of nishClaims) {
      expect(claim.currentResult, `${claim.claimId} nish-reserved must not be pass`).not.toBe("pass");
      expect(claim.betOrCopyChange, `${claim.claimId} must record the Nish reservation`)
        .toMatch(/nish-reserved|nish's decision/iu);
    }
  });

  it("runs a sample of the mapped live queries and confirms their recorded pass/fail", () => {
    // Sample 1: AUDIT-CADENCE-PAID-3-6H — the cadence contract.
    const cadence = audit.claims.find((c) => c.claimId === "AUDIT-CADENCE-PAID-3-6H");
    expect(cadence).toBeTruthy();
    expect(cadence!.currentResult).toBe("pass");
    // Live query: the entitlement catalog the public copy cites.
    expect(getPlanEntitlements("scout").scheduledScanCadence).toBe("every_6h");
    expect(getPlanEntitlements("starter").scheduledScanCadence).toBe("every_3h");
    expect(getPlanEntitlements("agency").scheduledScanCadence).toBe("every_3h");
    expect(getPlanEntitlements("agency").priorityScanSlots).toBe(25);

    // Sample 2: AUDIT-PLAN-LIMITS — the Agency plan caps.
    const limits = audit.claims.find((c) => c.claimId === "AUDIT-PLAN-LIMITS");
    expect(limits).toBeTruthy();
    expect(limits!.currentResult).toBe("pass");
    const agency = getPlanEntitlements("agency");
    expect(agency.watchlists).toBe(75);
    expect(agency.collections).toBe(250);
    expect(agency.includedEvidenceChecksPerMonth).toBe(2500);
    expect(agency.workspaceSeats).toBe(3);

    // Sample 3: AUDIT-PROOF-CAPTURE-ACCOUNTING — the usage copy contract.
    const accounting = audit.claims.find((c) => c.claimId === "AUDIT-PROOF-CAPTURE-ACCOUNTING");
    expect(accounting).toBeTruthy();
    expect(accounting!.currentResult).toBe("pass");
    expect(EVIDENCE_USAGE_CUSTOMER_COPY).toMatch(/never expire/iu);
    expect(usageBundles().length).toBe(3);

    // Sample 4: AUDIT-PRICING-DODO-LOCALIZED — no hardcoded prices.
    const dodo = audit.claims.find((c) => c.claimId === "AUDIT-PRICING-DODO-LOCALIZED");
    expect(dodo).toBeTruthy();
    expect(dodo!.currentResult).toBe("pass");
    for (const plan of pricingPlans()) {
      expect(plan.monthlyLabel).toBe("Localized at checkout");
    }

    // Sample 5: AUDIT-SAVES-SCREENSHOTS — the data-outruns-copy claim.
    // Recorded as fail_copy_change_needed. The code path exists (the unit test
    // in monitoring-landing-page-snapshot.test.ts proves screenshotArtifactKey
    // is persisted on a successful capture), but the live data shows only 19%
    // of succeeded proof_capture rows carry a screenshot key. The audit table
    // records the copy change needed; this sample confirms the recorded result.
    const screenshots = audit.claims.find((c) => c.claimId === "AUDIT-SAVES-SCREENSHOTS");
    expect(screenshots).toBeTruthy();
    expect(screenshots!.currentResult).toBe("fail_copy_change_needed");
    expect(screenshots!.betOrCopyChange).toMatch(/copy change needed/iu);

    // Sample 6: AUDIT-LANDING-PAGE-CHANGE-HISTORY — the empty-table claim.
    const history = audit.claims.find((c) => c.claimId === "AUDIT-LANDING-PAGE-CHANGE-HISTORY");
    expect(history).toBeTruthy();
    expect(history!.currentResult).toBe("fail_copy_change_needed");
    expect(history!.betOrCopyChange).toMatch(/copy change needed/iu);

    // Sample 7: AUDIT-FUNNEL-MEASUREMENT — the Nish-reserved claim.
    const funnel = audit.claims.find((c) => c.claimId === "AUDIT-FUNNEL-MEASUREMENT");
    expect(funnel).toBeTruthy();
    expect(funnel!.currentResult).toBe("nish_reserved");
    expect(funnel!.nishReserved).toBe(true);
  });

  it("every claim links to a registry claim that exists in the sibling registry", () => {
    const registry = JSON.parse(
      readFileSync(resolve("docs/customer-claim-surface-registry.json"), "utf8"),
    ) as { claims: Array<{ claimId: string }>; explicitExclusions: Array<{ claimId: string }> };
    const registryIds = new Set([
      ...registry.claims.map((c) => c.claimId),
      ...registry.explicitExclusions.map((c) => c.claimId),
    ]);
    for (const claim of audit.claims) {
      expect(registryIds.has(claim.registryClaim),
        `${claim.claimId} references unknown registry claim ${claim.registryClaim}`).toBe(true);
    }
  });

  it("covers the public copy surfaces named in the audit basis", () => {
    const surfaces = audit.claims.map((c) => c.surface).join("\n");
    // The audit must cover the primary public copy surfaces.
    expect(surfaces).toMatch(/homepage/iu);
    expect(surfaces).toMatch(/pricing/iu);
    expect(surfaces).toMatch(/competitor-monitoring/iu);
    expect(surfaces).toMatch(/compare\/magicbrief|migration/iu);
    // The two data-outruns-copy claims from the issue evidence must be present.
    expect(audit.claims.some((c) => c.claimId === "AUDIT-SAVES-SCREENSHOTS")).toBe(true);
    expect(audit.claims.some((c) => c.claimId === "AUDIT-LANDING-PAGE-CHANGE-HISTORY")).toBe(true);
  });
});
