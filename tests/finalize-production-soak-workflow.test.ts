import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

describe("production soak finalization workflow", () => {
  const workflow = readFileSync(".github/workflows/finalize-production-soak.yml", "utf8");
  const parsed = parse(workflow) as {
    on: { workflow_dispatch?: { inputs?: Record<string, { required?: boolean }> } };
    concurrency?: { group?: string; "cancel-in-progress"?: boolean; queue?: string };
    permissions?: Record<string, string>;
    jobs?: { finalize?: { environment?: { name?: string }; steps?: Array<{ id?: string; name?: string; uses?: string; run?: string; with?: Record<string, unknown> }> } };
  };

  it("shares the production deployment lock and accepts only explicit immutable identity", () => {
    expect(parsed.on.workflow_dispatch?.inputs).toMatchObject({
      deploy_run_id: { required: true },
      deploy_run_attempt: { required: true },
      deploy_sha: { required: true },
    });
    expect(parsed.concurrency).toEqual({
      group: "0509-production-provider-mutations",
      "cancel-in-progress": false,
      queue: "max",
    });
    expect(parsed.permissions).toEqual({ actions: "read", contents: "read" });
    expect(parsed.jobs?.finalize?.environment?.name).toBe("production");
    const identity = parsed.jobs?.finalize?.steps?.find((step) => step.name === "Validate immutable deploy identity");
    expect(identity?.run).toContain('[[ "$DEPLOY_SHA" =~ ^[a-f0-9]{40}$ ]]');

    const provenance = parsed.jobs?.finalize?.steps?.find((step) => step.name === "Verify successful protected production deploy");
    expect(provenance?.id).toBe("verify_deploy_run");
    expect(provenance?.uses).toBe(
      "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
    );
    const script = String(provenance?.with?.script);
    expect(script).toContain("github.rest.actions.getWorkflowRun");
    expect(script).toContain('run.head_branch === "main"');
    expect(script).toContain("github.rest.actions.getWorkflow");
    expect(script).toContain("run.workflow_id === workflow.id");
    expect(script).toContain('`${canonicalWorkflowPath}@main`');
    expect(script).toContain('run.status === "completed"');
    expect(script).toContain('run.conclusion === "success"');
    expect(script).toContain('run.repository?.full_name === "Nishfleet/0509"');
    expect(script).toContain('run.head_repository?.full_name === "Nishfleet/0509"');
    expect(script).toContain("run.run_attempt === expectedAttempt");
    expect(script).toContain("run.head_sha === expectedSha");
  });

  afterEach(() => {
    delete process.env.DEPLOY_RUN_ID;
    delete process.env.DEPLOY_RUN_ATTEMPT;
    delete process.env.DEPLOY_SHA;
  });

  it("executes the provenance predicate against GitHub's ref-qualified run path", async () => {
    const provenance = parsed.jobs?.finalize?.steps?.find((step) => step.name === "Verify successful protected production deploy");
    const script = String(provenance?.with?.script);
    const execute = new Function("github", "context", "core", `return (async () => { ${script} })();`);
    process.env.DEPLOY_RUN_ID = "123";
    process.env.DEPLOY_RUN_ATTEMPT = "2";
    process.env.DEPLOY_SHA = "a".repeat(40);
    const setFailed = vi.fn();
    const setOutput = vi.fn();
    const run = {
      id: 123,
      run_attempt: 2,
      head_sha: "a".repeat(40),
      head_branch: "main",
      path: ".github/workflows/deploy-production.yml@main",
      workflow_id: 456,
      status: "completed",
      conclusion: "success",
      event: "push",
      repository: { full_name: "Nishfleet/0509" },
      head_repository: { full_name: "Nishfleet/0509" },
    };
    const github = {
      rest: { actions: {
        getWorkflowRun: vi.fn().mockResolvedValue({ data: run }),
        getWorkflow: vi.fn().mockResolvedValue({ data: { id: 456, path: ".github/workflows/deploy-production.yml" } }),
      } },
    };

    await execute(github, { repo: { owner: "nish3451", repo: "0509" } }, { setFailed, setOutput });
    expect(setFailed).not.toHaveBeenCalled();
    expect(setOutput).toHaveBeenCalledWith("sha", "a".repeat(40));

    await execute({
      rest: { actions: {
        getWorkflowRun: vi.fn().mockResolvedValue({ data: { ...run, workflow_id: 999 } }),
        getWorkflow: github.rest.actions.getWorkflow,
      } },
    }, { repo: { owner: "nish3451", repo: "0509" } }, { setFailed, setOutput });
    expect(setFailed).toHaveBeenCalledWith("production_deploy_run_provenance_invalid");
  });

  it("restores, finalizes, and persists a distinct immutable passed archive", () => {
    const steps = parsed.jobs?.finalize?.steps ?? [];
    const download = steps.find((step) => step.name === "Download immutable running-soak evidence");
    const restore = steps.find((step) => step.name === "Restore permission-safe release evidence");
    const finalize = steps.find((step) => step.name === "Finalize exact Worker scheduled-work soak");
    const archive = steps.find((step) => step.name === "Archive immutable passed release evidence");
    const upload = steps.find((step) => step.name === "Preserve immutable passed release evidence");

    expect(download?.uses).toBe(
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    );
    expect(download?.with?.["run-id"]).toContain("steps.verify_deploy_run.outputs.run-id");
    expect(download?.with?.name).toContain("steps.verify_deploy_run.outputs.sha");
    expect(download?.with?.["github-token"]).toContain("secrets.GITHUB_TOKEN");
    expect(restore?.run).toContain("release-evidence-archive.mjs restore");
    expect(finalize?.run).toContain("gate-c-soak.mjs finalize");
    expect(archive?.run).toContain("release-evidence-archive.mjs create");
    expect(upload?.uses).toBe(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    expect(upload?.with?.name).toContain("production-release-final-evidence-");
    expect(upload?.with?.["retention-days"]).toBe(90);
    expect(workflow).not.toContain("D1_REMOTE_RESTORE_EVIDENCE_JSON");
  });
});
