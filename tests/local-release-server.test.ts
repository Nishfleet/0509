import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// @ts-ignore JavaScript release-server module is intentionally exercised through Vitest.
const {
  buildLocalReleaseServerCommand,
  buildLocalReleaseServerRetryScript,
  LOCAL_RELEASE_NETWORK_SHIM_PATH,
  LOCAL_RELEASE_SERVER_BOOT_SECONDS,
  LOCAL_RELEASE_SERVER_MAX_ATTEMPTS,
  LOCAL_RELEASE_SERVER_RETRY_DELAY_SECONDS,
  createLocalReleaseServerIdentity,
  isLocalReleaseServerIdentity,
  parseExactLoopbackOrigin,
  reserveLocalReleaseOrigin,
  resolveLocalReleaseRunTimeout,
} = await import("../scripts/local-release-server.mjs");

function runRetryScript(exitCodes: number[], runtimes: number[]) {
  const serverCases = exitCodes
    .map((exitCode, index) => `${index + 1}) printf 'invoke:%s\\n' "$attempt"; return ${exitCode};;`)
    .join(" ");
  const clockEndCommand = `${runtimes
    .map((runtime, index) => `${index === 0 ? "if" : "elif"} [ "$attempt" -eq ${index + 1} ]; then printf '%s' '${runtime}';`)
    .join(" ")} fi`;
  const script = `
server() { case "$attempt" in ${serverCases} esac; }
record_pause() { printf 'pause:%s\\n' "$1"; }
  ${buildLocalReleaseServerRetryScript("server", {
    clockStartCommand: "printf '%s' '0'",
    clockEndCommand,
    pauseCommand: "record_pause 3",
  })}
`;
  return spawnSync("bash", ["-c", script], { encoding: "utf8" });
}

function listenOnLoopback(server: ReturnType<typeof createServer>, port = 0) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("missing_loopback_address"));
      resolve(address.port);
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

let shimFixtureDir: string | undefined;
function writeShimFixture(name: string, body: string) {
  shimFixtureDir ??= mkdtempSync(join(tmpdir(), "local-release-shim-"));
  const file = join(shimFixtureDir, name);
  writeFileSync(file, body, "utf8");
  return file;
}

function runShimHarness(preloadOptions: string, script: string) {
  const nodeOptions = [preloadOptions, `--import ${LOCAL_RELEASE_NETWORK_SHIM_PATH}`]
    .filter(Boolean)
    .join(" ");
  return spawnSync(process.execPath, ["-e", script], {
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    encoding: "utf8",
  });
}

afterAll(() => {
  if (shimFixtureDir) rmSync(shimFixtureDir, { recursive: true, force: true });
});

