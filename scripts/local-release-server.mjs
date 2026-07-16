import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

const MIN_UNPRIVILEGED_PORT = 1024;
const MAX_PORT = 65_535;
const SERVER_ID_PATTERN = /^local-[a-f0-9]{32}$/u;

/**
 * @param {unknown} value
 * @returns {value is { code?: string }}
 */
function hasErrorCode(value) {
  return typeof value === "object" && value !== null && "code" in value;
}

/**
 * @param {unknown} value
 * @returns {{ origin: string, port: number }}
 */
export function parseExactLoopbackOrigin(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid_local_release_origin");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("invalid_local_release_origin");
  }
  const port = Number(parsed.port);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password ||
    !Number.isInteger(port) ||
    port < MIN_UNPRIVILEGED_PORT ||
    port > MAX_PORT ||
    parsed.origin !== value
  ) {
    throw new Error("invalid_local_release_origin");
  }
  return { origin: parsed.origin, port };
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildLocalReleaseServerCommand(origin) {
  const parsed = parseExactLoopbackOrigin(origin);
  return `node scripts/e2e-prepare-local.mjs && E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL=${parsed.origin} APP_ORIGIN=${parsed.origin} ./node_modules/.bin/react-router dev --host 127.0.0.1 --port ${parsed.port} --strictPort`;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function resolveLocalReleaseRunTimeout(value) {
  if (value === undefined || value === null || value === "") return 10 * 60 * 1000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 20 * 60 * 1000) {
    throw new Error("invalid_local_release_timeout");
  }
  return parsed;
}

/**
 * @param {import("node:net").Server} server
 * @param {number} port
 * @returns {Promise<void>}
 */
function listen(server, port) {
  return new Promise((resolve, reject) => {
    /** @param {NodeJS.ErrnoException} error */
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port, exclusive: true });
  });
}

/**
 * @param {import("node:net").Server} server
 * @returns {Promise<void>}
 */
function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * @typedef {{ preferredPort?: number, fallbackToEphemeral?: boolean }} ReserveLocalReleaseOptions
 */

/**
 * @param {ReserveLocalReleaseOptions} [options]
 * @returns {Promise<{ origin: string, port: number, release: () => Promise<void> }>}
 */
export async function reserveLocalReleaseOrigin({ preferredPort = 0, fallbackToEphemeral = false } = {}) {
  if (
    !Number.isInteger(preferredPort) ||
    preferredPort < 0 ||
    preferredPort > MAX_PORT ||
    (preferredPort > 0 && preferredPort < MIN_UNPRIVILEGED_PORT)
  ) {
    throw new Error("invalid_local_release_port");
  }

  let server = createServer();
  try {
    await listen(server, preferredPort);
  } catch (error) {
    if (!fallbackToEphemeral || preferredPort === 0) {
      server.close();
      throw new Error(hasErrorCode(error) && error.code === "EADDRINUSE" ? "local_release_origin_occupied" : "local_release_origin_unavailable");
    }
    server.close();
    server = createServer();
    try {
      await listen(server, 0);
    } catch {
      server.close();
      throw new Error("local_release_origin_unavailable");
    }
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("local_release_origin_unavailable");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const parsed = parseExactLoopbackOrigin(origin);
  let released = false;

  return {
    ...parsed,
    async release() {
      if (released) return;
      await close(server);
      released = true;
    },
  };
}

/** @returns {string} */
export function createLocalReleaseServerIdentity() {
  return `local-${randomBytes(16).toString("hex")}`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLocalReleaseServerIdentity(value) {
  return typeof value === "string" && SERVER_ID_PATTERN.test(value);
}
