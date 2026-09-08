import { spawnSync } from "node:child_process";

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
 */

describe("proof-metric-guard provision PATH resolution", () => {
  it("resolves a guard PATH via --resolve-path without root or systemd", () => {
    const res = spawnSync("bash", [PROVISION, "--resolve-path"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
    const guardPath = res.stdout.trim();
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