import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Issue #3602 — claim registry. Every public customer-facing claim raised by
// the 2026-09-18 live-data audit maps to a verifiable live source (a shipped
// test, a code path, or a recorded D1 baseline) plus the copy rule that keeps
// the public sentence inside the data. This suite runs each claim's source
// and copy anchors on every run: it fails — naming the claim id — when a
// source stops existing or when public copy drifts from what the recorded
// live data supports. Whole-site sentence auditing stays in the BET 10
// registries (docs/customer-claim-table.json +
// docs/customer-claim-surface-registry.json via `npm run verify:claims`).

type ClaimSource = { kind: "test" | "code" | "d1"; ref: string; assert: string };
type ClaimLiveBasis = {
  kind: "d1" | "endpoint" | "live-product-test";
  table: string;
  measure: string;
  measured: string;
  measuredAt: string;
};
type Claim = {
  id: string;
  sentence: string;
  surface: string;
  source: ClaimSource;
  liveBasis: ClaimLiveBasis;
  copyRule: string;
  copyAnchors: Record<string, string[]>;
};
type ClaimRegistry = {
  schemaVersion: number;
  issue: string;
  generatedAt: string;
  purpose: string;
  siblingRegistries: Record<string, string>;
  claims: Claim[];
};

const repoRoot = resolve(__dirname, "..");
const registryPath = resolve(repoRoot, "docs/claim-registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as ClaimRegistry;

const SOURCE_KINDS = new Set(["test", "code", "d1"]);
const LIVE_BASIS_KINDS = new Set(["d1", "endpoint", "live-product-test"]);

/** Migrations that mention the table, proving the live basis names a real D1 table. */
function migrationsMentioning(table: string): string[] {
  const dir = resolve(repoRoot, "migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => readFileSync(resolve(dir, name), "utf8").includes(table))
    .map((name) => `migrations/${name}`);
}

describe("claim registry (issue #3602)", () => {
  it("parses and every claim carries a verifiable source and a measured live basis", () => {
    expect(registry.schemaVersion).toBe(1);
    expect(registry.issue).toMatch(/^https:\/\/github\.com\/Nishfleet\/0509\/issues\/\d+$/);
    expect(registry.claims.length).toBeGreaterThanOrEqual(4);

    const seenIds = new Set<string>();
    for (const claim of registry.claims) {
      const problems: string[] = [];
      if (!/^CLAIM-[A-Z0-9-]+$/.test(claim.id)) problems.push("id must be CLAIM-<UPPER-SNAKE>");
      if (seenIds.has(claim.id)) problems.push("duplicate claim id");
      seenIds.add(claim.id);
      for (const field of ["sentence", "surface", "copyRule"] as const) {
        if (typeof claim[field] !== "string" || claim[field].trim().length === 0) {
          problems.push(`field ${field} missing or empty`);
        }
      }
      if (!SOURCE_KINDS.has(claim.source?.kind)) problems.push("source.kind must be test|code|d1");
      for (const field of ["ref", "assert"] as const) {
        if (typeof claim.source?.[field] !== "string" || claim.source[field].trim().length === 0) {
          problems.push(`source.${field} missing or empty — a claim without a source entry is not allowed`);
        }
      }
      if (!LIVE_BASIS_KINDS.has(claim.liveBasis?.kind)) {
        problems.push("liveBasis.kind must be d1|endpoint|live-product-test");
      }
      for (const field of ["table", "measure", "measured"] as const) {
        if (typeof claim.liveBasis?.[field] !== "string" || claim.liveBasis[field].trim().length === 0) {
          problems.push(`liveBasis.${field} missing or empty`);
        }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(claim.liveBasis?.measuredAt ?? "")) {
        problems.push("liveBasis.measuredAt must be an ISO date");
      }
      if (
        !claim.copyAnchors ||
        typeof claim.copyAnchors !== "object" ||
        Array.isArray(claim.copyAnchors) ||
        Object.keys(claim.copyAnchors).length === 0 ||
        !Object.entries(claim.copyAnchors).every(
          ([file, anchors]) =>
            typeof file === "string" &&
            file.trim().length > 0 &&
            Array.isArray(anchors) &&
            anchors.length > 0 &&
            anchors.every((a) => typeof a === "string" && a.trim().length > 0),
        )
      ) {
        problems.push("copyAnchors must map each public surface file to the exact copy it must carry");
      }
      expect(problems, `${claim.id}: ${problems.join("; ")}`).toEqual([]);
    }
  });

  it("every source and copy file referenced still exists (no dead sources)", () => {
    for (const claim of registry.claims) {
      expect(
        existsSync(resolve(repoRoot, claim.source.ref)),
        `${claim.id}: source ref missing from the repo: ${claim.source.ref}`,
      ).toBe(true);
      for (const copyFile of Object.keys(claim.copyAnchors)) {
        expect(
          existsSync(resolve(repoRoot, copyFile)),
          `${claim.id}: copy file missing from the repo: ${copyFile}`,
        ).toBe(true);
      }
    }
  });

  it("live bases name D1 tables that exist in migrations", () => {
    for (const claim of registry.claims) {
      if (claim.liveBasis.kind !== "d1") continue;
      expect(
        migrationsMentioning(claim.liveBasis.table).length,
        `${claim.id}: table ${claim.liveBasis.table} is not defined or referenced in migrations/`,
      ).toBeGreaterThan(0);
    }
  });

  for (const claim of registry.claims) {
    it(`${claim.id}: public copy still matches the recorded claim and baseline`, () => {
      for (const [copyFile, anchors] of Object.entries(claim.copyAnchors)) {
        const content = readFileSync(resolve(repoRoot, copyFile), "utf8");
        for (const anchor of anchors) {
          expect(
            content,
            `${claim.id}: ${copyFile} no longer contains "${anchor}" — public copy drifted from docs/claim-registry.json. Fix the copy, or re-verify the live baseline and update the registry entry in the same change.`,
          ).toContain(anchor);
        }
      }
    });
  }

  it("governance: the sentence-level BET 10 registries this registry points at keep existing", () => {
    for (const [label, path] of Object.entries(registry.siblingRegistries)) {
      if (label === "mechanicalRunner") continue; // npm script, not a file
      expect(
        existsSync(resolve(repoRoot, path)),
        `sibling registry ${label} missing: ${path}`,
      ).toBe(true);
    }
  });
});
