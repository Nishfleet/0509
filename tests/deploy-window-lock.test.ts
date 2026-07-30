import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/deploy-window-lock.sh");
const flockCompat = resolve("scripts/flock-compat.sh");
const realFlock = existsSync("/usr/bin/flock")
  ? "/usr/bin/flock"
  : spawnSync("sh", ["-c", "command -v flock"], {
      encoding: "utf8",
    }).stdout.trim();
const hasRequiredTools =
  realFlock.length > 0 &&
  spawnSync(realFlock, ["--version"], { stdio: "ignore" }).status === 0 &&
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
    "E2E_BASE_URL",
    "DEPLOY_WINDOW_VERIFY_PORT_BASE",
    "DEPLOY_WINDOW_VERIFY_ROOT",
    "DEPLOY_WINDOW_VERIFY_SLOTS",
    "DEPLOY_WINDOW_VERIFY_TMP_ROOT",
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
  return (
    spawnSync("flock", ["--exclusive", "--nonblock", lockFile, "true"])
      .status === 0
  );
}

function admissionAllowsShared(lockFile: string): boolean {
  return (
    spawnSync("flock", [
      "--shared",
      "--nonblock",
      `${lockFile}.admission.lock`,
      "true",
    ]).status === 0
  );
}

function slotIsFree(lockFile: string, slot: number): boolean {
  return (
    spawnSync("flock", [
      "--exclusive",
      "--nonblock",
      `${lockFile}.verify/slot-${slot}.lock`,
      "true",
    ]).status === 0
  );
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

  it("releases even when inherited verification settings are invalid", () => {
    const lockFile = scratchLock();

    expect(run(lockFile, "acquire").status).toBe(0);
    const released = run(lockFile, "release", {
      DEPLOY_WINDOW_VERIFY_POLL_INTERVAL: "bogus",
      DEPLOY_WINDOW_VERIFY_PORT_BASE: "bogus",
      DEPLOY_WINDOW_VERIFY_SLOTS: "bogus",
    });

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

  it("runs three isolated verification lanes while a fourth waits", async () => {
    const lockFile = scratchLock();
    const verifyRoot = `${lockFile}.verify`;
    const tmpRoot = `${lockFile}.tmp`;
    const overrides = {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
      DEPLOY_WINDOW_VERIFY_SLOTS: "3",
      DEPLOY_WINDOW_VERIFY_ROOT: verifyRoot,
      DEPLOY_WINDOW_VERIFY_TMP_ROOT: tmpRoot,
    };
    const command = [
      "run",
      "--",
      "bash",
      "-c",
      'printf "%s|%s|%s" "$DEPLOY_WINDOW_VERIFY_SLOT" "$TMPDIR" "$E2E_BASE_URL" >"$1"; while [ ! -e "$2" ]; do sleep 0.01; done',
      "lane",
    ];
    const lanes = Array.from({ length: 3 }, (_, index) => {
      const marker = `${lockFile}.lane-${index + 1}`;
      const stop = `${marker}.stop`;
      const child = spawnScript(
        lockFile,
        [...command, marker, stop],
        overrides,
      );
      return { child, marker, result: completed(child), stop };
    });

    await waitFor(() => lanes.every(({ marker }) => existsSync(marker)));
    const activeDetails = lanes.map(({ marker }) =>
      readFileSync(marker, "utf8").split("|"),
    );
    expect(new Set(activeDetails.map(([slot]) => slot))).toEqual(
      new Set(["1", "2", "3"]),
    );
    expect(new Set(activeDetails.map(([, tmp]) => tmp)).size).toBe(3);
    expect(new Set(activeDetails.map(([, , baseUrl]) => baseUrl))).toEqual(
      new Set([
        "http://127.0.0.1:4191",
        "http://127.0.0.1:4192",
        "http://127.0.0.1:4193",
      ]),
    );

    const fourthMarker = `${lockFile}.lane-4`;
    const fourthStop = `${fourthMarker}.stop`;
    const fourth = spawnScript(
      lockFile,
      [...command, fourthMarker, fourthStop],
      overrides,
    );
    const fourthResult = completed(fourth);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    expect(existsSync(fourthMarker)).toBe(false);
    expect(probeIsFree(lockFile)).toBe(false);

    writeFileSync(lanes[0]!.stop, "");
    expect((await lanes[0]!.result).code).toBe(0);
    await waitFor(() => existsSync(fourthMarker));

    for (const lane of lanes.slice(1)) {
      writeFileSync(lane.stop, "");
    }
    writeFileSync(fourthStop, "");
    const remainingResults = await Promise.all([
      ...lanes.slice(1).map(({ result }) => result),
      fourthResult,
    ]);
    expect(remainingResults.every(({ code }) => code === 0)).toBe(true);

    const allDetails = [
      ...activeDetails,
      readFileSync(fourthMarker, "utf8").split("|"),
    ];
    const tmpDirs = allDetails.map(([, tmp]) => tmp!);
    expect(new Set(tmpDirs).size).toBe(4);
    for (const path of tmpDirs) {
      expect(path.startsWith(tmpRoot)).toBe(true);
      expect(existsSync(path)).toBe(false);
    }
    expect(probeIsFree(lockFile)).toBe(true);
  });

  it("keeps new verification lanes behind a legacy exclusive holder", async () => {
    const lockFile = scratchLock();
    const legacyReady = `${lockFile}.legacy-ready`;
    const legacyStop = `${lockFile}.legacy-stop`;
    const marker = `${lockFile}.new-lane`;
    const legacy = spawn(
      "flock",
      [
        "--exclusive",
        lockFile,
        "bash",
        "-c",
        'printf "ready" >"$1"; while [ ! -e "$2" ]; do sleep 0.01; done',
        "legacy",
        legacyReady,
        legacyStop,
      ],
      { stdio: "ignore" },
    );
    liveChildren.add(legacy);
    legacy.once("exit", () => liveChildren.delete(legacy));
    await waitFor(() => existsSync(legacyReady));

    const lane = spawnScript(
      lockFile,
      ["run", "--", "bash", "-c", 'printf "ran" >"$1"', "lane", marker],
      {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
        DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
        DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
      },
    );
    const laneResult = completed(lane);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    expect(lane.exitCode).toBeNull();
    expect(existsSync(marker)).toBe(false);

    writeFileSync(legacyStop, "");
    const completedLane = await laneResult;
    expect(completedLane.code, completedLane.stderr).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran");
  });

  it("does not run after the shared deploy-gate budget expires", async () => {
    const lockFile = scratchLock();
    const marker = `${lockFile}.timed-out-lane`;
    const legacy = spawn("flock", ["--exclusive", lockFile, "sleep", "2"], {
      stdio: "ignore",
    });
    liveChildren.add(legacy);
    legacy.once("exit", () => liveChildren.delete(legacy));
    await waitFor(() => !probeIsFree(lockFile));

    const lane = spawnScript(
      lockFile,
      ["run", "--", "bash", "-c", 'printf "ran" >"$1"', "lane", marker],
      {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.2",
        DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
        DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
      },
    );
    const result = await completed(lane);

    expect(result.code).toBe(75);
    expect(result.stderr).toContain(
      "shared deploy gate stayed locked for the 0.2s total acquire budget",
    );
    expect(existsSync(marker)).toBe(false);
  });

  it("does not let background descendants retain lane locks", async () => {
    const lockFile = scratchLock();
    const childPidFile = `${lockFile}.background-pid`;
    const lane = spawnScript(
      lockFile,
      [
        "run",
        "--",
        "bash",
        "-c",
        'sleep 10 </dev/null >/dev/null 2>&1 & printf "%s" "$!" >"$1"',
        "lane",
        childPidFile,
      ],
      {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
        DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
        DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
      },
    );

    const result = await completed(lane);
    expect(result.code, result.stderr).toBe(0);
    const childPid = Number(readFileSync(childPidFile, "utf8"));
    try {
      expect(Number.isInteger(childPid)).toBe(true);
      expect(() => process.kill(childPid, 0)).not.toThrow();
      expect(probeIsFree(lockFile)).toBe(true);
    } finally {
      if (Number.isInteger(childPid)) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // The descendant may have exited after the assertion probe.
        }
      }
    }
  });

  it("forwards cancellation and reaps the lock-holding command group", async () => {
    const lockFile = scratchLock();
    const marker = `${lockFile}.cancelled-command`;
    let commandPid = 0;
    const lane = spawnScript(
      lockFile,
      [
        "run",
        "--",
        "bash",
        "-c",
        'printf "%s" "$$" >"$1"; sleep 30',
        "lane",
        marker,
      ],
      {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
        DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
        DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
      },
    );
    const laneResult = completed(lane);

    try {
      await waitFor(() => existsSync(marker));
      commandPid = Number(readFileSync(marker, "utf8"));
      expect(() => process.kill(commandPid, 0)).not.toThrow();

      lane.kill("SIGTERM");
      expect((await laneResult).code).toBe(143);
      await waitFor(() => probeIsFree(lockFile) && slotIsFree(lockFile, 1));
      expect(() => process.kill(commandPid, 0)).toThrow();
    } finally {
      if (Number.isInteger(commandPid) && commandPid > 0) {
        try {
          process.kill(-commandPid, "SIGKILL");
        } catch {
          // The cancellation path should already have reaped the group.
        }
      }
    }
  });

  it("keeps the lane locked until a detached D1 provider child stops", async () => {
    const lockFile = scratchLock();
    const helper = `${lockFile}.d1-cancel-helper.mjs`;
    const childPidFile = `${lockFile}.d1-provider-pid`;
    const moduleUrl = pathToFileURL(
      resolve("scripts/d1-remote-restore-evidence.mjs"),
    ).href;
    writeFileSync(
      helper,
      [
        `import { runCaptured } from ${JSON.stringify(moduleUrl)};`,
        `await runCaptured(process.execPath, ["-e", ${JSON.stringify(
          [
            'const { writeFileSync } = require("node:fs");',
            "writeFileSync(process.argv[1], String(process.pid));",
            'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 250));',
            "setInterval(() => {}, 1_000);",
          ].join(""),
        )}, process.argv[2]]);`,
      ].join("\n"),
    );

    const lane = spawnScript(
      lockFile,
      ["run", "--", process.execPath, helper, childPidFile],
      {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
        DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
        DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
      },
    );
    const laneResult = completed(lane);
    let childPid = 0;

    try {
      await waitFor(() => existsSync(childPidFile));
      childPid = Number(readFileSync(childPidFile, "utf8"));
      expect(() => process.kill(childPid, 0)).not.toThrow();

      lane.kill("SIGTERM");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      expect(probeIsFree(lockFile)).toBe(false);

      expect((await laneResult).code).toBe(143);
      await waitFor(() => probeIsFree(lockFile) && slotIsFree(lockFile, 1));
      expect(() => process.kill(childPid, 0)).toThrow();
    } finally {
      if (Number.isInteger(childPid) && childPid > 0) {
        try {
          process.kill(-childPid, "SIGKILL");
        } catch {
          // The cancellation path should already have reaped the group.
        }
      }
    }
  });

  it("drains all active verification lanes before deploy acquire", async () => {
    const lockFile = scratchLock();
    const command = [
      "run",
      "--",
      "bash",
      "-c",
      'printf "started" >"$1"; while [ ! -e "$2" ]; do sleep 0.01; done',
      "lane",
    ];
    const overrides = {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
      DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
      DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
    };
    const lanes = Array.from({ length: 3 }, (_, index) => {
      const marker = `${lockFile}.drain-${index + 1}`;
      const stop = `${marker}.stop`;
      const child = spawnScript(
        lockFile,
        [...command, marker, stop],
        overrides,
      );
      return { marker, result: completed(child), stop };
    });
    await waitFor(() => lanes.every(({ marker }) => existsSync(marker)));

    const deployOverrides = {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
      DEPLOY_WINDOW_CALLER_ID: "vitest-deploy-drain",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.deploy`,
    };
    const deploy = spawnScript(lockFile, ["acquire"], deployOverrides);
    const deployResult = completed(deploy);
    await waitFor(() => !admissionAllowsShared(lockFile));
    expect(deploy.exitCode).toBeNull();
    expect(existsSync(deployOverrides.DEPLOY_WINDOW_CAPABILITY_FILE)).toBe(
      false,
    );

    const fourthMarker = `${lockFile}.drain-4`;
    const fourthStop = `${fourthMarker}.stop`;
    const fourth = spawnScript(
      lockFile,
      [...command, fourthMarker, fourthStop],
      overrides,
    );
    const fourthResult = completed(fourth);

    writeFileSync(lanes[0]!.stop, "");
    expect((await lanes[0]!.result).code).toBe(0);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    expect(existsSync(fourthMarker)).toBe(false);

    for (const lane of lanes.slice(1)) {
      writeFileSync(lane.stop, "");
    }
    expect(
      (await Promise.all(lanes.slice(1).map(({ result }) => result))).every(
        ({ code }) => code === 0,
      ),
    ).toBe(true);

    const acquired = await deployResult;
    expect(acquired.code, acquired.stderr).toBe(0);
    expect(existsSync(deployOverrides.DEPLOY_WINDOW_CAPABILITY_FILE)).toBe(
      true,
    );
    expect(existsSync(fourthMarker)).toBe(false);
    expect(run(lockFile, "release", deployOverrides).status).toBe(0);
    await waitFor(() => existsSync(fourthMarker));
    writeFileSync(fourthStop, "");
    expect((await fourthResult).code).toBe(0);
    expect(probeIsFree(lockFile)).toBe(true);
  });

  it("routes legacy exact-lock commands into a verification lane", () => {
    const lockFile = scratchLock();
    const marker = `${lockFile}.compat-marker`;
    const routed = spawnSync(
      flockCompat,
      [
        "--exclusive",
        "--wait",
        "2",
        lockFile,
        "bash",
        "-c",
        'printf "%s|%s" "$DEPLOY_WINDOW_VERIFY_SLOT" "$TMPDIR" >"$1"',
        "lane",
        marker,
      ],
      {
        encoding: "utf8",
        env: envFor(lockFile, {
          DEPLOY_WINDOW_VERIFY_SLOTS: "3",
          DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
          DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
          FLOCK_COMPAT_REAL: realFlock,
          FLOCK_COMPAT_LOCK_FILE: lockFile,
        }),
      },
    );

    expect(routed.status, routed.stderr).toBe(0);
    expect(readFileSync(marker, "utf8")).toMatch(/^\d\|.+\.tmp\//u);
  });

  it("keeps the compat default lock path coupled to the runner", async () => {
    const lockFile = scratchLock();
    const home = resolve(lockFile, "..", "home");
    const defaultLock = join(
      home,
      ".local",
      "state",
      "0509",
      "deploy-window.lock",
    );
    const marker = `${lockFile}.default-route`;
    mkdirSync(resolve(defaultLock, ".."), { recursive: true });
    const legacy = spawn("flock", ["--exclusive", defaultLock, "sleep", "1"], {
      stdio: "ignore",
    });
    liveChildren.add(legacy);
    legacy.once("exit", () => liveChildren.delete(legacy));
    await waitFor(() => !probeIsFree(defaultLock));

    const env = envFor(defaultLock, {
      HOME: home,
      FLOCK_COMPAT_REAL: realFlock,
      FLOCK_COMPAT_VERIFY_RUNNER: script,
      DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
      DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
    });
    delete env.FLOCK_COMPAT_LOCK_FILE;
    delete env.DEPLOY_WINDOW_LOCK_FILE;
    const routed = spawn(
      flockCompat,
      [
        "--exclusive",
        "--wait",
        "2",
        defaultLock,
        "bash",
        "-c",
        'printf "%s" "$DEPLOY_WINDOW_VERIFY_SLOT" >"$1"',
        "lane",
        marker,
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const result = await completed(routed);

    expect(result.code, result.stderr).toBe(0);
    expect(readFileSync(marker, "utf8")).toMatch(/^[1-3]$/u);
  });

  it("passes ordinary flock calls through when HOME is unset", () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FLOCK_COMPAT_REAL: realFlock,
    };
    delete env.HOME;
    delete env.FLOCK_COMPAT_LOCK_FILE;

    const result = spawnSync(flockCompat, ["--version"], {
      encoding: "utf8",
      env,
    });

    expect(result.status, result.stderr).toBe(0);
  });

  it("keeps ordinary CI checks in the bounded verification pool", () => {
    const workflow = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

    expect(workflow).not.toContain("Acquire deploy window");
    expect(workflow).not.toContain("Release deploy window");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("hashFiles('package-lock.json')");
    expect(workflow).toContain(
      "./scripts/deploy-window-lock.sh run -- npm ci --ignore-scripts",
    );
    expect(workflow).toContain(
      "./scripts/deploy-window-lock.sh run -- npm install --ignore-scripts",
    );
    expect(workflow).toContain(
      "run: ./scripts/deploy-window-lock.sh run -- npm run build",
    );
    expect(workflow).toContain(
      "run: ./scripts/deploy-window-lock.sh run -- npm run test",
    );
    expect(workflow).toContain(
      "run: ./scripts/deploy-window-lock.sh run -- npm run typecheck",
    );
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
    expect(secondRelease.stdout).toContain(
      "has no successful-acquire capability",
    );
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

    const holderPid = Number(
      readFileSync(`${lockFile}.held`, "utf8").split(" ")[0],
    );
    process.kill(holderPid, "SIGKILL");

    const result = await acquireResult;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("died or lost its flock");
    expect(existsSync(`${lockFile}.held`)).toBe(false);
    expect(probeIsFree(lockFile)).toBe(true);
  });
});
