import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const registry = JSON.parse(
  readFileSync("docs/customer-claim-surface-registry.json", "utf8"),
) as {
  schemaVersion: number;
  registryStatus: string;
  canonicalReleaseVerdict: string;
  coverage: Array<{ surface: string; status: string }>;
  claims: Array<Record<string, unknown>>;
  explicitExclusions: Array<Record<string, unknown>>;
};

describe("G11 claim-surface registry", () => {
  it("stays assessed and fail-closed while the closeout candidate is unfrozen", () => {
    expect(registry.schemaVersion).toBe(2);
    expect(registry.registryStatus).toBe("assessed_open");
    expect(registry.canonicalReleaseVerdict).toBe("closeout_candidate_unfrozen");
    expect(registry.coverage).toHaveLength(9);
    expect(registry.coverage.every((entry) => entry.status.startsWith("assessed_"))).toBe(true);
  });

  it("keeps claim ids unique and requires an evidence gate, status and drift trigger", () => {
    const ids = registry.claims.map((claim) => claim.claimId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    for (const claim of registry.claims) {
      expect(claim).toMatchObject({
        claimId: expect.any(String),
        text: expect.any(String),
        surface: expect.any(String),
        audience: expect.any(String),
        owner: expect.any(String),
        source: expect.any(Array),
        requiredGate: expect.any(String),
        requiredEvidence: expect.any(String),
        status: expect.stringMatching(/^(assessed_|removed_from_product_contract)/u),
        assessment: expect.any(String),
        classification: expect.stringMatching(/^(known|discovered|duplicate|rejected|out_of_scope)$/u),
        expiry: expect.any(String),
      });
    }
  });

  it("allows N/A only as an explicit evidence-bearing exclusion", () => {
    expect(registry.explicitExclusions.length).toBeGreaterThan(0);
    for (const exclusion of registry.explicitExclusions) {
      expect(exclusion).toMatchObject({
        claimId: expect.any(String),
        classification: expect.stringMatching(/^(duplicate|rejected|out_of_scope)$/u),
        reason: expect.any(String),
      });
    }
    expect(JSON.stringify(registry.claims)).not.toContain("fail_not_assessed");
    expect(JSON.stringify(registry.claims)).not.toContain('"status":"pass"');
  });
});
