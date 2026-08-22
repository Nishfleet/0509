import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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

// The default ceiling is deliberately generous: it is a safety net against a
// hung child, never the assertion. Correctness is asserted afterwards via the
// state transitions the test cares about (markers, queue tickets, flock
// probes). A tight ceiling would turn machine load into a false failure.
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for deploy-window test state");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}

// A verification queue ticket is the script's deterministic "this lane is
// waiting for a slot" signal: it is created at enqueue time and removed only
// when the lane claims a slot and starts running. Tickets match
// <20-digit-sequence>.<pid>.<process-start>.
function hasQueueTicket(queueDir: string): boolean {
  if (!existsSync(queueDir)) {
    return false;
  }
  try {
    return readdirSync(queueDir).some((entry) =>
      /^\d{20}\.\d+\.\d+$/u.test(entry),
    );
  } catch {
    return false;
  }
}

// Deterministic "lane is parked, not running" check. `parked` is a state
// signal that becomes true only once the lane has provably entered the
// waiting protocol (queue ticket enqueued, or verification slot held), so
// the wait is on the state transition the test cares about, with a generous
// safety-net ceiling rather than a load assertion. The settle afterwards is
// a detection window for a wrongly-admitted lane (one whose marker appears):
// a broken admission manifests within a few script steps of the parked
// signal, far inside this window, and a slow machine only makes it manifest
// later — never invisible — so this check cannot false-fail under load.
async function expectLaneParked(
  parked: () => boolean,
  marker: string,
): Promise<void> {
  await waitFor(() => parked() || existsSync(marker));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  expect(existsSync(marker)).toBe(false);
}

// Liveness is judged by /proc identity, mirroring the script's own
// process_identity_is_live() (start time + non-zombie state). kill -0 is
// deliberately avoided: it is unreliable across distinct runner UIDs
// (EPERM on a live peer) and this file's first spec locks that choice in.
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  const start = readProcField(pid, 22);
  const state = readProcField(pid, 3);
  return start !== "" && state !== "" && state !== "Z";
}

function readProcField(pid: number, field: number): string {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.indexOf(")") + 2).split(" ");
    return fields[field - 3] ?? "";
  } catch {
    return "";
  }
}

// Marker files are created by the child's shell redirection before the PID is
// written, so existence alone can race an empty (or partial) read. Reading
// "0" would make process.kill(0, ...) probe the caller's own process group.
// Wait for a complete positive PID before treating the marker as authoritative.
async function readPidWhenWritten(marker: string): Promise<number> {
  let pid = 0;
  await waitFor(() => {
    try {
      pid = Number(readFileSync(marker, "utf8"));
    } catch {
      return false;
    }
    return Number.isInteger(pid) && pid > 0;
  });
  return pid;
}

// Cleanup must never signal a process group that is no longer ours. Once the
// lane-holder reaps the cancelled command its PID is free, and under CI process
// churn the kernel can reuse that exact PID as the leader of a brand-new group
// (e.g. the slot-reuse replacement lane) before this finally block runs. A
// blind kill(-pid, SIGKILL) then kills the wrong process and fails an unrelated
// spec. Only signal when a live member of the original group still exists.
function killOwnedProcessGroup(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  // A dead-but-unreaped zombie still holds its PGID; a live descendant (e.g. an
  // in-flight `sleep` of the stubborn loop) may also remain. Both are still our
  // group. If no /proc entry claims the PGID, the group is gone: signalling the
  // now-free PID could hit a reused group, so skip.
  if (!processGroupHasMember(pid)) {
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The cancellation path may have reaped the group in between.
  }
}

