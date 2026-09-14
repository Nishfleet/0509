import { spawnSync } from "node:child_process";

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
describe("sitemap-coverage guard provision PATH resolution (issue #3166)", () => {
  it("resolves a guard PATH via --resolve-path without root or systemd", () => {
    const res = spawnSync("bash", [PROVISION, "--resolve-path"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
    const guardPath = res.stdout.trim();
    // The resolved PATH must be a colon-joined list starting with one or
    // two toolchain bin dirs (a single dir carrying both node and gh, or a
    // <node-dir>:<gh-dir> pair on hosts where the tools are split, e.g. CI
    // runners) and ending with the standard systemd PATH.
    expect(guardPath).toMatch(
      /^\/[^:]+(:\/[^:]+)?:\/usr\/local\/bin:\/usr\/bin:\/bin$/,
    );
  });

  it("resolves node and gh within the resolved guard PATH", () => {
    const res = spawnSync("bash", [PROVISION, "--resolve-path"], {
      encoding: "utf8",
    });
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
    expect(node.stdout.trim()).toMatch(/\/node$/);
    expect(gh.status).toBe(0);
    expect(gh.stdout.trim()).toMatch(/\/gh$/);
  });

  it("emits a toolchain prefix leading with a real node bin dir", () => {
    // A lone `node` binary can exist in a dir with no gh (this host has a
    // stale root-owned /usr/local/bin/node and an empty ~/.bash_profile
    // that hides ~/.local/bin from login shells). The resolver must lead
    // with a dir carrying an executable node — preferring ONE dir with both
    // node and gh, falling back to a <node-dir>:<gh-dir> prefix on hosts
    // where the tools are split (CI: node in a toolcache, gh in /usr/bin).
    // Either way every emitted dir must be a real bin dir carrying at least
    // one of the tools.
    const res = spawnSync("bash", [PROVISION, "--resolve-path"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    const prefix = res.stdout
      .trim()
      .replace(/:\/usr\/local\/bin:\/usr\/bin:\/bin$/, "");
    const dirs = prefix.split(":");
    expect(
      spawnSync("test", ["-x", `${dirs[0]}/node`]).status,
    ).toBe(0);
    for (const dir of dirs) {
      const carriesTool =
        spawnSync("test", ["-x", `${dir}/node`]).status === 0 ||
        spawnSync("test", ["-x", `${dir}/gh`]).status === 0;
      expect(carriesTool).toBe(true);
    }
  });

  it("renders the service unit with the discovered prefix substituted", () => {
    const res = spawnSync("bash", [PROVISION, "--resolve-path"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    const guardPath = res.stdout.trim();
    const prefix = guardPath.replace(
      /:\/usr\/local\/bin:\/usr\/bin:\/bin$/,
      "",
    );
    const service = spawnSync("bash", [
      "-c",
      `sed "s|__NODE_BIN_DIR__|${prefix}|" "${SERVICE}"`,
    ], { encoding: "utf8" });
    expect(service.status).toBe(0);
    expect(service.stdout).toContain(
      `Environment=PATH=${prefix}:/usr/local/bin:/usr/bin:/bin`,
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
