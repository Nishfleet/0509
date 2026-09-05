import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

// @ts-ignore JavaScript release-server module is intentionally exercised through Vitest.
const {
  buildLocalReleaseServerCommand,
  buildLocalReleaseServerRetryScript,
  hasNetworkInterfaceEnumerationContract,
  LOCAL_RELEASE_SERVER_BOOT_SECONDS,
  LOCAL_RELEASE_SERVER_MAX_ATTEMPTS,
  LOCAL_RELEASE_SERVER_RETRY_DELAY_SECONDS,
  localReleaseServerCloudflareOptions,
  NETWORK_INTERFACE_ENUM_CONTRACT_ENV,
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

  it("declares a stable environment contract for the hardened interface-enumeration runners", () => {
    expect(NETWORK_INTERFACE_ENUM_CONTRACT_ENV).toBe("E2E_NETWORK_INTERFACE_ENUM_UNAVAILABLE");
    expect(hasNetworkInterfaceEnumerationContract({})).toBe(false);
    expect(hasNetworkInterfaceEnumerationContract({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "1" })).toBe(true);
    expect(hasNetworkInterfaceEnumerationContract({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "0" })).toBe(false);
    expect(hasNetworkInterfaceEnumerationContract({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "yes" })).toBe(false);
    expect(hasNetworkInterfaceEnumerationContract({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "" })).toBe(false);
    expect(
      hasNetworkInterfaceEnumerationContract({
        [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "1",
        E2E_TEST_MODE: "1",
      }),
    ).toBe(true);
  });

  it("disables the Cloudflare inspector only when the runner declares the contract", () => {
    expect(localReleaseServerCloudflareOptions({})).toEqual({});
    expect(localReleaseServerCloudflareOptions({ E2E_TEST_MODE: "1" })).toEqual({});
    expect(localReleaseServerCloudflareOptions({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "0" })).toEqual({});
    expect(
      localReleaseServerCloudflareOptions({
        [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "1",
        E2E_TEST_MODE: "1",
      }),
    ).toEqual({ inspectorPort: false });
  });
});
