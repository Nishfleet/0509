import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  const lockFile = join(directory, "window.lock");
  mkdirSync(`${lockFile}.verify`);
  return lockFile;
}

function slotFile(lockFile: string, slot: number): string {
  return `${lockFile}.verify/slot-${slot}.lock`;
}

function rolloutSlotFile(lockFile: string, slot: number): string {
  const stem = lockFile.endsWith(".lock")
    ? lockFile.slice(0, -".lock".length)
    : lockFile;
  return `${stem}.slot${slot}`;
}

function ownerFile(lockFile: string, slot: number): string {
  return `${slotFile(lockFile, slot)}.held`;
}

function poolSizeFile(lockFile: string): string {
  const stem = lockFile.endsWith(".lock")
    ? lockFile.slice(0, -".lock".length)
    : lockFile;
  return `${stem}.slots`;
}

function drainIntentFile(lockFile: string): string {
  const stem = lockFile.endsWith(".lock")
    ? lockFile.slice(0, -".lock".length)
    : lockFile;
  return `${stem}.draining`;
}

function drainIntentMetaLockFile(lockFile: string): string {
  return `${drainIntentFile(lockFile)}.meta.lock`;
}

function childPids(pid: number): number[] {
  let children = "";
  try {
    children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8");
  } catch {
    return [];
  }
  return children.trim().split(/\s+/u).filter(Boolean).map(Number);
}

function processName(pid: number): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return undefined;
  }
}

function markerSlot(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  const value = readFileSync(path, "utf8").trim().split("|")[0] ?? "";
  return /^\d+$/u.test(value) ? Number(value) : undefined;
}

