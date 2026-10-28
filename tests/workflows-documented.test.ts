import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCUMENTED = ["agent-dispatch.yml", "stale-base-retest.yml"] as const;

interface Concurrency {
  group: string;
  "cancel-in-progress"?: unknown;
}

interface DispatchStub {
  on: {
    issues: { types: string[] };
    issue_comment: { types: string[] };
    workflow_dispatch: { inputs: Record<string, unknown> };
    pull_request_target: { types: string[] };
    workflow_run: { workflows: string[]; types: string[] };
    schedule: { cron: string }[];
  };
  concurrency: Concurrency;
  permissions: Record<string, string>;
  jobs: {
    dispatch: {
      if?: unknown;
      uses?: string;
      permissions?: Record<string, string>;
      with?: Record<string, unknown>;
    };
  };
}

async function read(relative: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relative), "utf8");
}

function section(markdown: string, workflow: string): string {
  const heading = `### \`${workflow}\``;
  const start = markdown.indexOf(heading);
  if (start === -1) return "";
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/^#{2,3} /m);
  return end === -1 ? rest : rest.slice(0, end);
}

async function stub(): Promise<DispatchStub> {
  return parse(await read(".github/workflows/agent-dispatch.yml")) as DispatchStub;
}

describe("a workflow that acts on its own is documented and versioned (0509#7728)", () => {
  it.each(DOCUMENTED)("%s carries a version its README section repeats", async (workflow) => {
    const version = /^# version: (\d+)/m.exec(await read(`.github/workflows/${workflow}`))?.[1] ?? "";
    expect(version).not.toBe("");
    expect(section(await read("README.md"), workflow)).toContain(`Version: ${version}.`);
  });

  it.each(DOCUMENTED)("%s is switched off with the stock command and has a delete step", async (workflow) => {
    const documented = section(await read("README.md"), workflow);
    expect(documented).toContain(`Switch it off: \`gh workflow disable ${workflow}\``);
    expect(documented).toContain("Remove it:");
  });
});

describe("the dispatch stub's trigger and concurrency contract (0509#7728)", () => {
  it("starts on the fleet's events and no others", async () => {
    const dispatch = await stub();
    expect(Object.keys(dispatch.on).sort()).toEqual([
      "issue_comment",
      "issues",
      "pull_request_target",
      "schedule",
      "workflow_dispatch",
      "workflow_run",
    ]);
    expect(dispatch.on.issues.types).toEqual(["labeled", "closed", "reopened"]);
    expect(dispatch.on.issue_comment.types).toEqual(["created"]);
    expect(dispatch.on.workflow_run).toEqual({ workflows: ["CI"], types: ["completed"] });
    expect(dispatch.on.schedule).toEqual([{ cron: "17 * * * *" }]);
    expect(dispatch.on.pull_request_target.types).toEqual([
      "dequeued",
      "auto_merge_disabled",
      "closed",
      "auto_merge_enabled",
      "synchronize",
      "labeled",
      "opened",
      "reopened",
      "ready_for_review",
    ]);
    expect(Object.keys(dispatch.on.workflow_dispatch.inputs).sort()).toEqual(["issue", "task"]);
  });

  it("gives a pull request event its own group and the sweep a per-run group", async () => {
    const dispatch = await stub();
    expect(dispatch.concurrency.group).toBe(
      "${{ github.event_name == 'pull_request_target' && github.event.action != 'closed' && format('agent-dispatch-pr-{0}-{1}-{2}', github.repository, github.event.pull_request.number, github.event.action) || format('agent-dispatch-stub-{0}', github.run_id) }}",
    );
    expect(dispatch.concurrency["cancel-in-progress"]).toBe(
      "${{ github.event_name == 'pull_request_target' && github.event.action == 'synchronize' }}",
    );
  });

  it("never sends a fork pull request to the callee", async () => {
    const dispatch = await stub();
    expect(dispatch.jobs.dispatch.if).toBe(
      "github.event_name != 'pull_request_target' || github.event.action == 'closed' || github.event.pull_request.head.repo.full_name == github.repository",
    );
  });

  it("keeps the stub read-only and grants the callee only what its jobs need", async () => {
    const dispatch = await stub();
    expect(dispatch.permissions).toEqual({ contents: "read" });
    expect(dispatch.jobs.dispatch.permissions).toEqual({
      issues: "write",
      "pull-requests": "write",
      contents: "write",
      actions: "read",
      checks: "read",
      statuses: "read",
    });
  });

  it("keeps the callee on @main, the ref runner group 3 admits, with the incident on the line", async () => {
    const dispatch = await stub();
    expect(dispatch.jobs.dispatch.uses).toBe("Nishfleet/fleet-ops/.github/workflows/agent-dispatch.yml@main");
    const line =
      (await read(".github/workflows/agent-dispatch.yml"))
        .split("\n")
        .find((candidate) => candidate.includes("Nishfleet/fleet-ops/.github/workflows/agent-dispatch.yml@")) ?? "";
    expect(line).toContain("0509#5231");
  });

  it("passes the caller's issue, task and AGENT_MODE to the callee", async () => {
    const dispatch = await stub();
    expect(dispatch.jobs.dispatch.with).toEqual({
      issue: "${{ inputs.issue }}",
      agent_mode: "${{ vars.AGENT_MODE }}",
      task: "${{ inputs.task }}",
    });
  });
});
