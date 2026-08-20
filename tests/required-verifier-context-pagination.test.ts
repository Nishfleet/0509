import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Regression for the required-verifier-integrity context-assembly pagination
// bug (2026-08-20, shipped by the sole-admin attestation change):
//
//   `gh api --paginate ... --jq '[.[] | {…}]'` applies --jq PER PAGE and
//   concatenates the per-page results. For a PR with >100 files, >100
//   reviews, or >100 issue comments the raw value becomes N back-to-back
//   arrays, which is NOT a single valid JSON document and crashes the final
//   `jq -n --argjson` that builds the context bundle ("invalid JSON text
//   passed to --argjson", exit 2). PR #626 hit this with 104 issue comments.
//
// The fix: every paginated fetch emits one object per line (`--jq '.[] | …'`)
// and then slurps the whole stream into one array (`| jq -s .`), so the
// result is always a single array regardless of page count.
//
// These tests fail on the buggy shape (`--jq '[.[] | …]'`, no slurp) and pass
// on the healed shape.

const WORKFLOW = ".github/workflows/required-verifier-integrity.yml";

type WorkflowStep = {
  id?: string;
  run?: string;
};

/** The `run` script of the "Resolve candidate context" step (id=context). */
function contextStepRun(): string {
  const doc = parse(readFileSync(WORKFLOW, "utf8")) as Record<string, unknown>;
  const job = (doc as Record<string, any>).jobs?.["required-verifier-integrity"];
  const step = job?.steps?.find((s: WorkflowStep) => s?.id === "context");
  const run = step?.run;
  if (typeof run !== "string" || run.length === 0) {
    throw new Error(`'Resolve candidate context' step (id=context) not found in ${WORKFLOW}`);
  }
  return run;
}

describe("required-verifier-integrity context assembly: pagination", () => {
  it("merges every paginated gh api fetch into a single array (never concatenated per-page arrays)", () => {
    const run = contextStepRun();
    const paginated = [...run.matchAll(/gh api --paginate[^\n]*/g)];
    // files, reviews, comments — at least these three paginated fetches exist.
    expect(paginated.length).toBeGreaterThanOrEqual(3);

    for (const m of paginated) {
      const block = run.slice(m.index ?? 0);
      // Buggy shape: array-wrapping --jq applied per page -> concatenated arrays.
      expect(block, "array-wrapping --jq would concatenate per-page arrays").not.toMatch(/--jq '\['/);
      // Healed shape: object-stream --jq piped into a single slurped array.
      expect(block, "paginated fetch must emit one object per line then slurp").toMatch(
        /--jq '\.\[\] \| [^']+' \| jq -s \./,
      );
    }
  });

  it("turns two concatenated API pages into one valid array (functional)", () => {
    // Simulate gh --paginate concatenating two pages into the raw response.
    const page1 = JSON.stringify([{ id: 1 }, { id: 2 }]);
    const page2 = JSON.stringify([{ id: 3 }]);
    const concatenated = `${page1}${page2}`;

    // Show the buggy shape yields N documents (invalid for --argjson).
    const buggy = execFileSync("jq", ["[.[] | {id}]"], { input: concatenated, encoding: "utf8" });
    const buggyDocs = buggy.trim().split("\n");
    expect(buggyDocs.length).toBeGreaterThan(1);

    // Healed shape: one object per line, then slurp the stream into one array.
    const stream = execFileSync("jq", [".[] | {id}"], { input: concatenated, encoding: "utf8" });
    const single = execFileSync("jq", ["-s", "."], { input: stream, encoding: "utf8" });
    const parsed = JSON.parse(single.trim());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.map((x: { id: number }) => x.id)).toEqual([1, 2, 3]);
  });
});
