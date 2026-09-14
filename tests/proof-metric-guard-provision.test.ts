import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PROVISION = "ops/proof-metric-guard/provision-proof-metric-guard.sh";
const SERVICE = "ops/proof-metric-guard/0509-proof-metric-guard.service";
const RUN = "ops/proof-metric-guard/0509-proof-metric-guard-run.sh";

/**
 * Issue #1985's metric has TWO halves on a 7-day (168h) window: the real
 * screenshot rate AND the budget-skip surface. The rate half is already
 * guarded on 48h by ops/screenshot-rate-guard; this unit adds the 7-day
 * combined observer while also covering the budget-skip half, which had NO
 * scheduled observer. This file pins the three things that make the guard
 * real:
 *   (a) the provision script resolves a PATH for the nish user that can run
 *       node+npm under systemd (issue #1660 — this host's nish login shell
 *       does not put the node toolchain on PATH);
 *   (b) the service unit carries that PATH via __NODE_BIN_DIR__ substitution;
 *   (c) the run script really runs BOTH canaries on the 7-day window —
 *       most importantly the budget-skip-surface leg, so a future refactor
 *       cannot silently drop the half this issue is about.
 *
 * The drill runs against a HOME fixture, never the real host layout: on the
 * VPS node and npm share ~/.local/bin, but a host or runner image that
 * splits them makes --resolve-path depend on whichever ambient dir the
 * resolver happens to scan first — the same flake class that broke
 * tests/sitemap-coverage-guard-provision.test.ts on CI (#3478). The fixture
 * puts a DECOY lone node in $HOME/.local/bin — the stale-binary failure
 * mode the resolver exists to skip — and the real node+npm pair in
 * $HOME/bin, so the picked dir is deterministic everywhere.
 */
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
  const home = mkdtempSync(join(tmpdir(), "proof-metric-guard-home-"));
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

describe("proof-metric-guard provision PATH resolution", () => {
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
    // A lone `node` binary can exist in a dir with no npm (this host has a
    // stale root-owned /usr/local/bin/node and an empty ~/.bash_profile
    // that hides ~/.local/bin from login shells). The resolver must choose
    // a dir where BOTH tools are executable, not the first dir where
    // `command -v node` resolves — the fixture's decoy .local/bin proves it.
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
    expect(service.stdout).not.toContain("__NODE_BIN_DIR__");
  });
});

describe("proof-metric-guard run script (issue #1985 metric)", () => {
  it("runs BOTH canaries on the 7-day (168h) window", () => {
    const run = spawnSync("cat", [RUN], { encoding: "utf8" });
    expect(run.status).toBe(0);
    // The window single-source of truth is 168 (7 days) and every leg must
    // receive it so the issue's 7-day metric (not the older 48h/72h defaults)
    // is what is observed.
    expect(run.stdout).toContain("readonly WINDOW_HOURS=168");
    expect(run.stdout).toContain('--window-hours "${WINDOW_HOURS}"');
    // Both halves of the metric are wired in.
    expect(run.stdout).toContain("canary-proof-screenshot-rate.mjs");
    expect(run.stdout).toContain("canary-proof-budget-skip-surface.mjs");
    // BOTH rate legs enforce the issue's >=90% metric (not the canary's
    // looser 80% alert-headroom default) so the guard observes exactly what
    // #1985 promises on the real-watcher cohort too.
    expect((run.stdout.match(/--threshold 90/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the budget-skip-surface leg (the half with no prior observer)", () => {
    // Regression guard for the issue's whole point: the rate half is already
    // guarded on 48h, but the budget-skip half must not be able to silently
    // revert to "observed by nobody." The run script must reference the
    // budget-skip canary as its own leg and carry its exit through the
    // worst-of-verdict accumulator.
    const run = spawnSync("cat", [RUN], { encoding: "utf8" });
    expect(run.status).toBe(0);
    const budgetLeg = /run_leg "budget-skip surface \(168h\)" "\$\{BUDGET_CANARY\}" --window-hours "\$\{WINDOW_HOURS\}"/;
    expect(run.stdout).toMatch(budgetLeg);
    expect(run.stdout).toContain("budget_code");
    expect(run.stdout).toContain('if [[ "${budget_code}" -gt "${worst}" ]]; then');
  });
});