import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROBE = "ops/liveness/0509-liveness-probe.sh";
const SERVICE = "ops/liveness/0509-liveness.service";
const TIMER = "ops/liveness/0509-liveness.timer";
const PROVISION = "ops/liveness/provision-production-liveness.sh";

describe("ops liveness probe", () => {
  let tmpRoot: string;
  let binDir: string;
  let stateDir: string;
  let failStateDir: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "0509-liveness-probe-test-"));
    binDir = join(tmpRoot, "bin");
    stateDir = join(tmpRoot, "state");
    failStateDir = join(tmpRoot, "state-fail");
    require("node:fs").mkdirSync(binDir, { recursive: true });
    require("node:fs").mkdirSync(stateDir, { recursive: true });
    require("node:fs").mkdirSync(failStateDir, { recursive: true });
    // Fake curl routes by URL fragment: shallow → FAKE_SHALLOW_PAYLOAD,
    // deep → FAKE_DEEP_PAYLOAD. exit 0 either way; failures are simulated by
    // an empty payload + a separate curl-fail script.
    const fakeCurl = join(binDir, "curl");
    writeFileSync(
      fakeCurl,
      [
        "#!/bin/sh",
        // The probe passes the URL as the last argument; pick by suffix.
        "case \"$*\" in",
        "  *api/health/deep*) printf '%s\\n' \"$FAKE_DEEP_PAYLOAD\" ;;",
        "  *)                 printf '%s\\n' \"$FAKE_SHALLOW_PAYLOAD\" ;;",
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(fakeCurl, 0o755);
    const failCurl = join(binDir, "curl-fail");
    writeFileSync(
      failCurl,
      "#!/bin/sh\necho 'curl: connection refused' >&2\nexit 7\n",
    );
    chmodSync(failCurl, 0o755);
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("ships the probe, service, timer, and provisioner files", () => {
    for (const path of [PROBE, SERVICE, TIMER, PROVISION]) {
      expect(existsSync(path), `expected ${path} to exist`).toBe(true);
    }
    expect(readFileSync(PROBE, "utf8").startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(readFileSync(PROVISION, "utf8").startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(readFileSync(SERVICE, "utf8")).toContain("DynamicUser=yes");
    expect(readFileSync(SERVICE, "utf8")).toContain("StateDirectory=0509-liveness");
    expect(readFileSync(SERVICE, "utf8")).toContain("Restart=no");
    expect(readFileSync(TIMER, "utf8")).toContain("OnCalendar=*:2/5");
    expect(readFileSync(TIMER, "utf8")).toContain("Persistent=true");
  });

  it("asserts the current production searchRolloutMode (v2), not the long-gone shadow mode", () => {
    const probe = readFileSync(PROBE, "utf8");
    expect(probe).toContain('"v2"');
    expect(probe).not.toContain('"shadow"');
    expect(probe).toContain('payload.get("status")');
    expect(probe).toContain('checks.get("d1")');
    expect(probe).toContain('checks.get("scheduledWork")');
    expect(probe).toContain("[A-Za-z0-9._-]{1,128}");
    expect(probe).toContain("--max-time 20");
    expect(probe).toContain("--retry 2");
  });

  it("writes ok/degraded evidence + probes.jsonl record and exits 0 on healthy run", () => {
    const result = spawnSync("bash", [PROBE], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        LIVENESS_STATE_DIR: stateDir,
        HEALTH_URL: "https://0509.io/api/health",
        DEEP_HEALTH_URL: "https://0509.io/api/health/deep",
        FAKE_SHALLOW_PAYLOAD: JSON.stringify({
          status: "ok",
          app: "0509",
          releaseIdentity: { workerVersionId: "worker-v1", searchRolloutMode: "v2" },
        }),
        FAKE_DEEP_PAYLOAD: JSON.stringify({
          status: "ok",
          checks: { d1: "ok", scheduledWork: "ok" },
          releaseIdentity: { workerVersionId: "worker-v1", searchRolloutMode: "v2" },
        }),
      },
      encoding: "utf8",
    });
    if (result.status !== 0) {
      // Surface stderr so the failure is actionable without re-running.
      throw new Error(
        `probe exited ${result.status}; stderr=${result.stderr}; stdout=${result.stdout}`,
      );
    }
    const records = readFileSync(join(stateDir, "probes.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(records.length).toBe(1);
    const record = JSON.parse(records[0]);
    expect(record.ok).toBe(true);
    expect(record.workerVersionId).toBe("worker-v1");
    expect(record.searchRolloutMode).toBe("v2");
    expect(record.d1).toBe("ok");
    expect(record.scheduledWork).toBe("ok");
    const latest = JSON.parse(readFileSync(join(stateDir, "latest.json"), "utf8"));
    expect(latest.status).toBe("ok");
    expect(latest.workerVersionId).toBe("worker-v1");
    expect(latest.error).toBeNull();
  });

  it("exits non-zero with a degraded latest.json when the shallow probe fails", () => {
    const result = spawnSync("bash", [PROBE], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        LIVENESS_STATE_DIR: failStateDir,
        HEALTH_URL: "https://0509.io/api/health",
        DEEP_HEALTH_URL: "https://0509.io/api/health/deep",
        FAKE_SHALLOW_PAYLOAD: "",
        FAKE_DEEP_PAYLOAD: "",
      },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    const latest = JSON.parse(readFileSync(join(failStateDir, "latest.json"), "utf8"));
    expect(latest.status).toBe("degraded");
    expect(latest.error).toBeTruthy();
    const records = readFileSync(join(failStateDir, "probes.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(records.length).toBe(1);
    const record = JSON.parse(records[0]);
    expect(record.ok).toBe(false);
  });
});
