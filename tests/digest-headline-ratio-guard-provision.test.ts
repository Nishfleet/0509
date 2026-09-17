import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
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
//
// The drill runs against a HOME fixture, never the real host layout: on the
// VPS node and npm share ~/.local/bin, but a host or runner image that
// splits them makes --resolve-path depend on whichever ambient dir the
// resolver happens to scan first — the same flake class that broke
// tests/sitemap-coverage-guard-provision.test.ts on CI (#3478). The fixture
// puts a DECOY lone node in $HOME/.local/bin — the stale-binary failure
// mode the resolver exists to skip — and the real node+npm pair in
// $HOME/bin, so the picked dir is deterministic everywhere.
function realBin(name: string): string {
  const res = spawnSync("bash", ["-c", `command -v ${name}`], {
    encoding: "utf8",
  });
  const found = res.stdout.trim();
  if (res.status !== 0 || !found) {
    throw new Error(`fixture: ${name} is not on this host's PATH`);
  }
  return found;
}

function fixtureHome(): { home: string; pairDir: string } {
  const home = mkdtempSync(join(tmpdir(), "digest-guard-home-"));
  const decoyDir = join(home, ".local", "bin");
  const pairDir = join(home, "bin");
  mkdirSync(decoyDir, { recursive: true });
  mkdirSync(pairDir, { recursive: true });
  symlinkSync(realBin("node"), join(decoyDir, "node"));
  symlinkSync(realBin("node"), join(pairDir, "node"));
  symlinkSync(realBin("npm"), join(pairDir, "npm"));
  return { home, pairDir };
}

function resolveGuardPath(home: string) {
  return spawnSync("bash", [PROVISION, "--resolve-path"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

describe("digest-headline-ratio guard provision PATH resolution", () => {
  it("resolves a guard PATH via --resolve-path without root or systemd", () => {
    const { home, pairDir } = fixtureHome();
    const res = resolveGuardPath(home);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
    // The decoy $HOME/.local/bin (lone node, no npm) must be skipped; the
    // resolved PATH is the pair dir plus the standard systemd PATH.
    expect(res.stdout.trim()).toBe(
      `${pairDir}:/usr/local/bin:/usr/bin:/bin`,
    );
  });

  it("resolves node and npm within the resolved guard PATH", () => {
    const { home, pairDir } = fixtureHome();
    const res = resolveGuardPath(home);
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
    expect(node.stdout.trim()).toBe(`${pairDir}/node`);
    expect(npm.status).toBe(0);
    expect(npm.stdout.trim()).toBe(`${pairDir}/npm`);
  });

  it("picks a node bin dir containing BOTH node and npm executables", () => {
    // Regression coverage for the host failure mode: a lone `node` binary can
    // exist in a dir with no npm (this host has a stale root-owned
    // /usr/local/bin/node and an empty ~/.bash_profile that hides ~/.local/bin
    // from login shells). The resolver must choose a dir where BOTH tools are
    // executable, not the first dir where `command -v node` resolves — the
    // fixture's decoy .local/bin proves it.
    const { home, pairDir } = fixtureHome();
    const res = resolveGuardPath(home);
    expect(res.status).toBe(0);
    const nodeBinDir = res.stdout.trim().split(":")[0];
    expect(nodeBinDir).toBe(pairDir);
    for (const bin of ["node", "npm"]) {
      const check = spawnSync("test", ["-x", `${nodeBinDir}/${bin}`]);
      expect(check.status).toBe(0);
    }
  });

  it("renders the service unit with the discovered node bin dir substituted", () => {
    const { home, pairDir } = fixtureHome();
    const res = resolveGuardPath(home);
    expect(res.status).toBe(0);
    const nodeBinDir = res.stdout.trim().split(":")[0];
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
