import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PROVISION = "ops/digest-headline-ratio-guard/provision-digest-headline-ratio-guard.sh";
const SERVICE = "ops/digest-headline-ratio-guard/0509-digest-headline-ratio-guard.service";

// The guard unit runs as the nish user under systemd, which does not source
// the nish login shell. node/npm live under the nish toolchain (not
// /usr/bin), so the unit must carry an explicit Environment=PATH whose node
// bin dir is discovered at provision time. These tests assert that the
// provision script resolves that PATH deterministically and that node AND
// npm both resolve within it (issue #1660).
describe("digest-headline-ratio guard provision PATH resolution", () => {
  it("resolves a guard PATH via --resolve-path without root or systemd", () => {
    const res = spawnSync("bash", [PROVISION, "--resolve-path"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
    const guardPath = res.stdout.trim();
    // The resolved PATH must be a colon-joined list starting with a node bin
    // dir and ending with the standard systemd PATH.
    expect(guardPath).toMatch(/^\/[^:]+:\/usr\/local\/bin:\/usr\/bin:\/bin$/);
  });

  it("resolves node and npm within the resolved guard PATH", () => {
    const res = spawnSync("bash", [PROVISION, "--resolve-path"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    const guardPath = res.stdout.trim();
    const node = spawnSync("bash", ["-c", `command -v node`], {
      encoding: "utf8",
      env: { ...process.env, PATH: guardPath },
    });
    const npm = spawnSync("bash", ["-c", `command -v npm`], {
      encoding: "utf8",
      env: { ...process.env, PATH: guardPath },
    });
    expect(node.status).toBe(0);
    expect(node.stdout.trim()).toMatch(/\/node$/);
    expect(npm.status).toBe(0);
    expect(npm.stdout.trim()).toMatch(/\/npm$/);
  });

  it("renders the service unit with the discovered node bin dir substituted", () => {
    const res = spawnSync("bash", [PROVISION, "--resolve-path"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    const guardPath = res.stdout.trim();
    const nodeBinDir = guardPath.split(":")[0];
    const service = spawnSync("bash", [
      "-c",
      `sed "s|__NODE_BIN_DIR__|${nodeBinDir}|" "${SERVICE}"`,
    ], { encoding: "utf8" });
    expect(service.status).toBe(0);
    expect(service.stdout).toContain(
      `Environment=PATH=${nodeBinDir}:/usr/local/bin:/usr/bin:/bin`,
    );
    // The placeholder must never survive into a rendered unit.
    expect(service.stdout).not.toContain("__NODE_BIN_DIR__");
  });
});