function currentProcessStart(): string {
  const stat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
  const fields = stat
    .slice(stat.lastIndexOf(") ") + 2)
    .trim()
    .split(/\s+/u);
  return fields[19]!;
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
    "DEPLOY_WINDOW_CANCEL_GRACE",
    "DEPLOY_WINDOW_SLOTS",
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

function probeIsFree(lockFile: string, slot = 1): boolean {
  return (
    spawnSync("flock", [
      "--exclusive",
      "--nonblock",
      slotFile(lockFile, slot),
      "true",
    ]).status === 0
  );
}

function probePoolIsFree(lockFile: string, slots = 3): boolean {
  return Array.from({ length: slots }, (_, index) =>
    probeIsFree(lockFile, index + 1),
  ).every(Boolean);
}

function legacyGateIsFree(lockFile: string): boolean {
  return (
    spawnSync("flock", ["--exclusive", "--nonblock", lockFile, "true"])
      .status === 0
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
    expect(
      Array.from({ length: 3 }, (_, index) => probeIsFree(lockFile, index + 1)),
    ).toEqual([false, false, false]);

    const released = run(lockFile, "release");
    expect(released.status, released.stderr).toBe(0);
    expect(released.stdout).toContain("deploy window released");
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("does not leak unrelated descriptors into the detached holder", async () => {
    const lockFile = scratchLock();
    const caller = {
      DEPLOY_WINDOW_CALLER_ID: "vitest-inherited-fd",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.inherited-fd`,
    };
    const child = spawn(script, ["acquire"], {
      env: envFor(lockFile, caller),
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    liveChildren.add(child);
    child.once("exit", () => liveChildren.delete(child));
    const result = completed(child);
    let unrelatedPipeClosed = false;
    child.stdio[3]?.once("close", () => {
      unrelatedPipeClosed = true;
    });

    try {
      await waitFor(() => child.exitCode !== null);
      await waitFor(() => unrelatedPipeClosed, 300);
      expect((await result).code).toBe(0);
    } finally {
      expect(run(lockFile, "release", caller).status).toBe(0);
      await result;
    }

    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("rejects a slot-count change after the pool is initialized", () => {
    const lockFile = scratchLock();
    writeFileSync(`${poolSizeFile(lockFile)}.tmp.orphan`, "");
    const initialized = spawnSync(script, ["run", "--", "true"], {
      encoding: "utf8",
      env: envFor(lockFile, { DEPLOY_WINDOW_SLOTS: "3" }),
    });
    expect(initialized.status, initialized.stderr).toBe(0);
    expect(readFileSync(poolSizeFile(lockFile), "utf8")).toBe("3\n");

    const mismatched = spawnSync(script, ["run", "--", "true"], {
      encoding: "utf8",
      env: envFor(lockFile, { DEPLOY_WINDOW_SLOTS: "4" }),
    });
    expect(mismatched.status).toBe(64);
    expect(mismatched.stderr).toContain("pool was initialized with 3 slots");
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("fails closed when the pool-size destination is a directory", () => {
    const lockFile = scratchLock();
    const destination = poolSizeFile(lockFile);
    mkdirSync(destination);

    const result = spawnSync(script, ["run", "--", "true"], {
      encoding: "utf8",
      env: envFor(lockFile),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("failed to initialize");
    expect(readdirSync(destination)).toEqual([]);
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("preserves the caller umask on first-run pool initialization", () => {
    const lockFile = scratchLock();
    const marker = `${lockFile}.umask`;
    const expected = spawnSync("bash", ["-c", "umask"], {
      encoding: "utf8",
    }).stdout.trim();

    const firstRun = spawnSync(
      script,
      ["run", "--", "bash", "-c", 'umask >"$1"', "wrapped-command", marker],
      { encoding: "utf8", env: envFor(lockFile) },
    );
    expect(firstRun.status, firstRun.stderr).toBe(0);
    expect(readFileSync(marker, "utf8").trim()).toBe(expected);
  });

  it("recovers an orphaned drain intent after serializing deploy acquirers", () => {
    const lockFile = scratchLock();
    writeFileSync(drainIntentFile(lockFile), "partial-intent\n");

    const acquired = run(lockFile, "acquire");
    expect(acquired.status, acquired.stderr).toBe(0);
    expect(existsSync(drainIntentFile(lockFile))).toBe(false);
    expect(run(lockFile, "release").status).toBe(0);
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("bounds drain-intent polling by the remaining run timeout", () => {
    const lockFile = scratchLock();
    writeFileSync(
      drainIntentFile(lockFile),
      `${process.pid} ${currentProcessStart()} verifier caller\n`,
    );

    const startedAt = Date.now();
    const blocked = spawnSync(script, ["run", "--", "true"], {
      encoding: "utf8",
      env: envFor(lockFile, {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.1",
        DEPLOY_WINDOW_POLL_INTERVAL: "10",
      }),
      timeout: 1_000,
    });
    expect(blocked.status).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(blocked.stderr).toContain("waiting for lane admission");
  });

  it("bounds drain-intent metadata contention by the run timeout", async () => {
    const lockFile = scratchLock();
    const metadataStop = `${lockFile}.metadata-stop`;
    const blocker = spawn(
      "flock",
      [
        "--exclusive",
        drainIntentMetaLockFile(lockFile),
        "bash",
        "-c",
        'while [ ! -e "$1" ]; do sleep 0.01; done',
        "metadata-blocker",
        metadataStop,
      ],
      { stdio: "ignore" },
    );
    const blockerResult = completed(blocker);
    liveChildren.add(blocker);
    blocker.once("exit", () => liveChildren.delete(blocker));
    await waitFor(
      () =>
        spawnSync("flock", [
          "--exclusive",
          "--nonblock",
          drainIntentMetaLockFile(lockFile),
          "true",
        ]).status !== 0,
    );

    const startedAt = Date.now();
    const blocked = spawnSync(script, ["run", "--", "true"], {
      encoding: "utf8",
      env: envFor(lockFile, { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.1" }),
      timeout: 1_000,
    });
    expect(blocked.status).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(blocked.stderr).toContain("waiting for lane admission");

    writeFileSync(metadataStop, "");
    expect((await blockerResult).code).toBe(0);
  });

  it("bounds deploy intent metadata contention by the acquire timeout", async () => {
    const lockFile = scratchLock();
    const metadataStop = `${lockFile}.deploy-metadata-stop`;
    const blocker = spawn(
      "flock",
      [
        "--exclusive",
        drainIntentMetaLockFile(lockFile),
        "bash",
        "-c",
        'while [ ! -e "$1" ]; do sleep 0.01; done',
        "metadata-blocker",
        metadataStop,
      ],
      { stdio: "ignore" },
    );
    const blockerResult = completed(blocker);
    liveChildren.add(blocker);
    blocker.once("exit", () => liveChildren.delete(blocker));
    await waitFor(
      () =>
        spawnSync("flock", [
          "--exclusive",
          "--nonblock",
          drainIntentMetaLockFile(lockFile),
          "true",
        ]).status !== 0,
    );

    const startedAt = Date.now();
    const blocked = spawnSync(script, ["acquire"], {
      encoding: "utf8",
      env: envFor(lockFile, { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.1" }),
      timeout: 1_000,
    });
    expect(blocked.status).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(blocked.stderr).toContain("gave up after 0.1s");

    writeFileSync(metadataStop, "");
    expect((await blockerResult).code).toBe(0);
  });

  it("stays excluded by a pre-pool client during rollout", async () => {
    const lockFile = scratchLock();
    const legacyStop = `${lockFile}.legacy-stop`;
    const legacy = spawn(
      "flock",
      [
        "--exclusive",
        lockFile,
        "bash",
        "-c",
        'while [ ! -e "$1" ]; do sleep 0.01; done',
        "legacy",
        legacyStop,
      ],
      { stdio: "ignore" },
    );
    const legacyResult = completed(legacy);
    liveChildren.add(legacy);
    legacy.once("exit", () => liveChildren.delete(legacy));
    await waitFor(
      () =>
        spawnSync("flock", ["--exclusive", "--nonblock", lockFile, "true"])
          .status !== 0,
    );

    const marker = `${lockFile}.new-client`;
    const newClient = spawnScript(
      lockFile,
      ["run", "--", "bash", "-c", 'printf "ran" >"$1"', "lane", marker],
      { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2" },
    );
    const newClientResult = completed(newClient);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    expect(newClient.exitCode).toBeNull();
    expect(existsSync(marker)).toBe(false);

    writeFileSync(legacyStop, "");
    expect((await legacyResult).code).toBe(0);
    expect((await newClientResult).code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran");
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("does not over-admit while previous slot-path lanes drain", async () => {
    const lockFile = scratchLock();
    const blockers = [1, 2, 3].map((slot) => {
      const stop = `${lockFile}.rollout-slot-${slot}.stop`;
      const child = spawn(
        "flock",
        [
          "--exclusive",
          rolloutSlotFile(lockFile, slot),
          "bash",
          "-c",
          'while [ ! -e "$1" ]; do sleep 0.01; done',
          "old-lane",
          stop,
        ],
        { stdio: "ignore" },
      );
      liveChildren.add(child);
      child.once("exit", () => liveChildren.delete(child));
      return { result: completed(child), stop };
    });
    await waitFor(() =>
      [1, 2, 3].every(
        (slot) =>
          spawnSync("flock", [
            "--exclusive",
            "--nonblock",
            rolloutSlotFile(lockFile, slot),
            "true",
          ]).status !== 0,
      ),
    );

    const marker = `${lockFile}.new-generation`;
    const lane = spawnScript(
      lockFile,
      ["run", "--", "bash", "-c", 'printf "ran" >"$1"', "lane", marker],
      { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.2" },
    );
    const laneResult = await completed(lane);
    expect(laneResult.code).toBe(1);
    expect(laneResult.stderr).toContain("waiting for slot");
    expect(existsSync(marker)).toBe(false);

    for (const blocker of blockers) {
      writeFileSync(blocker.stop, "");
    }
    expect(
      (await Promise.all(blockers.map(({ result }) => result))).every(
        ({ code }) => code === 0,
      ),
    ).toBe(true);
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

  it("runs three isolated lanes while a fourth waits for its selected slot", async () => {
    const lockFile = scratchLock();
    const tmpRoot = `${lockFile}.tmp`;
    const command = [
      "run",
      "--",
      "bash",
      "-c",
      'printf "%s|%s|%s|%s" "$DEPLOY_WINDOW_SLOT" "$DEPLOY_WINDOW_VERIFY_SLOT" "$TMPDIR" "$E2E_BASE_URL" >"$1"; while [ ! -e "$2" ]; do sleep 0.01; done',
      "lane",
    ];
    const lanes = Array.from({ length: 3 }, (_, index) => {
      const marker = `${lockFile}.lane-${index + 1}`;
      const stop = `${marker}.stop`;
      const child = spawnScript(lockFile, [...command, marker, stop], {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
        DEPLOY_WINDOW_VERIFY_TMP_ROOT: tmpRoot,
      });
      return { child, marker, result: completed(child), stop };
    });

    await waitFor(() =>
      lanes.every(({ marker }) => markerSlot(marker) !== undefined),
    );
    const occupiedSlots = lanes.map(({ marker }) => markerSlot(marker)!);
    expect(new Set(occupiedSlots)).toEqual(new Set([1, 2, 3]));
    const activeDetails = lanes.map(({ marker }) =>
      readFileSync(marker, "utf8").split("|"),
    );
    expect(
      activeDetails.every(([slot, verifySlot]) => slot === verifySlot),
    ).toBe(true);
    expect(new Set(activeDetails.map(([, , tmp]) => tmp)).size).toBe(3);
    expect(new Set(activeDetails.map(([, , , baseUrl]) => baseUrl))).toEqual(
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
      {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
        DEPLOY_WINDOW_VERIFY_TMP_ROOT: tmpRoot,
      },
    );
    const fourthResult = completed(fourth);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    expect(fourth.exitCode).toBeNull();
    expect(existsSync(fourthMarker)).toBe(false);

    expect(fourth.pid).toBeDefined();
    const selectedSlot = (fourth.pid! % 3) + 1;
    const selectedLane = lanes.find(
      ({ marker }) => markerSlot(marker) === selectedSlot,
    );
    expect(selectedLane).toBeDefined();
    writeFileSync(selectedLane!.stop, "");
    await waitFor(() => markerSlot(fourthMarker) !== undefined);
    expect(markerSlot(fourthMarker)).toBe(selectedSlot);

    for (const lane of lanes) {
      writeFileSync(lane.stop, "");
    }
    writeFileSync(fourthStop, "");
    expect((await fourthResult).code).toBe(0);
    expect(
      (await Promise.all(lanes.map(({ result }) => result))).every(
        ({ code }) => code === 0,
      ),
    ).toBe(true);
    const allTmpDirs = [...lanes.map(({ marker }) => marker), fourthMarker].map(
      (marker) => readFileSync(marker, "utf8").split("|")[2]!,
    );
    expect(new Set(allTmpDirs).size).toBe(4);
    expect(allTmpDirs.every((path) => path.startsWith(tmpRoot))).toBe(true);
    expect(allTmpDirs.every((path) => !existsSync(path))).toBe(true);
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("drains all three lanes for deploy acquire and excludes new lanes", async () => {
    const lockFile = scratchLock();
    const laneCommand = [
      "run",
      "--",
      "bash",
      "-c",
      'printf "%s" "$DEPLOY_WINDOW_SLOT" >"$1"; while [ ! -e "$2" ]; do sleep 0.01; done',
      "lane",
    ];
    const lanes = Array.from({ length: 3 }, (_, index) => {
      const marker = `${lockFile}.drain-${index + 1}`;
      const stop = `${marker}.stop`;
      const child = spawnScript(lockFile, [...laneCommand, marker, stop], {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
      });
      return { child, marker, result: completed(child), stop };
    });
    await waitFor(() =>
      lanes.every(({ marker }) => markerSlot(marker) !== undefined),
    );

    const deployOverrides = {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
      DEPLOY_WINDOW_CALLER_ID: "vitest-deploy-drain",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.deploy`,
    };
    const deploy = spawnScript(lockFile, ["acquire"], deployOverrides);
    const deployResult = completed(deploy);
    await waitFor(() => existsSync(drainIntentFile(lockFile)));
    expect(deploy.exitCode).toBeNull();
    expect(existsSync(deployOverrides.DEPLOY_WINDOW_CAPABILITY_FILE)).toBe(
      false,
    );

    const excludedMarker = `${lockFile}.excluded`;
    const excluded = spawnScript(
      lockFile,
      ["run", "--", "bash", "-c", 'printf "ran" >"$1"', "lane", excludedMarker],
      { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2" },
    );
    const excludedResult = completed(excluded);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    expect(excluded.exitCode).toBeNull();
    expect(existsSync(excludedMarker)).toBe(false);

    for (const slot of [1, 2]) {
      const lane = lanes.find(({ marker }) => markerSlot(marker) === slot);
      expect(lane).toBeDefined();
      writeFileSync(lane!.stop, "");
      await lane!.result;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      expect(deploy.exitCode).toBeNull();
      expect(existsSync(deployOverrides.DEPLOY_WINDOW_CAPABILITY_FILE)).toBe(
        false,
      );
      expect(existsSync(excludedMarker)).toBe(false);
    }

    const thirdLane = lanes.find(({ marker }) => markerSlot(marker) === 3);
    expect(thirdLane).toBeDefined();
    writeFileSync(thirdLane!.stop, "");
    await thirdLane!.result;
    const acquired = await deployResult;
    expect(acquired.code, acquired.stderr).toBe(0);
    expect(existsSync(deployOverrides.DEPLOY_WINDOW_CAPABILITY_FILE)).toBe(
      true,
    );
    expect(excluded.exitCode).toBeNull();
    expect(existsSync(excludedMarker)).toBe(false);

    expect(run(lockFile, "release", deployOverrides).status).toBe(0);
    expect((await excludedResult).code).toBe(0);
    expect(readFileSync(excludedMarker, "utf8")).toBe("ran");
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("keeps concurrent all-slot acquirers deadlock-free through one ascending order", async () => {
    const lockFile = scratchLock();
    const firstCaller = {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "1",
      DEPLOY_WINDOW_CALLER_ID: "vitest-ordered-first",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.ordered-first`,
    };
    const secondCaller = {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "1",
      DEPLOY_WINDOW_CALLER_ID: "vitest-ordered-second",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.ordered-second`,
    };
    const first = spawnScript(lockFile, ["acquire"], firstCaller);
    const second = spawnScript(lockFile, ["acquire"], secondCaller);
    const results = await Promise.all([completed(first), completed(second)]);

    expect(results.map(({ code }) => code).sort()).toEqual([0, 1]);
    const winner = results[0]?.code === 0 ? firstCaller : secondCaller;
    const loser = results[0]?.code === 0 ? results[1] : results[0];
    expect(loser?.stderr).toMatch(
      /proven owner PID|gave up after 1s while draining/u,
    );
    expect(run(lockFile, "release", winner).status).toBe(0);
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("pins the all-slot holder to ascending acquisition order", () => {
    const source = readFileSync(script, "utf8");

    expect(source).toContain(
      "for ((slot = 1; slot <= slot_count; slot += 1)); do\n" +
        '      slot_file="${verify_root}/slot-${slot}.lock"\n' +
        '      exec {slot_fd}>"$slot_file"',
    );
  });

  it("fails acquire after its timeout behind an unregistered lane", async () => {
    const lockFile = scratchLock();
    const lane = spawn(
      "flock",
      ["--exclusive", slotFile(lockFile, 1), "sleep", "2"],
      {
        stdio: "ignore",
      },
    );
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

  it("cleans every stale slot record in one fail-safe acquire", () => {
    const lockFile = scratchLock();
    for (const slot of [1, 2, 3]) {
      writeFileSync(
        ownerFile(lockFile, slot),
        `999999999 1 stale-verifier stale-caller\n`,
      );
    }

    const cleaned = run(lockFile, "acquire");
    expect(cleaned.status).toBe(1);
    expect(cleaned.stderr).toContain("removed 3 stale slot owner record(s)");
    expect(
      [1, 2, 3].map((slot) => existsSync(ownerFile(lockFile, slot))),
    ).toEqual([false, false, false]);

    expect(run(lockFile, "acquire").status).toBe(0);
    expect(run(lockFile, "release").status).toBe(0);
  });

  it("uses one acquire timeout while draining multiple busy slots", async () => {
    const lockFile = scratchLock();
    const blockers = [1, 2].map((slot) => {
      const stop = `${lockFile}.deadline-${slot}.stop`;
      const child = spawn(
        "flock",
        [
          "--exclusive",
          slotFile(lockFile, slot),
          "bash",
          "-c",
          'while [ ! -e "$1" ]; do sleep 0.01; done',
          "blocker",
          stop,
        ],
        { stdio: "ignore" },
      );
      liveChildren.add(child);
      child.once("exit", () => liveChildren.delete(child));
      return { child, result: completed(child), stop };
    });
    await waitFor(() => !probeIsFree(lockFile, 1) && !probeIsFree(lockFile, 2));

    const acquire = spawnScript(lockFile, ["acquire"], {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.4",
    });
    const acquireResult = completed(acquire);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 220));
    writeFileSync(blockers[0]!.stop, "");
    expect((await blockers[0]!.result).code).toBe(0);

    const result = await acquireResult;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("gave up after 0.4s");
    const source = readFileSync(script, "utf8");
    const deadlineDefinition = source.indexOf(
      'acquire_deadline="$(awk -v now="$(date +%s.%N)" -v timeout="$ACQUIRE_TIMEOUT"',
    );
    const holderSpawn = source.indexOf("setsid bash -c '");
    expect(deadlineDefinition).toBeGreaterThan(-1);
    expect(deadlineDefinition).toBeLessThan(holderSpawn);
    expect(source).toContain(
      '\' holder "$VERIFY_ROOT" "$LOCK_FILE" "$ADMISSION_LOCK_FILE" "$SLOT_COUNT" "$acquire_deadline"',
    );
    expect(source).not.toContain(
      'acquire_deadline="$(awk -v now="$(date +%s.%N)" -v timeout="$acquire_timeout"',
    );

    writeFileSync(blockers[1]!.stop, "");
    expect((await blockers[1]!.result).code).toBe(0);
    await waitFor(() => probePoolIsFree(lockFile));
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
    const ownerBefore = readFileSync(ownerFile(lockFile, 1), "utf8");
    const trueOwnerPid = ownerBefore.split(" ")[0];

    const second = run(lockFile, "acquire", secondCaller);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain(`proven owner PID ${trueOwnerPid}`);
    expect(readFileSync(ownerFile(lockFile, 1), "utf8")).toBe(ownerBefore);
    expect(() => process.kill(Number(trueOwnerPid), 0)).not.toThrow();

    const secondRelease = run(lockFile, "release", secondCaller);
    expect(secondRelease.status).toBe(0);
    expect(secondRelease.stdout).toContain(
      "has no successful-acquire capability",
    );
    expect(readFileSync(ownerFile(lockFile, 1), "utf8")).toBe(ownerBefore);
    expect(() => process.kill(Number(trueOwnerPid), 0)).not.toThrow();
    expect(probePoolIsFree(lockFile)).toBe(false);

    expect(run(lockFile, "release", firstCaller).status).toBe(0);
    expect(probePoolIsFree(lockFile)).toBe(true);
    expect(run(lockFile, "acquire", firstCaller).status).toBe(0);
    expect(run(lockFile, "release", firstCaller).status).toBe(0);
  });

  it("refuses to signal a live holder when one capability record is absent", () => {
    const lockFile = scratchLock();
    const caller = {
      DEPLOY_WINDOW_CALLER_ID: "vitest-partial-record",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.partial-record`,
    };
    expect(run(lockFile, "acquire", caller).status).toBe(0);
    const ownerRecord = readFileSync(ownerFile(lockFile, 1), "utf8");
    const holderPid = Number(ownerRecord.split(" ")[0]);
    rmSync(ownerFile(lockFile, 2));

    const refused = run(lockFile, "release", caller);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("owns only 2/3 slot records");
    expect(() => process.kill(holderPid, 0)).not.toThrow();
    expect(probePoolIsFree(lockFile)).toBe(false);

    writeFileSync(ownerFile(lockFile, 2), ownerRecord);
    expect(run(lockFile, "release", caller).status).toBe(0);
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("fails instead of succeeding after its registered holder is killed", async () => {
    const lockFile = scratchLock();
    const acquire = spawnScript(lockFile, ["acquire"], {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "1",
      DEPLOY_WINDOW_POLL_INTERVAL: "0.2",
    });
    const acquireResult = completed(acquire);
    await waitFor(() =>
      Array.from({ length: 3 }, (_, index) =>
        existsSync(ownerFile(lockFile, index + 1)),
      ).every(Boolean),
    );

    const holderPid = Number(
      readFileSync(ownerFile(lockFile, 1), "utf8").split(" ")[0],
    );
    process.kill(holderPid, "SIGKILL");

    const result = await acquireResult;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("died or lost slot");
    expect(
      Array.from({ length: 3 }, (_, index) =>
        existsSync(ownerFile(lockFile, index + 1)),
      ),
    ).toEqual([false, false, false]);
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("does not leak an acquired slot when its holder dies waiting for the next slot", async () => {
    const lockFile = scratchLock();
    const blockerStop = `${lockFile}.blocker-stop`;
    const blockingLane = spawn(
      "flock",
      [
        "--exclusive",
        slotFile(lockFile, 2),
        "bash",
        "-c",
        'while [ ! -e "$1" ]; do sleep 0.01; done',
        "blocker",
        blockerStop,
      ],
      { stdio: "ignore" },
    );
    const blockingResult = completed(blockingLane);
    liveChildren.add(blockingLane);
    blockingLane.once("exit", () => liveChildren.delete(blockingLane));
    await waitFor(() => !probeIsFree(lockFile, 2));

    const acquire = spawnScript(lockFile, ["acquire"], {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "1",
    });
    const acquireResult = completed(acquire);
    await waitFor(() => !probeIsFree(lockFile, 1));
    await waitFor(() => childPids(acquire.pid!).length === 1);

    const [holderPid] = childPids(acquire.pid!);
    expect(holderPid).toBeDefined();
    process.kill(holderPid!, "SIGKILL");

    const result = await acquireResult;
    expect(result.code).toBe(1);
    expect(probeIsFree(lockFile, 1)).toBe(true);
    expect(probeIsFree(lockFile, 2)).toBe(false);

    writeFileSync(blockerStop, "");
    expect((await blockingResult).code).toBe(0);
    await waitFor(() => probePoolIsFree(lockFile));
  });

  it("does not leak pool slots from a killed cleanup metadata waiter", async () => {
    const lockFile = scratchLock();
    const caller = {
      DEPLOY_WINDOW_CALLER_ID: "vitest-cleanup-metadata",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.cleanup-metadata`,
    };
    expect(run(lockFile, "acquire", caller).status).toBe(0);
    const holderPid = Number(
      readFileSync(ownerFile(lockFile, 1), "utf8").split(" ")[0],
    );
    const [sleeperPid] = childPids(holderPid);
    expect(sleeperPid).toBeDefined();

    const blockerStop = `${lockFile}.metadata-blocker-stop`;
    const metadataBlocker = spawn(
      "flock",
      [
        "--exclusive",
        `${slotFile(lockFile, 1)}.meta.lock`,
        "bash",
        "-c",
        'while [ ! -e "$1" ]; do sleep 0.01; done',
        "metadata-blocker",
        blockerStop,
      ],
      { stdio: "ignore" },
    );
    const blockerResult = completed(metadataBlocker);
    liveChildren.add(metadataBlocker);
    metadataBlocker.once("exit", () => liveChildren.delete(metadataBlocker));
    await waitFor(
      () =>
        spawnSync("flock", [
          "--exclusive",
          "--nonblock",
          `${slotFile(lockFile, 1)}.meta.lock`,
          "true",
        ]).status !== 0,
    );

    process.kill(holderPid, "SIGTERM");
    await waitFor(() => {
      const children = childPids(holderPid);
      return (
        !children.includes(sleeperPid!) &&
        children.some((pid) => processName(pid) === "flock")
      );
    });
    process.kill(holderPid, "SIGKILL");
    await waitFor(() => probePoolIsFree(lockFile));

    writeFileSync(blockerStop, "");
    expect((await blockerResult).code).toBe(0);
  });

  it("bounds all-slot release metadata waits by the acquire timeout", async () => {
    const lockFile = scratchLock();
    const caller = {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.1",
      DEPLOY_WINDOW_CALLER_ID: "vitest-release-metadata-timeout",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.release-timeout`,
    };
    expect(run(lockFile, "acquire", caller).status).toBe(0);

    const blockerStop = `${lockFile}.release-metadata-stop`;
    const blocker = spawn(
      "flock",
      [
        "--exclusive",
        `${slotFile(lockFile, 1)}.meta.lock`,
        "bash",
        "-c",
        'while [ ! -e "$1" ]; do sleep 0.01; done',
        "metadata-blocker",
        blockerStop,
      ],
      { stdio: "ignore" },
    );
    const blockerResult = completed(blocker);
    liveChildren.add(blocker);
    blocker.once("exit", () => liveChildren.delete(blocker));
    await waitFor(
      () =>
        spawnSync("flock", [
          "--exclusive",
          "--nonblock",
          `${slotFile(lockFile, 1)}.meta.lock`,
          "true",
        ]).status !== 0,
    );

    const startedAt = Date.now();
    const blockedRelease = run(lockFile, "release", caller);
    expect(blockedRelease.status).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(blockedRelease.stderr).toContain(
      "gave up after 0.1s waiting to verify release metadata",
    );
    expect(probePoolIsFree(lockFile)).toBe(false);

    writeFileSync(blockerStop, "");
    expect((await blockerResult).code).toBe(0);
    expect(run(lockFile, "release", caller).status).toBe(0);
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("releases despite invalid inherited verification settings", () => {
    const lockFile = scratchLock();
    expect(run(lockFile, "acquire").status).toBe(0);

    const released = run(lockFile, "release", {
      DEPLOY_WINDOW_VERIFY_PORT_BASE: "bogus",
      DEPLOY_WINDOW_VERIFY_SLOTS: "bogus",
    });

    expect(released.status, released.stderr).toBe(0);
    expect(released.stdout).toContain("deploy window released");
    expect(probePoolIsFree(lockFile)).toBe(true);
  });

  it("does not let background descendants retain pool locks", async () => {
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
      { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2" },
    );

    const result = await completed(lane);
    expect(result.code, result.stderr).toBe(0);
    const childPid = Number(readFileSync(childPidFile, "utf8"));
    try {
      expect(Number.isInteger(childPid)).toBe(true);
      expect(() => process.kill(childPid, 0)).not.toThrow();
      expect(legacyGateIsFree(lockFile)).toBe(true);
      expect(probePoolIsFree(lockFile)).toBe(true);
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

  it("forwards cancellation and reaps the slot-holding command group", async () => {
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
      { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2" },
    );
    const laneResult = completed(lane);

    try {
      await waitFor(() => existsSync(marker));
      commandPid = Number(readFileSync(marker, "utf8"));
      expect(() => process.kill(commandPid, 0)).not.toThrow();

      lane.kill("SIGTERM");
      expect((await laneResult).code).toBe(143);
      await waitFor(
        () => legacyGateIsFree(lockFile) && probePoolIsFree(lockFile),
      );
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

  it("escalates cancellation when the command ignores SIGTERM", async () => {
    const lockFile = scratchLock();
    const marker = `${lockFile}.term-ignoring-command`;
    let commandPid = 0;
    const lane = spawnScript(
      lockFile,
      [
        "run",
        "--",
        "bash",
        "-c",
        'trap "" TERM; printf "%s" "$$" >"$1"; while :; do sleep 1; done',
        "lane",
        marker,
      ],
      {
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
        DEPLOY_WINDOW_CANCEL_GRACE: "0.1",
      },
    );
    const laneResult = completed(lane);

    try {
      await waitFor(() => existsSync(marker));
      commandPid = Number(readFileSync(marker, "utf8"));
      lane.kill("SIGTERM");
      const outcome = await Promise.race([
        laneResult,
        new Promise<"timed-out">((resolvePromise) =>
          setTimeout(() => resolvePromise("timed-out"), 1_000),
        ),
      ]);
      expect(outcome).not.toBe("timed-out");
      expect(outcome).toMatchObject({ code: 143 });
      await waitFor(() => probePoolIsFree(lockFile));
      expect(() => process.kill(commandPid, 0)).toThrow();
    } finally {
      if (Number.isInteger(commandPid) && commandPid > 0) {
        try {
          process.kill(-commandPid, "SIGKILL");
        } catch {
          // The escalation path should already have reaped the group.
        }
      }
    }
  });

  it("keeps the slot held if the outer run wrapper is SIGKILLed", async () => {
    const lockFile = scratchLock();
    const marker = `${lockFile}.sigkill-command`;
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
      { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2" },
    );
    const laneResult = completed(lane);

    try {
      await waitFor(() => existsSync(marker));
      commandPid = Number(readFileSync(marker, "utf8"));
      lane.kill("SIGKILL");
      await waitFor(() => lane.exitCode !== null || lane.signalCode !== null);
      expect(lane.signalCode).toBe("SIGKILL");
      expect(() => process.kill(commandPid, 0)).not.toThrow();
      expect(probePoolIsFree(lockFile)).toBe(false);
    } finally {
      if (Number.isInteger(commandPid) && commandPid > 0) {
        try {
          process.kill(-commandPid, "SIGKILL");
        } catch {
          // The command may have already exited.
        }
      }
      await waitFor(() => probePoolIsFree(lockFile));
      await laneResult;
    }
  });

  it("keeps a lane locked until its detached D1 provider child stops", async () => {
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
      { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2" },
    );
    const laneResult = completed(lane);
    let childPid = 0;

    try {
      await waitFor(() => existsSync(childPidFile));
      childPid = Number(readFileSync(childPidFile, "utf8"));
      expect(() => process.kill(childPid, 0)).not.toThrow();

      lane.kill("SIGTERM");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      expect(probePoolIsFree(lockFile)).toBe(false);

      expect((await laneResult).code).toBe(143);
      await waitFor(() => probePoolIsFree(lockFile));
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

  it("routes legacy exact-lock commands into an isolated pool slot", () => {
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
          DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
          FLOCK_COMPAT_REAL: realFlock,
          FLOCK_COMPAT_LOCK_FILE: lockFile,
        }),
      },
    );

    expect(routed.status, routed.stderr).toBe(0);
    expect(readFileSync(marker, "utf8")).toMatch(/^[1-3]\|.+\.tmp\//u);
  });

  it("preserves wrapped stdout for flock-compatible callers", () => {
    const lockFile = scratchLock();
    const routed = spawnSync(
      flockCompat,
      [
        "--exclusive",
        "--wait",
        "2",
        lockFile,
        "bash",
        "-c",
        "printf '{\"ok\":true}'",
      ],
      {
        encoding: "utf8",
        env: envFor(lockFile, {
          FLOCK_COMPAT_REAL: realFlock,
          FLOCK_COMPAT_LOCK_FILE: lockFile,
        }),
      },
    );

    expect(routed.status, routed.stderr).toBe(0);
    expect(routed.stdout).toBe('{"ok":true}');
  });

  it("rejects an invalid release timeout without dropping ownership", () => {
    const lockFile = scratchLock();
    const caller = {
      DEPLOY_WINDOW_CALLER_ID: "vitest-invalid-release-timeout",
      DEPLOY_WINDOW_CAPABILITY_FILE: `${lockFile}.cap.invalid-timeout`,
    };
    expect(run(lockFile, "acquire", caller).status).toBe(0);

    try {
      const invalid = run(lockFile, "release", {
        ...caller,
        DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "bogus",
      });
      expect(invalid.status).toBe(64);
      expect(invalid.stderr).toContain(
        "ACQUIRE_TIMEOUT must be a non-negative number",
      );
      expect(probePoolIsFree(lockFile)).toBe(false);
    } finally {
      if (!probePoolIsFree(lockFile)) {
        expect(run(lockFile, "release", caller).status).toBe(0);
      }
    }
  });

  it("keeps ordinary CI checks in the isolated verification pool", () => {
    const workflow = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

    expect(workflow).not.toContain("Acquire deploy window");
    expect(workflow).not.toContain("Release deploy window");
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
});
