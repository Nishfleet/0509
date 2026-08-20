import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// `codex-node-checks` runs the vitest suite on the shared self-hosted
// vps-verify runner. Vitest 4.1.x hardcodes the forks-worker startup budget
// (90s ready / 60s handshake, vitest-dev/vitest#8968, fixed upstream by
// raising it from 5s/10s in #9027 but never made configurable), and the suite
// forks a fresh worker per test file, so a load spike can intermittently kill
// the CI Test step with "[vitest-pool]: Timeout starting forks runner." —
// a transient infra failure, not a verdict on the code. `ci-vitest-run.sh`
// retries exactly once, and only on that signature. These specs lock in the
// boundary so the retry can never mask a real test failure.
const script = resolve("scripts/ci-vitest-run.sh");
const scratchDirs: string[] = [];
const liveChildren = new Set<ChildProcess>();

function scratchDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "0509-ci-vitest-run-"));
  scratchDirs.push(directory);
  return directory;
}

/**
 * Build a fake suite command: it records each invocation in a counter file,
 * prints `firstOutput` and exits `firstExit` on the first run, then prints
 * `retryOutput` and exits `retryExit` on any later run. This lets specs assert
 * how many attempts the wrapper made and which exit code it propagated.
 */
function fakeSuite(options: {
  firstOutput: string;
  firstExit: number;
  retryOutput?: string;
  retryExit?: number;
}): { scriptPath: string; counterPath: string } {
  // A transient startup timeout clears on retry by default: the second
  // attempt passes unless the spec explicitly makes it fail again.
  const retryOutput = options.retryOutput ?? "ok";
  const retryExit = options.retryExit ?? 0;
  const directory = scratchDir();
  const counterPath = join(directory, "invocations");
  const scriptPath = join(directory, "fake-suite.sh");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env sh
set -u
count_file="$1"
n=0
[ -f "$count_file" ] && n=$(cat "$count_file")
n=$((n + 1))
printf '%s\\n' "$n" > "$count_file"
if [ "$n" -eq 1 ]; then
  printf '%s\\n' '${options.firstOutput}'
  exit ${options.firstExit}
fi
printf '%s\\n' '${retryOutput}'
exit ${retryExit}
`,
    "utf8",
  );
  return { scriptPath, counterPath };
}

function runScript(args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(script, args, { stdio: ["ignore", "pipe", "pipe"] });
    liveChildren.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      liveChildren.delete(child);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

function invocations(counterPath: string): number {
  try {
    return Number(readFileSync(counterPath, "utf8"));
  } catch {
    return 0;
  }
}

afterEach(() => {
  for (const child of liveChildren) {
    child.kill("SIGKILL");
  }
  liveChildren.clear();
  for (const directory of scratchDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ci-vitest-run retry wrapper", () => {
  it("retries once when the first attempt dies on the forks-worker startup timeout", async () => {
    const fake = fakeSuite({
      firstOutput: "Error: [vitest-pool]: Timeout starting forks runner.",
      firstExit: 5,
    });
    const result = await runScript(["sh", fake.scriptPath, fake.counterPath]);

    expect(result.code).toBe(0);
    expect(invocations(fake.counterPath)).toBe(2);
    expect(result.stderr).toContain("hit the vitest forks-worker startup timeout");
    expect(result.stderr).toContain("retry passed");
  });

  it("retries once on the 60s handshake timeout surface", async () => {
    const fake = fakeSuite({
      firstOutput:
        "Error: [vitest-pool]: Failed to start forks worker for test files tests/a.test.ts.",
      firstExit: 7,
    });
    const result = await runScript(["sh", fake.scriptPath, fake.counterPath]);

    expect(result.code).toBe(0);
    expect(invocations(fake.counterPath)).toBe(2);
  });

  it("retries once on the pool-runner handshake signature", async () => {
    const fake = fakeSuite({
      firstOutput:
        "Error: [vitest-pool-runner]: Timeout waiting for worker to respond",
      firstExit: 7,
    });
    const result = await runScript(["sh", fake.scriptPath, fake.counterPath]);

    expect(result.code).toBe(0);
    expect(invocations(fake.counterPath)).toBe(2);
  });

  it("retries at most once and propagates the retry exit code", async () => {
    const fake = fakeSuite({
      firstOutput: "Error: [vitest-pool]: Timeout starting forks runner.",
      firstExit: 5,
      retryOutput: "Error: [vitest-pool]: Timeout starting forks runner.",
      retryExit: 9,
    });
    const result = await runScript(["sh", fake.scriptPath, fake.counterPath]);

    expect(result.code).toBe(9);
    expect(invocations(fake.counterPath)).toBe(2);
  });

  it("does not retry on an assertion failure", async () => {
    const fake = fakeSuite({
      firstOutput: "AssertionError: expected 1 to deeply equal 2",
      firstExit: 1,
    });
    const result = await runScript(["sh", fake.scriptPath, fake.counterPath]);

    expect(result.code).toBe(1);
    expect(invocations(fake.counterPath)).toBe(1);
    expect(result.stderr).toContain("not a worker startup timeout; not retrying");
  });

  it("does not retry on a worker runtime crash", async () => {
    const fake = fakeSuite({
      firstOutput:
        "Error: [vitest-pool]: Worker forks emitted error. ReferenceError: x is not defined",
      firstExit: 2,
    });
    const result = await runScript(["sh", fake.scriptPath, fake.counterPath]);

    expect(result.code).toBe(2);
    expect(invocations(fake.counterPath)).toBe(1);
  });

  it("preserves the original exit code when the first attempt passes", async () => {
    const fake = fakeSuite({ firstOutput: "suite output", firstExit: 0 });
    const result = await runScript(["sh", fake.scriptPath, fake.counterPath]);

    expect(result.code).toBe(0);
    expect(invocations(fake.counterPath)).toBe(1);
    expect(result.stdout).toContain("suite output");
  });

  it("defaults the suite command to the raw vitest run command", () => {
    const source = readFileSync(script, "utf8");
    expect(source).toContain("command=(vitest run --configLoader runner)");
  });

  it("accepts an explicit `--` separator before the command", async () => {
    const fake = fakeSuite({
      firstOutput: "Error: [vitest-pool]: Timeout starting forks runner.",
      firstExit: 4,
    });
    const result = await runScript([
      "--",
      "sh",
      fake.scriptPath,
      fake.counterPath,
    ]);

    expect(result.code).toBe(0);
    expect(invocations(fake.counterPath)).toBe(2);
  });
});
