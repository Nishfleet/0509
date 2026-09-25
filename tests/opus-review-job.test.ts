import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #4629: pin the opus-review job's guard rails in ci.yml so a casual edit
// (model swap, allowedTools trim, sticky-comment flip, dropped worker guard,
// or a blocked-by-judge label regression) fails this test instead of silently
// changing how every PR is graded. The test reads the real workflow file — a
// restated copy could pass forever against a workflow that moved on without it.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `readJob(yaml)` extracts the single opus-review job block from the workflow
// file as raw text. The job sits at the bottom of the file, its first line is
// `  opus-review:`, and the block ends at the next sibling top-level job
// header (or EOF). Lines outside that block would make the asserts below pass
// against the wrong text — exactly the silent break this test exists to catch.
function readJob(yaml: string): string {
  const lines = yaml.split("\n");
  const start = lines.indexOf("  opus-review:");
  if (start === -1) throw new Error("opus-review job not found in ci.yml");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[a-z][a-z0-9_-]*:$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("opus-review job guard rails", () => {
  it("runs on the claude-opus-5-5 model", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = readJob(yaml);
    expect(job).toContain("--model claude-opus-5-5");
  });

  it("uses the restricted allowedTools list that pins grader scope", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = readJob(yaml);
    expect(job).toContain(
      '--allowedTools "mcp__github_inline_comment__create_inline_comment,Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*),Bash(gh pr edit:*),Bash(gh issue view:*),Bash(gh issue edit:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*)"',
    );
  });

  it("posts a sticky comment instead of one comment per push", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = readJob(yaml);
    expect(job).toContain("use_sticky_comment: true");
  });

  // Nish 2026-09-25 17:09Z paused grading until Monday 2026-09-28 (#5567):
  // the job then runs on merge_group only. Either way no PR but the worker
  // bot's is ever graded; reverting #5567 restores the single form.
  it("grades only the nishfleet-worker bot's PRs, or none while paused", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = readJob(yaml);
    const guard = job.split("\n").find((line) => line.startsWith("    if: "));
    expect([
      "    if: github.event_name == 'merge_group' || (github.event_name == 'pull_request' && github.event.pull_request.user.login == 'nishfleet-worker[bot]')",
      "    if: github.event_name == 'merge_group'",
    ]).toContain(guard);
    expect(job).toContain("allowed_bots: 'nishfleet-worker'");
  });

  it("drives the blocked-by-judge label through gh and fails closed on it", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = readJob(yaml);
    expect(job).toContain("gh pr edit --add-label blocked-by-judge");
    expect(job).toContain("gh pr edit --remove-label blocked-by-judge");
    expect(job).toContain('! grep -qx blocked-by-judge "$RUNNER_TEMP/labels"');
  });
});
