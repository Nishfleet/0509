import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #2857: every queued directory/listing artefact under docs/ must carry
 * an explicit submission receipt (`receipt:`) or an explicit blocker
 * (`blocked:`) — no artefact may sit silently PREPARED. This is the
 * observe-to-close gate for the 2026-09-11 receipts pass: any new
 * `docs/*listing*.md` draft must carry a status line the moment it lands, so
 * the "100% drafted, 0% sent" §1.6 finding can never quietly re-accumulate.
 *
 * The ledger (docs/listing-submissions.md) is itself caught by the
 * `*listing*` glob, so it must carry a status line too — its summary receipt
 * line doubles as that.
 */

const DOCS_DIR = join(import.meta.dirname, "..", "..", "docs");
const LEDGER = "listing-submissions.md";

const listingArtefacts = readdirSync(DOCS_DIR)
  .filter((f) => f.endsWith(".md") && f.includes("listing"))
  .sort();

describe("listing submissions receipts (issue #2857)", () => {
  it("has listing artefacts to guard (the glob must never go empty)", () => {
    expect(listingArtefacts.length).toBeGreaterThanOrEqual(8);
  });

  it("every listing artefact carries a line-start receipt: or blocked: status line", () => {
    const missing = listingArtefacts.filter((file) => {
      const text = readFileSync(join(DOCS_DIR, file), "utf8");
      return !/^receipt:|^blocked:/m.test(text);
    });
    expect(missing).toEqual([]);
  });

  it("the receipts ledger exists and names every listing artefact", () => {
    const ledgerPath = join(DOCS_DIR, LEDGER);
    expect(existsSync(ledgerPath)).toBe(true);
    const ledger = readFileSync(ledgerPath, "utf8");
    const artefacts = listingArtefacts.filter((f) => f !== LEDGER);
    for (const file of artefacts) {
      expect(ledger, `ledger must reference ${file}`).toContain(file);
    }
  });
});
