import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// The external design-unification ledger at
// /home/nish/workspaces/agent-state/0509-design-unification-ledger.md was
// formally retired 2026-08-25 (it never existed on disk). docs/BACKLOG.md is
// the canonical retirement record and may name the retired path. No other doc
// may reference "design-unification-ledger" — a live reference to a retired,
// non-existent file is exactly the "claims that don't match reality" defect
// this guard exists to prevent (issue #1497).
const GHOST = "design-unification-ledger";
const BACKLOG = "docs/BACKLOG.md";
const ROOTS = ["docs", "DESIGN.md"];

function listFiles(root: string): string[] {
  let st;
  try {
    st = statSync(root);
  } catch {
    return [];
  }
  if (st.isFile()) return [root];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(root, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listFiles(full));
    else if (/\.(md|mdx|txt|json|mjs|ts|tsx|js)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("docs ghost-ledger reference guard (issue #1497)", () => {
  it("no doc outside docs/BACKLOG.md references the retired design-unification-ledger", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of listFiles(root)) {
        if (file === BACKLOG) continue;
        const text = readFileSync(file, "utf8");
        if (text.includes(GHOST)) offenders.push(relative(".", file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("docs/BACKLOG.md keeps the retirement record (the correct state)", () => {
    const backlog = readFileSync(BACKLOG, "utf8");
    expect(backlog).toContain("design-unification-ledger");
    expect(backlog).toContain("formally retired 2026-08-25");
  });
});
