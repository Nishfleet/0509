import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  it("is manual dispatch only; the five-minute cadence lives in the VPS liveness timer", () => {
    expect(parsed.on.workflow_dispatch).toBeDefined();
    // The GitHub Actions 5-minute cron fired about once an hour (median 63
    // minutes between runs over 300 observations, 2026-07-25..2026-08-11), so
    // liveness detection moved to the 0509-liveness systemd timer on the VPS.
    expect(parsed.on.schedule).toBeUndefined();
    expect(workflow).toContain("ops/liveness/");
    expect(workflow).toContain("0509-liveness");
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
    expect(healthStep?.run).toContain('identity.get("searchRolloutMode") != "shadow"');
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
      releaseIdentity: { workerVersionId: "worker-v1", searchRolloutMode: "shadow" },
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
        releaseIdentity: { workerVersionId: "other", searchRolloutMode: "shadow" },
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

  it("executes the VPS liveness probe for healthy and degraded payloads", () => {
    const probe = readFileSync("ops/liveness/0509-liveness-probe.sh", "utf8");
    expect(probe).toContain("https://0509.io/api/health");
    expect(probe).toContain('payload.get("status") != "ok"');
    expect(probe).toContain('payload.get("app") != "0509"');
    expect(probe).toContain('checks.get("d1") != "ok"');
    expect(probe).toContain('checks.get("scheduledWork") != "ok"');
    const root = mkdtempSync(join(tmpdir(), "0509-liveness-probe-"));
    const state = join(root, "state");
    mkdirSync(state, { recursive: true });
    const curl = join(root, "curl");
    writeFileSync(curl, `#!/bin/sh
for last; do :; done
case "$last" in
  *"/api/health/deep") printf '%s\\n' "$FAKE_DEEP_PAYLOAD" ;;
  *) printf '%s\\n' "$FAKE_SHALLOW_PAYLOAD" ;;
esac
`);
    chmodSync(curl, 0o755);
    const run = (shallow: unknown, deep: unknown) => spawnSync(
      "bash",
      [resolve("ops/liveness/0509-liveness-probe.sh")],
      {
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ""}`,
          LIVENESS_STATE_DIR: state,
          HEALTH_URL: "https://0509.io/api/health",
          DEEP_HEALTH_URL: "https://0509.io/api/health/deep",
          FAKE_SHALLOW_PAYLOAD: JSON.stringify(shallow),
          FAKE_DEEP_PAYLOAD: JSON.stringify(deep),
        },
        encoding: "utf8",
      },
    );
    const healthy = {
      status: "ok",
      app: "0509",
      releaseIdentity: { workerVersionId: "worker-v1", searchRolloutMode: "shadow" },
    };
    const healthyDeep = {
      status: "ok",
      checks: { d1: "ok", scheduledWork: "ok" },
      releaseIdentity: { workerVersionId: "worker-v1", searchRolloutMode: "shadow" },
    };
    const lastRecord = () => {
      const lines = readFileSync(join(state, "probes.jsonl"), "utf8").trim().split("\n");
      return JSON.parse(lines[lines.length - 1]!);
    };

    try {
      expect(run(healthy, healthyDeep).status).toBe(0);
      expect(lastRecord()).toMatchObject({
        ok: true,
        workerVersionId: "worker-v1",
        searchRolloutMode: "shadow",
        d1: "ok",
        scheduledWork: "ok",
        error: null,
      });
      expect(JSON.parse(readFileSync(join(state, "latest.json"), "utf8")).status).toBe("ok");

      expect(run({ ...healthy, status: "degraded" }, healthyDeep).status).not.toBe(0);
      expect(lastRecord()).toMatchObject({ ok: false, error: "shallow_payload_invalid" });
      expect(run(healthy, { ...healthyDeep, checks: { d1: "error", scheduledWork: "ok" } }).status)
        .not.toBe(0);
      expect(run(healthy, {
        ...healthyDeep,
        releaseIdentity: { workerVersionId: "other", searchRolloutMode: "shadow" },
      }).status).not.toBe(0);
      expect(JSON.parse(readFileSync(join(state, "latest.json"), "utf8")).status).toBe("degraded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
