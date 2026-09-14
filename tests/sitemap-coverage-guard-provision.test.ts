import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PROVISION = "ops/sitemap-coverage-guard/provision-sitemap-coverage-guard.sh";
const SERVICE = "ops/sitemap-coverage-guard/0509-sitemap-coverage-guard.service";
const TIMER = "ops/sitemap-coverage-guard/0509-sitemap-coverage-guard.timer";
const RUN = "ops/sitemap-coverage-guard/0509-sitemap-coverage-guard-run.sh";

// The guard unit runs as the nish user under systemd, which does not source
// the nish login shell. node/gh live under the nish toolchain (not
// /usr/bin), so the unit must carry an explicit Environment=PATH whose
// toolchain bin dir is discovered at provision time. These tests assert that
// the provision script resolves that PATH deterministically, that node AND
// gh both resolve within it (the canary's --file-issue path needs gh), and
// that the timer actually carries a schedule — same drill coverage as
// tests/digest-headline-ratio-guard-provision.test.ts.
//
// The drill runs against a HOME fixture, never the real host layout: on the
// VPS node and gh share ~/.local/bin, but on the CI runner node sits in
// hostedtoolcache and gh in /usr/bin, so no real candidate dir holds both
// and --resolve-path correctly fails there (deploy-blocking red, #3415
// follow-up). The fixture puts a DECOY lone node in $HOME/.local/bin — the
// stale-binary failure mode the resolver exists to skip — and the real
// node+gh pair in $HOME/bin, so the picked dir is deterministic everywhere.
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
  const home = mkdtempSync(join(tmpdir(), "sitemap-guard-home-"));
  const decoyDir = join(home, ".local", "bin");
  const pairDir = join(home, "bin");
  mkdirSync(decoyDir, { recursive: true });
  mkdirSync(pairDir, { recursive: true });
  symlinkSync(realBin("node"), join(decoyDir, "node"));
  symlinkSync(realBin("node"), join(pairDir, "node"));
  symlinkSync(realBin("gh"), join(pairDir, "gh"));
  return { home, pairDir };
}

function resolveGuardPath(home: string) {
  return spawnSync("bash", [PROVISION, "--resolve-path"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

describe("sitemap-coverage guard provision PATH resolution (issue #3166)", () => {
  it("resolves a guard PATH via --resolve-path without root or systemd", () => {
    const { home, pairDir } = fixtureHome();
    const res = resolveGuardPath(home);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
    // The decoy $HOME/.local/bin (lone node, no gh) must be skipped; the
    // resolved PATH is the pair dir plus the standard systemd PATH.
    expect(res.stdout.trim()).toBe(
      `${pairDir}:/usr/local/bin:/usr/bin:/bin`,
    );
  });

  it("resolves node and gh within the resolved guard PATH", () => {
    const { home, pairDir } = fixtureHome();
    const res = resolveGuardPath(home);
    expect(res.status).toBe(0);
    const guardPath = res.stdout.trim();
    const node = spawnSync("bash", ["-c", `command -v node`], {
      encoding: "utf8",
      env: { ...process.env, PATH: guardPath },
    });
    const gh = spawnSync("bash", ["-c", `command -v gh`], {
      encoding: "utf8",
      env: { ...process.env, PATH: guardPath },
    });
    expect(node.status).toBe(0);
    expect(node.stdout.trim()).toBe(`${pairDir}/node`);
    expect(gh.status).toBe(0);
    expect(gh.stdout.trim()).toBe(`${pairDir}/gh`);
  });

  it("picks a toolchain bin dir containing BOTH node and gh executables", () => {
    // A lone `node` binary can exist in a dir with no gh (this host has a
    // stale root-owned /usr/local/bin/node and an empty ~/.bash_profile
    // that hides ~/.local/bin from login shells). The resolver must choose
    // a dir where BOTH tools are executable, not the first dir where
    // `command -v node` resolves — the fixture's decoy .local/bin proves it.
    const { home, pairDir } = fixtureHome();
    const res = resolveGuardPath(home);
    expect(res.status).toBe(0);
    const nodeBinDir = res.stdout.trim().split(":")[0];
    expect(nodeBinDir).toBe(pairDir);
    for (const bin of ["node", "gh"]) {
      const check = spawnSync("test", ["-x", `${nodeBinDir}/${bin}`]);
      expect(check.status).toBe(0);
    }
  });

  it("renders the service unit with the discovered bin dir substituted", () => {
    const { home, pairDir } = fixtureHome();
    const res = resolveGuardPath(home);
    expect(res.status).toBe(0);
    const service = spawnSync("bash", [
      "-c",
      `sed "s|__NODE_BIN_DIR__|${pairDir}|" "${SERVICE}"`,
    ], { encoding: "utf8" });
    expect(service.status).toBe(0);
    expect(service.stdout).toContain(
      `Environment=PATH=${pairDir}:/usr/local/bin:/usr/bin:/bin`,
    );
    // The placeholder must never survive into a rendered unit.
    expect(service.stdout).not.toContain("__NODE_BIN_DIR__");
  });
});

describe("sitemap-coverage guard unit sanity (issue #3166)", () => {
  const read = (path: string) =>
    spawnSync("cat", [path], { encoding: "utf8" }).stdout;

  it("the timer carries an OnCalendar schedule", () => {
    // A timer with no OnCalendar never fires — the guard would install
    // green and alarm never.
    expect(read(TIMER)).toMatch(/^OnCalendar=\*-\*-\* \d{2}:\d{2}:\d{2}/m);
    expect(read(TIMER)).toContain("Persistent=true");
    expect(read(TIMER)).toContain("Unit=0509-sitemap-coverage-guard.service");
  });

  it("the service TimeoutStartSec bounds a full token-less pass", () => {
    // ~360 advertised URLs at 1 req / 5.2s ≈ 31-35 min plus retries; the
    // bound must exceed that or the timer SIGTERMs mid-crawl daily.
    const service = read(SERVICE);
    const seconds = Number(service.match(/^TimeoutStartSec=(\d+)$/m)?.[1]);
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(3600);
    expect(service).toContain("Environment=PATH=__NODE_BIN_DIR__");
    expect(service).toContain("Restart=no");
  });

  it("the run script fails loud when node/gh are off PATH", () => {
    expect(read(RUN)).toContain("command -v node");
    expect(read(RUN)).toContain("command -v gh");
    expect(read(RUN)).toContain("resolved PATH=${PATH}");
  });
});
