import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

// @ts-ignore JavaScript release-server module is intentionally exercised through Vitest.
const {
  buildLocalReleaseServerCommand,
  createLocalReleaseServerIdentity,
  isLocalReleaseServerIdentity,
  parseExactLoopbackOrigin,
  reserveLocalReleaseOrigin,
  resolveLocalReleaseRunTimeout,
} = await import("../scripts/local-release-server.mjs");

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

  it("bounds the browser process instead of hiding hangs behind unbounded waits", () => {
    expect(resolveLocalReleaseRunTimeout(undefined)).toBe(600_000);
    expect(resolveLocalReleaseRunTimeout("60000")).toBe(60_000);
    expect(resolveLocalReleaseRunTimeout("1200000")).toBe(1_200_000);
    for (const value of ["0", "59999", "1200001", "not-a-number"]) {
      expect(() => resolveLocalReleaseRunTimeout(value)).toThrow("invalid_local_release_timeout");
    }
  });
});
