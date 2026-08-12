import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("uptime health workflow", () => {
  const workflow = readFileSync(".github/workflows/uptime-health.yml", "utf8");
  const parsed = parse(workflow) as {
    on: {
      workflow_dispatch?: unknown;
      schedule?: Array<{ cron?: string }>;
    };
    permissions?: Record<string, string>;
    jobs: {
      health?: {
        "runs-on"?: string;
        "timeout-minutes"?: number;
        steps?: Array<{
          name?: string;
          run?: string;
          env?: Record<string, string>;
          uses?: string;
          with?: Record<string, unknown>;
        }>;
      };
    };
  };

  it("checks the public health endpoint on an offset five-minute GitHub schedule", () => {
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.on.schedule).toEqual([
      { cron: "2,7,12,17,22,27,32,37,42,47,52,57 * * * *" },
    ]);
    expect(parsed.jobs.health?.["runs-on"]).toEqual([
      "self-hosted",
      "linux",
      "x64",
      "vps-verify",
    ]);
    expect(parsed.jobs.health?.["timeout-minutes"]).toBe(4);

    const healthStep = parsed.jobs.health?.steps?.find((step) => step.name === "Check production health endpoint");
    expect(healthStep?.env?.HEALTH_URL).toBe("https://0509.io/api/health");
    expect(healthStep?.run).toContain("curl --fail --show-error --silent --max-time 20 --retry 2");
    expect(healthStep?.run).toContain('payload.get("status") != "ok"');
    expect(healthStep?.run).toContain('payload.get("app") != "0509"');
    expect(healthStep?.run).toContain('identity.get("searchRolloutMode") != "v2"');
    expect(healthStep?.run).toContain("worker_version=");
  });

  it("fails the run when the deep D1 health check is not ok", () => {
    const deepStep = parsed.jobs.health?.steps?.find(
      (step) => step.name === "Check production deep health endpoint (D1 and scheduled work)",
    );
    expect(deepStep?.env?.DEEP_HEALTH_URL).toBe("https://0509.io/api/health/deep");
    expect(deepStep?.env?.EXPECTED_WORKER_VERSION).toContain("steps.shallow.outputs.worker_version");
    expect(deepStep?.run).toContain("curl --fail --show-error --silent --max-time 20 --retry 2");
    expect(deepStep?.run).toContain('checks.get("d1") != "ok"');
    expect(deepStep?.run).toContain('checks.get("scheduledWork") != "ok"');
    expect(deepStep?.run).toContain('identity.get("workerVersionId") != os.environ["EXPECTED_WORKER_VERSION"]');
  });

  it("executes the deep-health validator for healthy and degraded payloads", () => {
    const deepStep = parsed.jobs.health?.steps?.find(
      (step) => step.name === "Check production deep health endpoint (D1 and scheduled work)",
    );
    expect(deepStep?.run).toBeTruthy();
    const root = mkdtempSync(join(tmpdir(), "0509-deep-health-validator-"));
    const curl = join(root, "curl");
    writeFileSync(curl, "#!/bin/sh\nprintf '%s\\n' \"$FAKE_HEALTH_PAYLOAD\"\n");
    chmodSync(curl, 0o755);
    const run = (payload: unknown) => spawnSync("bash", ["-c", deepStep!.run!], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        DEEP_HEALTH_URL: "https://0509.io/api/health/deep",
        EXPECTED_WORKER_VERSION: "worker-v1",
        FAKE_HEALTH_PAYLOAD: JSON.stringify(payload),
      },
      encoding: "utf8",
    });
    const healthy = {
      status: "ok",
      checks: { d1: "ok", scheduledWork: "ok" },
      releaseIdentity: { workerVersionId: "worker-v1", searchRolloutMode: "v2" },
    };

    try {
      expect(run(healthy).status).toBe(0);
      expect(run({ ...healthy, checks: { d1: "error", scheduledWork: "ok" } }).status)
        .not.toBe(0);
      expect(run({ ...healthy, checks: { d1: "ok", scheduledWork: "degraded" } }).status)
        .not.toBe(0);
      expect(run({ ...healthy, status: "degraded" }).status).not.toBe(0);
      expect(run({
        ...healthy,
        releaseIdentity: { workerVersionId: "other", searchRolloutMode: "v2" },
      }).status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists exact Worker-version evidence for every health sample", () => {
    const persistStep = parsed.jobs.health?.steps?.find(
      (step) => step.name === "Persist exact Worker-version evidence",
    );
    const uploadStep = parsed.jobs.health?.steps?.find(
      (step) => step.name === "Upload exact Worker-version evidence",
    );
    expect(persistStep?.env?.WORKER_VERSION).toContain("steps.shallow.outputs.worker_version");
    expect(persistStep?.run).toContain('"workerVersionId"');
    expect(persistStep?.run).toContain('"runId"');
    expect(uploadStep?.uses).toBe(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    expect(uploadStep?.with?.name).toContain("uptime-worker-");
    expect(uploadStep?.with?.["retention-days"]).toBe(2);
  });

  it("does not require secrets or private canary tokens", () => {
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("CANARY_BYPASS_TOKEN");
    expect(workflow).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(workflow).not.toContain("DODO");
  });
});
