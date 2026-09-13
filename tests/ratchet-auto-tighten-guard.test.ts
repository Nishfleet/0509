import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Regression guard for #3268: the "Verify pinned main checkout" step in the
// ratchet auto-tighten workflow must never re-assert a branch name. The
// checkout is pinned `ref: github.sha`, so HEAD is always detached and
// `git rev-parse --abbrev-ref HEAD` prints "HEAD" — a branch-name assert can
// only fail on every trigger. The event-aware replacement asserts HEAD is on
// origin/main's history via merge-base, read from the local checkout —
// `persist-credentials: false` means a second network round-trip would not
// authenticate on this private repo.

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

  it("asserts HEAD is on origin/main's history, resolved locally", () => {
    const step = stepSource("Verify pinned main checkout");
    expect(step).toContain("merge-base --is-ancestor");
    // The issue keeps the attached-main assertion for the cron path — the
    // event's ref, not the detached HEAD, proves which checkout this is.
    expect(step).toContain('test "$HEAD_REF" = "refs/heads/main"');
    // The checkout runs with `persist-credentials: false`, so a second
    // network round-trip would not authenticate: the guard must read
    // origin/main from the history the checkout itself brought down.
    expect(step).not.toContain("git fetch");
  });
});