function processGroupHasMember(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.indexOf(")") + 2).split(" ");
    // Field 5 is the process group id (fields are offset by 3 in this parse).
    const pgid = Number(fields[5 - 3]);
    if (!Number.isInteger(pgid) || pgid !== pid) {
      // The command is no longer (or never was) a group leader.
      return false;
    }
  } catch {
    return false;
  }
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/u.test(entry)) {
        continue;
      }
      let stat: string;
      try {
        stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      } catch {
        continue;
      }
      const fields = stat.slice(stat.indexOf(")") + 2).split(" ");
      if (Number(fields[5 - 3]) === pid) {
        return true;
      }
    }
  } catch {
    // If /proc is unreadable, fall back to signalling: the group either exists
    // (we reap it) or is gone (kill fails harmlessly).
    return true;
  }
  return false;
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
  it("uses shared proc identity instead of cross-user signal permission for liveness", () => {
    const source = readFileSync(script, "utf8");
    const liveness = source.slice(
      source.indexOf("process_identity_is_live()"),
      source.indexOf("\n}\n", source.indexOf("process_identity_is_live()")) + 3,
    );
    expect(liveness).toContain('process_start_time "$pid"');
    expect(liveness).toContain('process_state "$pid"');
    expect(liveness).not.toContain('kill -0 "$pid"');
  });

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
      // The budget is not under test here (timeout-exit behavior has its own
      // spec below). It only has to outlast the parked-detection settle plus
      // the release step, so the lane still runs after the window opens.
      { DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "10" },
    );
    const laneResult = completed(lane);
    // While acquire holds the window, the lane must park holding a
    // verification slot but stay blocked on the shared gate.
    await expectLaneParked(() => !slotIsFree(lockFile, 1), marker);
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
    // With all three slots held, the fourth lane must park with a queue
    // ticket and never write its marker until a slot frees.
    await expectLaneParked(
      () => hasQueueTicket(`${verifyRoot}/queue`),
      fourthMarker,
    );
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

  it("admits waiting lanes FIFO and removes a killed waiter's stale ticket", async () => {
    const lockFile = scratchLock();
    const overrides = {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
      DEPLOY_WINDOW_VERIFY_SLOTS: "1",
      DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
      DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
    };
    const firstMarker = `${lockFile}.fifo-first`;
    const firstStop = `${firstMarker}.stop`;
    const secondMarker = `${lockFile}.fifo-second`;
    const secondStop = `${secondMarker}.stop`;
    const thirdMarker = `${lockFile}.fifo-third`;
    const thirdStop = `${thirdMarker}.stop`;
    const waitingCommand = (marker: string, stop: string) => [
      "run",
      "--",
      "bash",
      "-c",
      'printf "started" >"$1"; while [ ! -e "$2" ]; do sleep 0.01; done',
      "lane",
      marker,
      stop,
    ];

    const first = spawnScript(lockFile, waitingCommand(firstMarker, firstStop), overrides);
    const firstResult = completed(first);
    await waitFor(() => existsSync(firstMarker));
    const second = spawnScript(lockFile, waitingCommand(secondMarker, secondStop), overrides);
    const secondResult = completed(second);
    const queueDir = `${overrides.DEPLOY_WINDOW_VERIFY_ROOT}/queue`;
    await waitFor(
      () =>
        existsSync(queueDir) &&
        readdirSync(queueDir).filter((entry) => /^\d{20}\.\d+\.\d+$/u.test(entry))
          .length === 1,
    );
    const third = spawnScript(lockFile, waitingCommand(thirdMarker, thirdStop), overrides);
    const thirdResult = completed(third);
    await waitFor(
      () =>
        existsSync(queueDir) &&
        readdirSync(queueDir).filter((entry) => /^\d{20}\.\d+\.\d+$/u.test(entry))
          .length === 2,
    );

    writeFileSync(firstStop, "");
    expect((await firstResult).code).toBe(0);
    await waitFor(() => existsSync(secondMarker));
    expect(existsSync(thirdMarker)).toBe(false);

    writeFileSync(secondStop, "");
    expect((await secondResult).code).toBe(0);
    await waitFor(() => existsSync(thirdMarker));
    writeFileSync(thirdStop, "");
    expect((await thirdResult).code).toBe(0);

    const blockerMarker = `${lockFile}.recovery-blocker`;
    const blockerStop = `${blockerMarker}.stop`;
    const blocker = spawnScript(
      lockFile,
      waitingCommand(blockerMarker, blockerStop),
      overrides,
    );
    const blockerResult = completed(blocker);
    await waitFor(() => existsSync(blockerMarker));
    const killedWaiter = spawnScript(
      lockFile,
      ["run", "--", "bash", "-c", "exit 0"],
      overrides,
    );
    await waitFor(
      () =>
        readdirSync(queueDir).some((entry) => /^\d{20}\.\d+\.\d+$/u.test(entry)),
    );
    killedWaiter.kill("SIGKILL");
    const recoveredMarker = `${lockFile}.recovered-after-stale-ticket`;
    const recovered = spawnScript(
      lockFile,
      ["run", "--", "bash", "-c", 'printf "ok" >"$1"', "lane", recoveredMarker],
      overrides,
    );
    const recoveredResult = completed(recovered);

    writeFileSync(blockerStop, "");
    expect((await blockerResult).code).toBe(0);
    expect((await recoveredResult).code).toBe(0);
    expect(readFileSync(recoveredMarker, "utf8")).toBe("ok");
  });

  it("repairs a corrupted queue counter instead of permanently wedging lanes", () => {
    const lockFile = scratchLock();
    const verifyRoot = `${lockFile}.verify`;
    const queueDir = `${verifyRoot}/queue`;
    mkdirSync(queueDir, { recursive: true });
    writeFileSync(`${queueDir}/next-ticket`, "not-a-ticket\n");

    const result = spawnSync(
      script,
      ["run", "--", "bash", "-c", "true"],
      {
        encoding: "utf8",
        env: envFor(lockFile, {
          DEPLOY_WINDOW_VERIFY_ROOT: verifyRoot,
          DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
        }),
        timeout: 3_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(`${queueDir}/next-ticket`, "utf8")).toMatch(
      /^[0-9]{20}\n$/u,
    );
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
    // Behind the legacy exclusive holder, the lane must park holding a
    // verification slot but stay blocked on the shared gate.
    await expectLaneParked(() => !slotIsFree(lockFile, 1), marker);
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
    const childPid = await readPidWhenWritten(childPidFile);
    try {
      expect(Number.isInteger(childPid)).toBe(true);
      expect(() => process.kill(childPid, 0)).not.toThrow();
      expect(probeIsFree(lockFile)).toBe(true);
    } finally {
      // The lane holder already detached this child; only kill it if it still
      // claims the PID (PID 0 would target our own process group).
      killOwnedProcessGroup(childPid);
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
      commandPid = await readPidWhenWritten(marker);
      expect(() => process.kill(commandPid, 0)).not.toThrow();

      lane.kill("SIGTERM");
      expect((await laneResult).code).toBe(143);
      await waitFor(
        () =>
          probeIsFree(lockFile) && slotIsFree(lockFile, 1) && !pidAlive(commandPid),
      );
    } finally {
      // The PID is free for reuse once the lane-holder reaps the cancelled
      // group; under CI churn the kernel can hand the same PID to a brand-new
      // group. Guard the cleanup so we never signal someone else's session.
      killOwnedProcessGroup(commandPid);
    }
  });

  it("bounds cancellation of a TERM-ignoring command and immediately reuses its slot", async () => {
    const lockFile = scratchLock();
    const marker = `${lockFile}.stubborn-command`;
    const nextMarker = `${lockFile}.slot-reused`;
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
        DEPLOY_WINDOW_VERIFY_SLOTS: "1",
        DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
        DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
      },
    );
    const laneResult = completed(lane);

    try {
      commandPid = await readPidWhenWritten(marker);
      lane.kill("SIGTERM");
      const result = await Promise.race([
        laneResult,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("stubborn command was not killed")), 3_000),
        ),
      ]);
      expect(result.code).toBe(143);
      await waitFor(
        () =>
          probeIsFree(lockFile) &&
          slotIsFree(lockFile, 1) &&
          !pidAlive(commandPid),
      );

      const replacement = spawnScript(
        lockFile,
        ["run", "--", "bash", "-c", 'printf "reused" >"$1"', "lane", nextMarker],
        {
          DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "0.5",
          DEPLOY_WINDOW_VERIFY_SLOTS: "1",
          DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
          DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
        },
      );
      expect((await completed(replacement)).code).toBe(0);
      expect(readFileSync(nextMarker, "utf8")).toBe("reused");
    } finally {
      // The slot-reuse replacement lane is the most likely candidate to
      // inherit the freed PID; only signal if the original group still owns
      // it.
      killOwnedProcessGroup(commandPid);
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
      childPid = await readPidWhenWritten(childPidFile);
      expect(() => process.kill(childPid, 0)).not.toThrow();

      lane.kill("SIGTERM");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      expect(probeIsFree(lockFile)).toBe(false);

      expect((await laneResult).code).toBe(143);
      await waitFor(
        () =>
          probeIsFree(lockFile) && slotIsFree(lockFile, 1) && !pidAlive(childPid),
      );
      expect(() => process.kill(childPid, 0)).toThrow();
    } finally {
      // Reuse-safe: the lane holder reaps the cancelled group before this
      // runs, and the freed PGID may already belong to a fresh lane.
      killOwnedProcessGroup(childPid);
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
    // While the deploy acquire drains, the fourth lane must stay parked
    // (ticket enqueued, no marker) even after a slot frees.
    await expectLaneParked(
      () => hasQueueTicket(`${overrides.DEPLOY_WINDOW_VERIFY_ROOT}/queue`),
      fourthMarker,
    );

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

  it("keeps release capability private instead of publishing it to GITHUB_ENV", () => {
    const lockFile = scratchLock();
    const githubEnv = `${lockFile}.github-env`;
    const capability = `${lockFile}.private-capability`;
    writeFileSync(githubEnv, "UNCHANGED=1\n");

    const acquired = run(lockFile, "acquire", {
      GITHUB_ENV: githubEnv,
      DEPLOY_WINDOW_CAPABILITY_FILE: capability,
    });
    expect(acquired.status, acquired.stderr).toBe(0);
    expect(readFileSync(githubEnv, "utf8")).toBe("UNCHANGED=1\n");
    expect(statSync(capability).mode & 0o777).toBe(0o600);
    expect(readFileSync(githubEnv, "utf8")).not.toContain("DEPLOY_WINDOW");

    expect(
      run(lockFile, "release", {
        GITHUB_ENV: githubEnv,
        DEPLOY_WINDOW_CAPABILITY_FILE: capability,
      }).status,
    ).toBe(0);
  });

  it("routes reordered and short protected flock forms, but denies unsupported protected forms", () => {
    const lockFile = scratchLock();
    const routedMarker = `${lockFile}.reordered`;
    const shortMarker = `${lockFile}.short`;
    const commonEnv = envFor(lockFile, {
      DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
      DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
      FLOCK_COMPAT_REAL: realFlock,
      FLOCK_COMPAT_LOCK_FILE: lockFile,
    });

    const reordered = spawnSync(
      flockCompat,
      [
        "--wait=2",
        "--exclusive",
        lockFile,
        "bash",
        "-c",
        'printf "routed" >"$1"',
        "lane",
        routedMarker,
      ],
      { encoding: "utf8", env: commonEnv },
    );
    expect(reordered.status, reordered.stderr).toBe(0);
    expect(readFileSync(routedMarker, "utf8")).toBe("routed");

    const short = spawnSync(
      flockCompat,
      [
        "-x",
        "-w",
        "2",
        lockFile,
        "bash",
        "-c",
        'printf "short" >"$1"',
        "lane",
        shortMarker,
      ],
      { encoding: "utf8", env: commonEnv },
    );
    expect(short.status, short.stderr).toBe(0);
    expect(readFileSync(shortMarker, "utf8")).toBe("short");

    const denied = spawnSync(
      flockCompat,
      ["--exclusive", "--nonblock", lockFile, "bash", "-c", "exit 0"],
      { encoding: "utf8", env: commonEnv },
    );
    expect(denied.status).toBe(64);
    expect(denied.stderr).toContain("unsupported protected lock invocation");
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
    expect(readFileSync(`${lockFile}.held`, "utf8")).toBe("");
    expect(probeIsFree(lockFile)).toBe(true);
  });

  it("drops heredoc stdin for backgrounded run lanes but keeps argv scripts", () => {
    const lockFile = scratchLock();
    const verifyRoot = `${lockFile}.verify`;
    const verifyTmp = `${lockFile}.tmp`;
    const marker = `${lockFile}.argv-marker`;
    const laneEnv = {
      DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
      DEPLOY_WINDOW_VERIFY_ROOT: verifyRoot,
      DEPLOY_WINDOW_VERIFY_TMP_ROOT: verifyTmp,
    };

    const heredoc = spawnSync(
      "bash",
      [
        "-c",
        `${script} run -- bash -euo pipefail <<'EOF'
printf 'heredoc-body\\n' >"$1"
EOF`,
        "probe",
        marker,
      ],
      {
        encoding: "utf8",
        env: envFor(lockFile, laneEnv),
        timeout: 5_000,
      },
    );
    expect(heredoc.status, heredoc.stderr).toBe(0);
    expect(existsSync(marker)).toBe(false);

    const argv = spawnSync(
      script,
      [
        "run",
        "--",
        "bash",
        "-c",
        'printf "argv-body\\n" >"$1"',
        "probe",
        marker,
      ],
      {
        encoding: "utf8",
        env: envFor(lockFile, laneEnv),
        timeout: 5_000,
      },
    );
    expect(argv.status, argv.stderr).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("argv-body\n");
  });

  it("persists RESTORE_EVIDENCE_ARCHIVE written by an argv lane for the parent step", () => {
    const lockFile = scratchLock();
    const archive = `${lockFile}.restore-evidence.tar.gz`;
    const result = spawnSync(
      script,
      [
        "run",
        "--",
        "bash",
        "-c",
        'mkdir -p "$(dirname -- "$RESTORE_EVIDENCE_ARCHIVE")" && printf "packed\\n" >"$RESTORE_EVIDENCE_ARCHIVE"',
      ],
      {
        encoding: "utf8",
        env: envFor(lockFile, {
          DEPLOY_WINDOW_ACQUIRE_TIMEOUT: "2",
          DEPLOY_WINDOW_VERIFY_ROOT: `${lockFile}.verify`,
          DEPLOY_WINDOW_VERIFY_TMP_ROOT: `${lockFile}.tmp`,
          RESTORE_EVIDENCE_ARCHIVE: archive,
        }),
        timeout: 5_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(archive, "utf8")).toBe("packed\n");
  });
});
