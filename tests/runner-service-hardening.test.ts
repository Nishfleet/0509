import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const provisioner = readFileSync(
  "ops/github-runners/provision-hardened-runners.sh",
  "utf8",
);
const unit = readFileSync(
  "ops/github-runners/github-runner-0509@.service",
  "utf8",
);
const slice = readFileSync(
  "ops/github-runners/github-0509.slice",
  "utf8",
);
const verifySlice = readFileSync(
  "ops/github-runners/github-0509-verify.slice",
  "utf8",
);
const reservedSlice = readFileSync(
  "ops/github-runners/github-0509-reserved.slice",
  "utf8",
);
const tmpfiles = readFileSync(
  "ops/github-runners/github-runner-0509.tmpfiles",
  "utf8",
);

describe("hardened GitHub runner services", () => {
  it("uses separate non-login identities and dedicated routing labels", () => {
    for (const instance of ["verify1", "verify2", "verify3", "monitor"]) {
      expect(provisioner).toContain(instance);
    }
    expect(provisioner).toContain("printf 'gha0509-%s");
    expect(provisioner).toContain("vps-verify");
    expect(provisioner).toContain("0509-%s");
    expect(provisioner).not.toContain("vps-deploy");
    expect(provisioner).toContain("0509-monitoring-hardened");
    expect(provisioner).toContain("--disableupdate");
    expect(provisioner).not.toMatch(/cp .*\.credentials/);
    expect(provisioner).toContain("Runner.Worker");
    expect(provisioner).toContain("legacy runner service");
    expect(provisioner).toContain("Validated existing runner identity");
  });

  it("reads a fresh registration token from a private file without tracing it", () => {
    expect(provisioner).toContain("set +x");
    expect(provisioner).toContain("RUNNER_REGISTRATION_TOKEN_FILE");
    expect(provisioner).toMatch(/stat -c '%a'/);
    expect(provisioner).toContain("shred -u");
    expect(provisioner).not.toMatch(/echo .*registration_token/i);
  });

  it("sandboxes every runner in a capped shared slice", () => {
    expect(unit).toContain("User=gha0509-%i");
    expect(unit).toContain("Slice=github-0509.slice");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("ProtectHome=true");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("ProtectProc=default");
    expect(unit).toContain("PrivateTmp=true");
    expect(unit).toContain("CapabilityBoundingSet=");
    expect(unit).toContain("AmbientCapabilities=");
    expect(unit).toContain("UMask=0077");
    expect(unit).toContain("KillMode=control-group");
    expect(unit).toContain("ReadWritePaths=/var/lib/github-runners/%i");
    expect(slice).toContain("CPUQuota=300%");
    expect(slice).toContain("MemoryHigh=10G");
    expect(slice).toContain("MemoryMax=12G");
    expect(verifySlice).toContain("CPUQuota=225%");
    expect(verifySlice).toContain("MemoryMax=8G");
    expect(verifySlice).toContain("TasksMax=1024");
    expect(reservedSlice).toContain("CPUQuota=75%");
    expect(reservedSlice).toContain("MemoryLow=2G");
    expect(provisioner).toContain("Slice=github-0509-verify.slice");
    expect(provisioner).toContain("Slice=github-0509-reserved.slice");
  });

  it("uses root-created stable lock inodes with only lock-group access", () => {
    expect(tmpfiles).toContain("d /run/lock/0509 3770 root gha0509-lock");
    expect(tmpfiles).toContain("f /run/lock/0509/deploy-window.lock 0660 root gha0509-lock");
    expect(tmpfiles).toContain(
      "f /run/lock/0509/deploy-window.lock.admission.lock 0660 root gha0509-lock",
    );
    expect(tmpfiles).toContain(
      "f /run/lock/0509/deploy-window.lock.held 0660 root gha0509-lock",
    );
    expect(tmpfiles).toContain(
      "f /run/lock/0509/deploy-window.lock.meta.lock 0660 root gha0509-lock",
    );
    expect(tmpfiles).toContain(
      "f /run/lock/0509/verify/queue/next-ticket 0660 root gha0509-lock",
    );
    for (const slot of [1, 2, 3]) {
      expect(tmpfiles).toContain(
        `f /run/lock/0509/verify/slot-${slot}.lock 0660 root gha0509-lock`,
      );
    }
    expect(unit).toContain(
      "Environment=DEPLOY_WINDOW_LOCK_FILE=/run/lock/0509/deploy-window.lock",
    );
    expect(unit).toContain("Environment=PATH=/opt/0509-runner/bin:");
  });

  it("keeps each unit below the aggregate cap and reserves host headroom", () => {
    expect(provisioner).toContain("CPUQuota=125%");
    expect(provisioner).toContain("MemoryMax=3G");
    expect(provisioner).toContain("CPUQuota=75%");
    expect(provisioner).toContain("MemoryMax=2G");
  });
});
