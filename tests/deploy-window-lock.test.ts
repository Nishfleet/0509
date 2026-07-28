import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/deploy-window-lock.sh");
const hasRequiredTools =
  spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("setsid", ["--version"], { stdio: "ignore" }).status === 0 &&
  existsSync("/proc/self/stat");

const scratchDirs: string[] = [];
const liveChildren = new Set<ChildProcess>();

function scratchLock(): string {
  const directory = mkdtempSync(join(tmpdir(), "0509-deploy-window-"));
  scratchDirs.push(directory);
  return join(directory, "window.lock");
}

function envFor(
  lockFile: string,
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    "GITHUB_ENV",
    "DEPLOY_WINDOW_RELEASE_TOKEN",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_JOB",
  ]) {
    delete env[name];
  }

  return {
    ...env,
    DEPLOY_WINDOW_LOCK_FILE: lockFile,
    DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.4",
    DEPLOY_WINDOW_HOLD_CAP: "10",
    DEPLOY_WINDOW_POLL_INTERVAL: "0.02",
    DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.default`,
    ...overrides,
  };
}

function run(
  lockFile: string,
  command: "acquire" | "release",
  overrides: Record<string, string> = {},
) {
  return spawnSync(script, [command], {
    encoding: "utf8",
    env: envFor(lockFile, overrides),
    timeout: 3_000,
  });
}

function spawnScript(
  lockFile: string,
  args: string[],
  overrides: Record<string, string> = {},
): ChildProcess {
  const child = spawn(script, args, {
    env: envFor(lockFile, overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
  return child;
}

function completed(child: ChildProcess): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for deploy-window test state");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}

function probeIsFree(lockFile: string): boolean {
  return spawnSync("flock", ["--exclusive", "--nonblock", lockFile, "true"]).status === 0;
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

describe.skipIf(!hasRequiredTools)("deploy-window lock protocol", () => {
  it("acquires and releases a proven holder", () => {
    const lockFile = scratchLock();

    const acquired = run(lockFile, "acquire");
    expect(acquired.status, acquired.stderr).toBe(0);
    expect(acquired.stdout).toContain("deploy window acquired");
    expect(probeIsFree(lockFile)).toBe(false);

    const released = run(lockFile, "release");
    expect(released.status, released.stderr).toBe(0);
    expect(released.stdout).toContain("deploy window released");
    expect(probeIsFree(lockFile)).toBe(true);
  });

  it("blocks run -- while acquire holds the window", async () => {
    const lockFile = scratchLock();
    const marker = `${lockFile}.ran`;
    expect(run(lockFile, "acquire").status).toBe(0);

    const lane = spawnScript(
      lockFile,
      ["run", "--", "bash", "-c", 'printf "ran" >"$1"', "lane", marker],
      { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "1" },
    );
    const laneResult = completed(lane);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    expect(lane.exitCode).toBeNull();
    expect(existsSync(marker)).toBe(false);

    expect(run(lockFile, "release").status).toBe(0);
    expect((await laneResult).code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran");
  });

  it("fails acquire after its timeout behind an unregistered lane", async () => {
    const lockFile = scratchLock();
    const lane = spawn("flock", ["--exclusive", lockFile, "sleep", "2"], {
      stdio: "ignore",
    });
    liveChildren.add(lane);
    lane.once("exit", () => liveChildren.delete(lane));
    await waitFor(() => !probeIsFree(lockFile));

    const acquired = run(lockFile, "acquire", {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.2",
    });
    expect(acquired.status).toBe(1);
    expect(acquired.stderr).toContain("gave up after 0.2s");
    expect(probeIsFree(lockFile)).toBe(false);
  });

  it("does not clobber or wedge the true owner on double acquire", () => {
    const lockFile = scratchLock();
    const firstCaller = {
      DEPLOY_WINDOW_CALLER_ID: "vitest-first",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.first`,
    };
    const secondCaller = {
      DEPLOY_WINDOW_CALLER_ID: "vitest-second",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.second`,
    };
    expect(run(lockFile, "acquire", firstCaller).status).toBe(0);
    const ownerBefore = readFileSync(`${lockFile}.held`, "utf8");
    const trueOwnerPid = ownerBefore.split(" ")[0];

    const second = run(lockFile, "acquire", secondCaller);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain(`proven owner PID ${trueOwnerPid}`);
    expect(readFileSync(`${lockFile}.held`, "utf8")).toBe(ownerBefore);
    expect(() => process.kill(Number(trueOwnerPid), 0)).not.toThrow();

    const secondRelease = run(lockFile, "release", secondCaller);
    expect(secondRelease.status).toBe(0);
    expect(secondRelease.stdout).toContain("has no successful-acquire capability");
    expect(readFileSync(`${lockFile}.held`, "utf8")).toBe(ownerBefore);
    expect(() => process.kill(Number(trueOwnerPid), 0)).not.toThrow();
    expect(probeIsFree(lockFile)).toBe(false);

    expect(run(lockFile, "release", firstCaller).status).toBe(0);
    expect(probeIsFree(lockFile)).toBe(true);
    expect(run(lockFile, "acquire", firstCaller).status).toBe(0);
    expect(run(lockFile, "release", firstCaller).status).toBe(0);
  });

  it("fails instead of succeeding after its registered holder is killed", async () => {
    const lockFile = scratchLock();
    const acquire = spawnScript(lockFile, ["acquire"], {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "1",
      DEPLOY_WINDOW_POLL_INTERVAL: "0.2",
    });
    const acquireResult = completed(acquire);
    await waitFor(() => existsSync(`${lockFile}.held`));

    const holderPid = Number(readFileSync(`${lockFile}.held`, "utf8").split(" ")[0]);
    process.kill(holderPid, "SIGKILL");

    const result = await acquireResult;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("died or lost its flock");
    expect(existsSync(`${lockFile}.held`)).toBe(false);
    expect(probeIsFree(lockFile)).toBe(true);
  });
});