describe("local release proof server identity", () => {
  it("accepts only an exact unprivileged IPv4 loopback origin", () => {
    expect(parseExactLoopbackOrigin("http://127.0.0.1:4179")).toEqual({
      origin: "http://127.0.0.1:4179",
      port: 4179,
    });
    for (const value of [
      "http://localhost:4179",
      "http://[::1]:4179",
      "https://127.0.0.1:4179",
      "http://127.0.0.1:1",
      "http://127.0.0.1:65536",
      "http://user@127.0.0.1:4179",
      "http://127.0.0.1:4179/path",
      "http://127.0.0.1:4179/?query=1",
      "http://127.0.0.1:4179/#fragment",
    ]) {
      expect(() => parseExactLoopbackOrigin(value)).toThrow("invalid_local_release_origin");
    }
  });

  it("holds one ephemeral port until launch and releases it exactly once", async () => {
    const reservation = await reserveLocalReleaseOrigin();
    expect(parseExactLoopbackOrigin(reservation.origin).port).toBe(reservation.port);

    const occupant = createServer();
    await expect(listenOnLoopback(occupant, reservation.port)).rejects.toMatchObject({ code: "EADDRINUSE" });
    await reservation.release();
    await reservation.release();

    await listenOnLoopback(occupant, reservation.port);
    await closeServer(occupant);
  });

  it("fails before launch on an occupied preferred port or safely reallocates when explicitly allowed", async () => {
    const occupant = createServer();
    const occupiedPort = await listenOnLoopback(occupant);

    await expect(reserveLocalReleaseOrigin({ preferredPort: occupiedPort })).rejects.toThrow(
      "local_release_origin_occupied",
    );
    const reallocated = await reserveLocalReleaseOrigin({
      preferredPort: occupiedPort,
      fallbackToEphemeral: true,
    });
    expect(reallocated.port).not.toBe(occupiedPort);
    await reallocated.release();
    await closeServer(occupant);
  });

  it("creates opaque per-run server identities", () => {
    const first = createLocalReleaseServerIdentity();
    const second = createLocalReleaseServerIdentity();
    expect(isLocalReleaseServerIdentity(first)).toBe(true);
    expect(isLocalReleaseServerIdentity(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(isLocalReleaseServerIdentity("local-static")).toBe(false);
  });

  it("builds one strict-port server command from the exact run origin", () => {
    const command = buildLocalReleaseServerCommand("http://127.0.0.1:43127");
    expect(command).toContain("BETTER_AUTH_URL=http://127.0.0.1:43127");
    expect(command).toContain("APP_ORIGIN=http://127.0.0.1:43127");
    expect(command).toContain("--port 43127 --strictPort");
    expect(command).not.toContain("4179");
  });

  it("retries a fast failure once, then returns a successful server exit", () => {
    const result = runRetryScript([17, 0], [14, 0]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("invoke:1\npause:3\ninvoke:2\n");
    expect(result.stderr).toContain("attempt 1/3");
  });

  it("returns zero immediately without a pause when the first server exits cleanly", () => {
    const result = runRetryScript([0], [0]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("invoke:1\n");
    expect(result.stderr).toBe("");
  });

  it("returns the third fast failure without a final retry log or pause", () => {
    const result = runRetryScript([11, 13, 17], [14, 14, 14]);
    expect(result.status).toBe(17);
    expect(result.stdout).toBe("invoke:1\npause:3\ninvoke:2\npause:3\ninvoke:3\n");
    expect(result.stderr).toContain("attempt 1/3");
    expect(result.stderr).toContain("attempt 2/3");
    expect(result.stderr).not.toContain("attempt 3/3");
  });

  it("retries at 14 seconds but returns immediately at the 15-second threshold", () => {
    const fast = runRetryScript([19, 0], [14, 0]);
    expect(fast.status).toBe(0);
    expect(fast.stdout).toContain("pause:3\n");

    const threshold = runRetryScript([23], [15]);
    expect(threshold.status).toBe(23);
    expect(threshold.stdout).toBe("invoke:1\n");
    expect(threshold.stderr).toBe("");
  });

  it("keeps the public command bounded to three attempts and a 15-second window", () => {
    const command = buildLocalReleaseServerCommand("http://127.0.0.1:43127");
    expect(command).toContain("for attempt in 1 2 3");
    expect(command).toContain(`-ge ${LOCAL_RELEASE_SERVER_BOOT_SECONDS}`);
    expect(command).toContain(`sleep ${LOCAL_RELEASE_SERVER_RETRY_DELAY_SECONDS}`);
    expect(command).toContain(`attempt ${"${attempt}"}/${LOCAL_RELEASE_SERVER_MAX_ATTEMPTS}`);
    expect(LOCAL_RELEASE_SERVER_BOOT_SECONDS).toBe(15);
    expect(LOCAL_RELEASE_SERVER_MAX_ATTEMPTS).toBe(3);
  });

  it("bounds the browser process instead of hiding hangs behind unbounded waits", () => {
    expect(resolveLocalReleaseRunTimeout(undefined)).toBe(600_000);
    expect(resolveLocalReleaseRunTimeout("60000")).toBe(60_000);
    expect(resolveLocalReleaseRunTimeout("1200000")).toBe(1_200_000);
    for (const value of ["0", "59999", "1200001", "not-a-number"]) {
      expect(() => resolveLocalReleaseRunTimeout(value)).toThrow("invalid_local_release_timeout");
    }
  });
});

describe("local release proof network shim contract", () => {
  it("preloads the interface shim on the strict-port server command", () => {
    const command = buildLocalReleaseServerCommand("http://127.0.0.1:43127");
    expect(command).toContain(`NODE_OPTIONS="--import ${LOCAL_RELEASE_NETWORK_SHIM_PATH}`);
    expect(LOCAL_RELEASE_NETWORK_SHIM_PATH.endsWith("scripts/local-release-network-shim.mjs")).toBe(true);
    expect(command).toContain("--host 127.0.0.1 --port 43127 --strictPort");
  });

  it("preserves inherited NODE_OPTIONS flags alongside the shim preload", () => {
    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=2048");
    try {
      const command = buildLocalReleaseServerCommand("http://127.0.0.1:43127");
      expect(command).toContain(
        `NODE_OPTIONS="--import ${LOCAL_RELEASE_NETWORK_SHIM_PATH} --max-old-space-size=2048"`,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns an empty interface map for the uv_interface_addresses EAFNOSUPPORT failure", () => {
    const failingPreload = writeShimFixture(
      "fail-interface-enumeration.cjs",
      `"use strict";
const os = require("node:os");
os.networkInterfaces = () => {
  const error = new Error("uv_interface_addresses returned Unknown system error 97");
  error.code = "EAFNOSUPPORT";
  error.errno = 97;
  error.syscall = "uv_interface_addresses";
  throw error;
};
`,
    );
    const result = runShimHarness(
      `--require ${failingPreload}`,
      "process.stdout.write(JSON.stringify(require('node:os').networkInterfaces()))",
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("{}");
  });

  it("passes through healthy interface enumeration unchanged", () => {
    const healthy = runShimHarness(
      "",
      "process.stdout.write(String(Object.keys(require('node:os').networkInterfaces()).length))",
    );
    const unshimmed = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(String(Object.keys(require('node:os').networkInterfaces()).length))"],
      { encoding: "utf8" },
    );
    expect(healthy.status).toBe(0);
    expect(healthy.stdout.trim()).toBe(unshimmed.stdout.trim());
    expect(Number(healthy.stdout.trim())).toBeGreaterThan(0);
  });

  it("rethrows unrelated interface errors instead of masking them", () => {
    const unrelatedPreload = writeShimFixture(
      "fail-unrelated.cjs",
      `"use strict";
const os = require("node:os");
os.networkInterfaces = () => {
  const error = new Error("unrelated failure");
  error.code = "EIO";
  error.syscall = "read";
  throw error;
};
`,
    );
    const result = runShimHarness(
      `--require ${unrelatedPreload}`,
      "require('node:os').networkInterfaces()",
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unrelated failure");
  });
});
