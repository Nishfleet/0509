import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import {
  D1_INTERNAL_TABLES,
  LEGACY_SHADOW_ALLOWED,
  LEGACY_SHADOW_TABLE,
  MEMBERSHIP_TABLES,
  OWNED_PROBE_PENDING,
  OWNED_PROBE_TABLES,
  OWNERSHIP_CLASSIFICATION,
  OWNERSHIP_UNIT_TABLES,
  PLATFORM_TABLES,
  SCOPED_VIA_PARENT,
} from "./ownership/ownership-manifest";

/**
 * Classification completeness guard (epic #2993, plan slice P1).
 *
 * Every table in the real D1 schema must be classified by the ownership
 * manifest: owned (probed now), owned-pending (with the phase issue that owns
 * its probe), scoped via a parent, membership, the ownership unit itself, or
 * platform with a reason. A new product table cannot merge unclassified —
 * this is the detector that keeps `docs/org-scoped-ownership-plan.md` §2
 * (the table inventory) true as the schema grows.
 */

const tableNames = new Set<string>();
for (const row of (
  await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  ).all<{ name: string }>()
).results ?? []) {
  tableNames.add(row.name);
}

describe("ownership manifest classification", () => {
  it("classifies every table in the real D1 schema", () => {
    const classified = new Set(OWNERSHIP_CLASSIFICATION.map((entry) => entry.table));
    const internal: string[] = [];
    const legacyShadow: string[] = [];
    const unclassified: string[] = [];

    for (const name of tableNames) {
      if (D1_INTERNAL_TABLES.test(name)) {
        internal.push(name);
      } else if (LEGACY_SHADOW_TABLE.test(name)) {
        legacyShadow.push(name);
      } else if (!classified.has(name)) {
        unclassified.push(name);
      }
    }

    expect(
      unclassified,
      "unclassified tables — add them to tests/integration/ownership/ownership-manifest.ts " +
        "(and docs/org-scoped-ownership-plan.md §2) with the right kind",
    ).toEqual([]);
    const allowedShadow = new Set(LEGACY_SHADOW_ALLOWED.map((entry) => entry.table));
    const unexpectedShadow = legacyShadow.filter((name) => !allowedShadow.has(name));
    expect(
      unexpectedShadow,
      "shadow/backup tables leaked past their migration — the chain must clean up after itself",
    ).toEqual([]);
    // Every allowlisted leftover must still exist (cleanup PRs shrink the list).
    const vanishedAllowlist = [...allowedShadow].filter((name) => !tableNames.has(name));
    expect(
      vanishedAllowlist,
      "allowlisted legacy shadow tables no longer exist — remove them from LEGACY_SHADOW_ALLOWED (issue #3084 cleanup)",
    ).toEqual([]);
    // D1/Miniflare bookkeeping only — a product table must never land here.
    const knownInternal = new Set(["d1_migrations", "_cf_METADATA"]);
    expect(
      internal.filter((name) => !knownInternal.has(name)),
      "unexpected sqlite-internal tables",
    ).toEqual([]);
  });

  it("classifies each table exactly once", () => {
    const seen = new Map<string, number>();
    for (const entry of OWNERSHIP_CLASSIFICATION) {
      seen.set(entry.table, (seen.get(entry.table) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });

  it("pending probes and via-parent links are coherent", () => {
    // No table may be both probed and pending.
    const probed = new Set<string>(OWNED_PROBE_TABLES);
    for (const entry of OWNED_PROBE_PENDING) {
      expect(probed.has(entry.table)).toBe(false);
    }
    // Every via-parent parent must be classified and must itself carry (or
    // transit through to) an ownership key — chains like
    // website_site_scan_page -> website_site_scan -> watchlist are fine; a
    // platform parent would be meaningless.
    const classifiedKinds = new Map(
      OWNERSHIP_CLASSIFICATION.map((entry) => [entry.table, entry.kind]),
    );
    const ownedChainRoot = new Set(
      OWNERSHIP_CLASSIFICATION.filter(
        (entry) =>
          entry.kind === "owned-probe" ||
          entry.kind === "owned-probe-pending" ||
          entry.kind === "membership" ||
          entry.kind === "ownership-unit",
      ).map((entry) => entry.table),
    );
    for (const { table, parent } of SCOPED_VIA_PARENT) {
      const parentKind = classifiedKinds.get(parent);
      expect(
        parentKind,
        `${table}: parent ${parent} must be classified`,
      ).toBeDefined();
      // Walk up the via-parent chain; it must terminate at an owned root.
      let current = parent;
      const seen = new Set<string>([table]);
      while (classifiedKinds.get(current) === "scoped-via-parent") {
        expect(seen.has(current), `${table}: via-parent chain has a cycle at ${current}`).toBe(false);
        seen.add(current);
        const next = SCOPED_VIA_PARENT.find((e) => e.table === current)?.parent;
        expect(next, `${table}: chain node ${current} has no parent`).toBeDefined();
        current = next as string;
      }
      expect(
        ownedChainRoot.has(current),
        `${table}: via-parent chain terminates at ${current} (${classifiedKinds.get(current)}) — must reach an owned root`,
      ).toBe(true);
    }
    // Every platform entry must carry a non-empty reason.
    for (const entry of PLATFORM_TABLES) {
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
    // Membership + ownership-unit tables are singletons.
    expect(MEMBERSHIP_TABLES).toEqual(["workspace_member"]);
    expect(OWNERSHIP_UNIT_TABLES).toEqual(["org"]);
  });
});
