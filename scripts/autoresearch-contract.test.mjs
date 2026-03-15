import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const benchmarkScriptPath = path.join(repoRoot, "autoresearch.sh");
const checksScriptPath = path.join(repoRoot, "autoresearch.checks.sh");

function shellNodeCommand(code) {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`;
}

function runBashScript(scriptPath, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

test("autoresearch.sh emits a single METRIC line for successful builds", async () => {
  const result = await runBashScript(benchmarkScriptPath, {
    AUTORESEARCH_BUILD_COMMAND: shellNodeCommand(
      "setTimeout(() => console.log('build ok'), 20)",
    ),
  });

  assert.equal(result.exitCode, 0, result.stderr);

  const metricLines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("METRIC "));

  assert.equal(metricLines.length, 1, result.stdout);

  const match = metricLines[0]?.match(/^METRIC next_build_duration_sec=(-?\d+(?:\.\d+)?)$/);
  assert.ok(match, metricLines[0]);
  assert.ok(Number(match[1]) >= 0, metricLines[0]);
});

test("autoresearch.sh exits non-zero when the build command fails", async () => {
  const result = await runBashScript(benchmarkScriptPath, {
    AUTORESEARCH_BUILD_COMMAND: shellNodeCommand("process.exit(7)"),
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout.includes("METRIC "), false, result.stdout);
});

test("autoresearch.sh installs dependencies when the dependency marker is missing", async () => {
  const markerDir = ".tmp-autoresearch-deps";
  await rm(path.join(repoRoot, markerDir), { recursive: true, force: true });

  const result = await runBashScript(benchmarkScriptPath, {
    AUTORESEARCH_DEPENDENCY_MARKER_DIR: markerDir,
    AUTORESEARCH_INSTALL_COMMAND: shellNodeCommand(
      "require('node:fs').mkdirSync('.tmp-autoresearch-deps', { recursive: true })",
    ),
    AUTORESEARCH_BUILD_COMMAND: shellNodeCommand(
      "const fs = require('node:fs'); process.exit(fs.existsSync('.tmp-autoresearch-deps') ? 0 : 11)",
    ),
  });

  assert.equal(result.exitCode, 0, result.stderr);
  await stat(path.join(repoRoot, markerDir));
  await rm(path.join(repoRoot, markerDir), { recursive: true, force: true });
});

test("autoresearch.checks.sh exits zero when checks pass", async () => {
  const result = await runBashScript(checksScriptPath, {
    AUTORESEARCH_CHECKS_COMMAND: shellNodeCommand("console.log('checks ok')"),
  });

  assert.equal(result.exitCode, 0, result.stderr);
});

test("autoresearch.checks.sh exits non-zero when checks fail", async () => {
  const result = await runBashScript(checksScriptPath, {
    AUTORESEARCH_CHECKS_COMMAND: shellNodeCommand("process.exit(9)"),
  });

  assert.notEqual(result.exitCode, 0);
});
