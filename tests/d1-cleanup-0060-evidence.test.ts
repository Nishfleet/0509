import { describe, expect, it } from "vitest";

import {
  buildDodoLinkageCountSql,
  buildPlanDistributionSql,
  buildRetiredColumnCountSql,
  buildTableExistsSql,
  buildTableRowCountSql,
  DODO_LINKAGE_COLUMNS,
  LEGACY_BILLING_USER_PLAN_COLUMNS,
  RETIRED_USER_PLAN_COLUMNS,
  RETIRED_WEBHOOK_TABLE,
  rowsFromWranglerJson,
  validateStageEvidence,
} from "../scripts/d1-cleanup-0060-evidence.mjs";

describe("D1 cleanup 0060 evidence helper", () => {
  it("builds aggregate-only SQL for pre/post cleanup evidence", () => {
    expect(LEGACY_BILLING_USER_PLAN_COLUMNS).toEqual([
      "stripe_customer_id",
      "stripe_subscription_id",
      ...RETIRED_USER_PLAN_COLUMNS,
    ]);
    expect(DODO_LINKAGE_COLUMNS).toEqual([
      "dodo_payment_id",
      "dodo_subscription_id",
      "dodo_customer_id",
    ]);
    expect(DODO_LINKAGE_COLUMNS).not.toContain("dodo_status");
    expect(DODO_LINKAGE_COLUMNS).not.toContain("dodo_next_billing_at");
    expect(buildPlanDistributionSql()).toContain("GROUP BY plan");
    expect(buildDodoLinkageCountSql(["dodo_customer_id", "dodo_subscription_id"])).toBe(
      'SELECT COUNT(*) AS count FROM user_plan WHERE "dodo_customer_id" IS NOT NULL OR "dodo_subscription_id" IS NOT NULL;',
    );
    expect(buildRetiredColumnCountSql(RETIRED_USER_PLAN_COLUMNS[0])).toContain("COUNT(*) AS count");
    expect(buildTableExistsSql(RETIRED_WEBHOOK_TABLE)).toContain("sqlite_master");
    expect(buildTableRowCountSql(RETIRED_WEBHOOK_TABLE)).toContain("COUNT(*) AS count");
  });

  it("rejects unsupported identifiers instead of interpolating arbitrary SQL", () => {
    expect(() => buildRetiredColumnCountSql("bad_column")).toThrow("Unsupported retired column");
    expect(() => buildTableRowCountSql("bad_table")).toThrow("Unsupported table");
  });

  it("parses wrangler JSON rows without exposing metadata", () => {
    expect(
      rowsFromWranglerJson(
        JSON.stringify([
          {
            results: [{ count: 2 }],
            success: true,
          },
        ]),
      ),
    ).toEqual([{ count: 2 }]);
  });

  it("fails the post-cleanup stage if retired schema artifacts remain", () => {
    expect(
      validateStageEvidence({
        legacyBillingColumnsPresent: 2,
        retiredProviderColumnsPresent: 1,
        retiredProviderWebhookTablePresent: true,
        stage: "post",
      }),
    ).toEqual([
      "legacy billing columns are still present",
      "retired provider columns are still present",
      "retired provider webhook table is still present",
    ]);
    expect(
      validateStageEvidence({
        legacyBillingColumnsPresent: 2,
        retiredProviderColumnsPresent: 1,
        retiredProviderWebhookTablePresent: true,
        stage: "pre",
      }),
    ).toEqual([]);
  });
});
