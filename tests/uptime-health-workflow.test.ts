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

  it("keeps on-demand probes and removes the GitHub schedule (systemd timer owns cadence)", () => {
    // The GitHub Actions 5-minute schedule fired about once an hour in practice
    // (median 63 minutes between runs over 300 observations, 2026-07-25..2026-08-11),
    // so production liveness detection now runs as the 0509-liveness systemd
    // timer on the VPS (ops/liveness/, installed by
    // ops/liveness/provision-production-liveness.sh). The workflow remains
    // available for on-demand workflow_dispatch probes only.
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.on.schedule).toBeUndefined();
    expect(parsed.jobs.health?.["runs-on"]).toEqual("ubuntu-latest");
    expect(parsed.jobs.health?.["timeout-minutes"]).toBe(4);

    const healthStep = parsed.jobs.health?.steps?.find((step) => step.name === "Check production health endpoint");
    expect(healthStep?.env?.HEALTH_URL).toBe("https://0509.io/api/health");
    expect(healthStep?.run).toContain("curl --fail --show-error --silent --max-time 20 --retry 2");
    expect(healthStep?.run).toContain('payload.get("status") != "ok"');
    expect(healthStep?.run).toContain('payload.get("app") != "0509"');
    // Anonymous on-demand probes omit releaseIdentity, so the shallow step
    // asserts the public status/app contract only.
    expect(healthStep?.run).not.toContain("releaseIdentity");
    expect(healthStep?.run).not.toContain("worker_version=");
  });

  it("fails the run when the deep D1 health check is not ok", () => {
    const deepStep = parsed.jobs.health?.steps?.find(
      (step) => step.name === "Check production deep health endpoint (D1 and scheduled work)",
    );
    expect(deepStep?.env?.DEEP_HEALTH_URL).toBe("https://0509.io/api/health/deep");
    expect(deepStep?.run).toContain("curl --fail --show-error --silent --max-time 20 --retry 2");
    expect(deepStep?.run).toContain('checks.get("d1") != "ok"');
    expect(deepStep?.run).toContain('checks.get("scheduledWork") != "ok"');
    // The deep step tolerates a missing release identity; it cross-checks D1 +
    // scheduled-work health only.
    expect(deepStep?.run).not.toContain("EXPECTED_WORKER_VERSION");
    expect(deepStep?.run).not.toContain("releaseIdentity");
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
        FAKE_HEALTH_PAYLOAD: JSON.stringify(payload),
      },
      encoding: "utf8",
    });
    // Anonymous callers get no releaseIdentity; the deep probe must still pass.
    const healthy = {
      status: "ok",
      checks: { d1: "ok", scheduledWork: "ok" },
    };

    try {
      expect(run(healthy).status).toBe(0);
      expect(run({ ...healthy, checks: { d1: "error", scheduledWork: "ok" } }).status)
        .not.toBe(0);
      expect(run({ ...healthy, checks: { d1: "ok", scheduledWork: "degraded" } }).status)
        .not.toBe(0);
      expect(run({ ...healthy, status: "degraded" }).status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not persist worker-version evidence from anonymous probes", () => {
    // releaseIdentity is now gated behind the canary token; anonymous on-demand
    // probes cannot read a worker version, so there is nothing to persist. The
    // tokened deploy canary (prod-canary.lib.mjs + gate-c-soak) owns the
    // exact-worker identity assertion instead.
    const persistStep = parsed.jobs.health?.steps?.find(
      (step) => step.name === "Persist exact Worker-version evidence",
    );
    const uploadStep = parsed.jobs.health?.steps?.find(
      (step) => step.name === "Upload exact Worker-version evidence",
    );
    expect(persistStep).toBeUndefined();
    expect(uploadStep).toBeUndefined();
    expect(workflow).not.toContain("uptime-worker-evidence.json");
  });

  it("does not require secrets or private canary tokens", () => {
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("CANARY_BYPASS_TOKEN");
    expect(workflow).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(workflow).not.toContain("DODO");
  });
});