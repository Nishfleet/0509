import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { parseTotalUploadKiB } from "../scripts/check-worker-bundle-size.mjs";

const scriptPath = "scripts/check-worker-bundle-size.mjs";
const buildScriptPath = "scripts/build-production.mjs";
const MAX_UPLOAD_KIB = 64 * 1024; // 64 MiB.

let stubBinDir: string;

function runScript(env?: Record<string, string>) {
  return spawnSync("node", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubBinDir}:${process.env.PATH}`,
      ...env,
    },
  });
}

// Runs the production build script with `react-router` and `wrangler` stubbed
// on PATH, so the bundle-size guard's wiring inside build-production.mjs can be
// exercised without a real react-router build or a real wrangler dry-run.
function runBuildProduction(env?: Record<string, string>) {
  return spawnSync("node", [buildScriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubBinDir}:${process.env.PATH}`,
      ...env,
    },
  });
}

function stubWrangler(totalUploadKiB: number) {
  writeFileSync(
    join(stubBinDir, "wrangler"),
    [
      "#!/usr/bin/env bash",
      `printf 'Total Upload: ${totalUploadKiB} KiB / gzip: 1.00 KiB\\n'`,
    ].join("\n"),
    { mode: 0o755 },
  );
}

// File-scoped setup so both describe blocks share one stub bin dir that is only
// removed after every test in the file has run.
beforeAll(() => {
  stubBinDir = mkdtempSync(join(tmpdir(), "bundle-size-stub-"));
  // `react-router` is stubbed to a no-op success so build-production.mjs can
  // reach the post-build bundle-size guard without a real build.
  writeFileSync(
    join(stubBinDir, "react-router"),
    ["#!/usr/bin/env bash", "exit 0"].join("\n"),
    { mode: 0o755 },
  );
});

afterAll(() => {
  if (stubBinDir) rmSync(stubBinDir, { recursive: true, force: true });
});

describe("check-worker-bundle-size.mjs", () => {

  describe("parseTotalUploadKiB", () => {
    it("parses the uncompressed Total Upload from wrangler dry-run output", () => {
      expect(parseTotalUploadKiB("Total Upload: 8561.01 KiB / gzip: 1863.03 KiB")).toBe(
        8561.01,
      );
    });

    it("parses a value at the 64 MiB boundary", () => {
      expect(parseTotalUploadKiB(`Total Upload: ${MAX_UPLOAD_KIB}.00 KiB / gzip: 1.00 KiB`)).toBe(
        MAX_UPLOAD_KIB,
      );
    });

    it("throws when Total Upload is absent from the output", () => {
      expect(() => parseTotalUploadKiB("no size line here")).toThrow(
        /could not find 'Total Upload'/,
      );
    });
  });

  it("passes when the stub wrangler reports a bundle under 64 MiB", () => {
    stubWrangler(8561.01);
    const result = runScript();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("bundle size check passed");
    expect(result.stdout).toContain("8.36 MiB");
  });

  it("fails when the stub wrangler reports a bundle over 64 MiB", () => {
    stubWrangler(MAX_UPLOAD_KIB + 1);
    const result = runScript();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exceeds the 64 MiB uncompressed limit");
  });

  it("fails when wrangler dry-run exits non-zero", () => {
    writeFileSync(
      join(stubBinDir, "wrangler"),
      ["#!/usr/bin/env bash", "exit 1"].join("\n"),
      { mode: 0o755 },
    );
    const result = runScript();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("wrangler dry-run exited non-zero");
  });

  it("fails closed when wrangler output lacks a Total Upload line", () => {
    writeFileSync(
      join(stubBinDir, "wrangler"),
      ["#!/usr/bin/env bash", "echo 'no size line here'"].join("\n"),
      { mode: 0o755 },
    );
    const result = runScript();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("could not find 'Total Upload'");
  });
});

describe("build-production.mjs bundle-size guard wiring", () => {
  // Structural guard: the build script must invoke the bundle-size check after
  // a successful react-router build, so the guard cannot be silently removed.
  it("invokes check-worker-bundle-size.mjs after the react-router build", () => {
    const source = readFileSync(buildScriptPath, "utf8");
    expect(source).toContain("check-worker-bundle-size.mjs");
  });

  it("fails the build when the post-build bundle exceeds 64 MiB", () => {
    stubWrangler(MAX_UPLOAD_KIB + 1);
    const result = runBuildProduction();
    expect(result.status, result.stderr).not.toBe(0);
  });

  it("passes the build when the post-build bundle is under 64 MiB", () => {
    stubWrangler(8561.01);
    const result = runBuildProduction();
    expect(result.status, result.stderr).toBe(0);
  });
});
