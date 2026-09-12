import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The data barrel's lazy-facade ratchet (issue #2978).
 *
 * `app/lib/data.server.ts` is statically imported by hot modules and
 * dynamically imported by dozens of loaders for cold-start deferral. When the
 * barrel re-exported the heavy D1 leaves statically, the whole leaf closure
 * (~342 kB) sat in the server bundle's initial graph and every
 * `await import("~/lib/data.server")` bought nothing — the build emitted
 * INEFFECTIVE_DYNAMIC_IMPORT and cold start paid for code the request never
 * used. The barrel is now a lazy facade: sync helpers re-exported from their
 * small defining leaves, async D1 functions forwarded through dynamic
 * `import()` on first call.
 *
 * These tests pin the facade so the deferral cannot silently regress:
 *
 * - no static VALUE re-export from a heavy leaf (one static leaf import puts
 *   that leaf — and transitively its imports — back into the cold graph);
 * - every async export remains a forwarder that dynamically imports its leaf;
 * - leaves still do not import the barrel (the cycle rule the original
 *   barrel header documented).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BARREL_PATH = join(ROOT, "app/lib/data.server.ts");
const APP_LIB = join(ROOT, "app/lib");

/**
 * Leaves the barrel may re-export statically: sync helpers, constants, and
 * the one overloaded export (createDigestRun), whose defining leaves are
 * small enough that pulling them into the cold-start graph is the price of
 * keeping sync semantics exact. Everything else must be lazily forwarded.
 */
const STATIC_REEXPORT_ALLOWLIST = new Set([
  "~/lib/data/helpers.server",
  "~/lib/data/watchlist-runs.server",
  "~/lib/data/watch-events.server",
  "~/lib/data/billing-webhook-ledger.server",
  "~/lib/data/billing-checkout.server",
  "~/lib/data/billing-plan-change-reconciliation.server",
  "~/lib/data/billing-refund-reconciliation.server",
  "~/lib/data/delivery-records-workspace.server",
  "~/lib/data/delivery-records-attempts.server",
  "~/lib/data/digests.server",
  "~/lib/data/digest-schedule-recovery.server",
  "~/lib/data/shares.server",
  "~/lib/data/operator-delivery-reconciliation.server",
  "~/lib/data/workspace-branding.server",
  "~/lib/data/org.server",
  "~/lib/digest-provenance",
]);

function readBarrel(): string {
  return readFileSync(BARREL_PATH, "utf8");
}

describe("data barrel lazy facade (#2978)", () => {
  it("does not statically value-re-export any heavy leaf", () => {
    const src = readBarrel();
    const offenders: string[] = [];
    for (const m of src.matchAll(/export\s+\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
      const mod = m[2];
      const names = m[1].split(",").map((n) => n.trim()).filter(Boolean);
      if (names.length === 0) continue;
      if (!STATIC_REEXPORT_ALLOWLIST.has(mod)) {
        offenders.push(`${mod} (${names.join(", ")})`);
      }
    }
    expect(
      offenders,
      `static value re-exports from non-allowlisted leaves put the leaf closure back into the cold-start graph: ${offenders.join("; ")}`,
    ).toEqual([]);
  });

  it("keeps every lazily forwarded export a dynamic-import forwarder", () => {
    const src = readBarrel();
    const forwarders = [...src.matchAll(/export\s+const\s+(\w+):\s*typeof\s+import\("([^"]+)"\)/g)];
    // The facade must actually be lazy: a barrel that lost its forwarders
    // (e.g. someone "simplifying" it back to re-exports) regresses cold start.
    expect(
      forwarders.length,
      "expected the lazy facade to keep its dynamic-import forwarders",
    ).toBeGreaterThan(150);

    const forwarderNames = new Set(forwarders.map((m) => m[1]));
    for (const m of src.matchAll(/export\s+const\s+(\w+):/g)) {
      expect(
        forwarderNames.has(m[1]),
        `export const ${m[1]}: is not a typed forwarder — every async export must be forwarded through import()`,
      ).toBe(true);
    }
  });

  it("keeps leaves free of imports of the barrel (no cycle)", () => {
    const src = readBarrel();
    const leaves = new Set<string>();
    for (const m of src.matchAll(/from\s*"(~\/lib\/[^"]+)"/g)) {
      leaves.add(m[1]);
    }
    const cyclic: string[] = [];
    for (const leaf of leaves) {
      const rel = leaf.replace("~/lib/", "app/lib/") + ".ts";
      let leafSrc: string;
      try {
        leafSrc = readFileSync(join(APP_LIB, rel.replace("app/lib/", "")), "utf8");
      } catch {
        continue; // leaf lives outside app/lib/data or is optional; the build graph covers it
      }
      if (/from\s*"~\/lib\/data\.server"/.test(leafSrc)) {
        cyclic.push(leaf);
      }
    }
    expect(
      cyclic,
      `leaves importing the barrel re-create the static cycle the facade removes: ${cyclic.join(", ")}`,
    ).toEqual([]);
  });
});
