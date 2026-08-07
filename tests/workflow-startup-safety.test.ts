/**
 * Guards against workflows that fail BEFORE they run a single step.
 *
 * A startup failure is the worst kind of CI break because it leaves nothing to
 * read: no logs, no failed step, no annotation. Just a red mark, and every tool
 * that watches for "a job failed" sees nothing, because no job ever existed.
 *
 * Two of these bit this repo:
 *
 *   1. `d1-backup-r2.yml` triggered on `push` while its own authorize step
 *      demanded `GITHUB_EVENT_NAME = workflow_dispatch` and an `expected_sha` a
 *      push cannot supply. Every run died at startup with zero jobs. The push
 *      trigger was removed to stop the noise, which left the repo with no
 *      automated backup at all - unnoticed from 2026-07-30 to 2026-08-07.
 *
 *   2. A job-level `env:` used `${{ runner.temp }}`. The `runner` context does
 *      not exist until a job is assigned to a runner, so Actions refuses the
 *      whole file (diagnosed in PR #465, 2026-07-31, which was closed without
 *      landing this protection).
 *
 * Both are statically detectable, which is the point: a startup failure caught
 * in review costs nothing, and caught in production costs a week of silence.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowsDirectory = ".github/workflows";

/** Contexts that do not exist yet when a job-level `env:` block is evaluated. */
const JOB_ENV_FORBIDDEN_CONTEXTS = ["runner", "steps", "job", "env", "matrix"];

type Job = {
  env?: Record<string, unknown>;
  steps?: Array<{ env?: Record<string, unknown> }>;
  if?: string;
};
type Workflow = { on?: unknown; jobs?: Record<string, Job> };

function workflowFiles(): string[] {
  return readdirSync(workflowsDirectory).filter(
    (name) => name.endsWith(".yml") || name.endsWith(".yaml"),
  );
}

function load(name: string): { source: string; parsed: Workflow } {
  const source = readFileSync(join(workflowsDirectory, name), "utf8");
  return { source, parsed: parse(source) as Workflow };
}

/** The `on:` key parses as boolean true in YAML 1.1 unless quoted. */
function triggerNames(parsed: Workflow): string[] {
  const on = (parsed as Record<string, unknown>).on ?? (parsed as Record<string, unknown>)[true as unknown as string];
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === "object") return Object.keys(on as object);
  return [];
}

describe("workflow startup safety", () => {
  it("every workflow file parses", () => {
    // An unparseable workflow is a startup failure on every trigger, and
    // reports as a red run with zero jobs and no logs.
    for (const name of workflowFiles()) {
      expect(() => load(name), `${name} does not parse`).not.toThrow();
    }
  });

  it("no job-level env uses a context that does not exist yet", () => {
    // This is the PR #465 failure. `runner`, `steps`, `job`, `env` and `matrix`
    // are unavailable when job-level env is evaluated, and Actions rejects the
    // entire file rather than the one job.
    for (const name of workflowFiles()) {
      const { parsed } = load(name);
      for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
        for (const [key, value] of Object.entries(job?.env ?? {})) {
          for (const context of JOB_ENV_FORBIDDEN_CONTEXTS) {
            expect(
              String(value),
              `${name}: job "${jobName}" env "${key}" uses \${{ ${context}.* }}, ` +
                `which is not available at job level and makes the whole file a ` +
                `startup failure. Move it to the step's env, or export it via ` +
                `GITHUB_ENV from a step.`,
            ).not.toMatch(new RegExp(`\\$\\{\\{\\s*${context}\\.`));
          }
        }
      }
    }
  });

  it("a workflow gated to one event is not also triggered by another", () => {
    // This is the d1-backup-r2 failure. A guard demanding a specific event,
    // with a trigger that can never satisfy it, fails at startup on every run
    // of that trigger - silently, forever.
    for (const name of workflowFiles()) {
      const { source, parsed } = load(name);
      const triggers = triggerNames(parsed);
      const gated = [...source.matchAll(/GITHUB_EVENT_NAME"?\s*=\s*"([a-z_]+)"/gu)]
        .map((m) => m[1]);
      if (gated.length === 0) continue;

      // A `case "$GITHUB_EVENT_NAME" in` block handles several events on
      // purpose; only a bare equality test is an exclusive gate.
      if (/case\s+"\$GITHUB_EVENT_NAME"/u.test(source)) continue;

      for (const trigger of triggers) {
        if (trigger === "workflow_call") continue;
        expect(
          gated,
          `${name}: triggers on "${trigger}" but its authorize step requires ` +
            `GITHUB_EVENT_NAME to be one of ${gated.join(", ")}. Runs from ` +
            `"${trigger}" will fail at startup with zero jobs and no logs. ` +
            `Either drop the trigger or widen the gate with a case block.`,
        ).toContain(trigger);
      }
    }
  });
});
