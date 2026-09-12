import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Regression guard for #3268: the "Verify pinned main checkout" step in the
// ratchet auto-tighten workflow must never re-assert a branch name. The
// checkout is pinned `ref: github.sha`, so HEAD is always detached and
// `git rev-parse --abbrev-ref HEAD` prints "HEAD" — a branch-name assert can
// only fail on every trigger. The event-aware replacement asserts HEAD is on
// origin/main's history via merge-base.

const wf = readFileSync(
  new URL("../.github/workflows/ratchet-auto-tighten.yml", import.meta.url),
  "utf8",
);

function stepSource(name: string): string {
  const marker = `name: ${name}`;
  const start = wf.indexOf(marker);
  expect(start, `step ${name} exists`).toBeGreaterThanOrEqual(0);
  // Step bodies end at the next top-level "- name:" or job boundary.
  const next = wf.indexOf("\n      - name: ", start + marker.length);
  return wf.slice(start, next === -1 ? wf.length : next);
}

describe("ratchet-auto-tighten Verify pinned main checkout", () => {
  it("does not assert a branch name (detached HEAD regression)", () => {
    const step = stepSource("Verify pinned main checkout");
    expect(step).not.toMatch(/\$\(git rev-parse --abbrev-ref HEAD\)/);
    expect(step).not.toMatch(/branch.*!=.*main/);
  });

  it("asserts HEAD is on origin/main's history", () => {
    const step = stepSource("Verify pinned main checkout");
    expect(step).toContain("merge-base --is-ancestor");
    expect(step).toContain("git fetch origin main");
  });
});
