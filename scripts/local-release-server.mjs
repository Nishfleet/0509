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
 * Resolve the Cloudflare Vite plugin's `inspectorPort` option for the local
 * release server. Choosing a worker inspector port makes the plugin enumerate
 * the host's network interfaces (`getLocalHosts` -> `os.networkInterfaces()`),
 * which aborts boot on the hardened self-hosted verify runners with
 * `uv_interface_addresses returned Unknown system error 97` (EAFNOSUPPORT).
 * Headless local release proofs never attach an inspector, so E2E test mode
 * opts the plugin out of port selection entirely through its documented
 * `inspectorPort: false` option and the enumeration is never reached. Outside
 * E2E test mode the inspector keeps its default behavior.
 *
 * @param {Record<string, string | undefined> | undefined} [env]
 * @returns {false | undefined}
 */
export function resolveLocalReleaseCloudflareInspectorPort(env = process.env) {
  return String(env?.E2E_TEST_MODE) === "1" ? false : undefined;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function buildLocalReleaseServerCommand(origin) {
  const parsed = parseExactLoopbackOrigin(origin);
  // `E2E_TEST_MODE=1` is the explicit environment contract that disables the
  // Cloudflare plugin's interface enumeration for its inspector port (see
  // `resolveLocalReleaseCloudflareInspectorPort`). The self-hosted verify
  // runners otherwise fail the dev server at boot with
  // `uv_interface_addresses returned Unknown system error 97` (EAFNOSUPPORT)
  // while Vite enumerates interfaces for its startup banner.
  const server = `E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL=${parsed.origin} APP_ORIGIN=${parsed.origin} ./node_modules/.bin/react-router dev --host 127.0.0.1 --port ${parsed.port} --strictPort`;
  // Retry ONLY a fast boot failure. If the server stayed up for
  // LOCAL_RELEASE_SERVER_BOOT_SECONDS or longer, its exit is a real result
  // (Playwright tearing it down, or a genuine crash) and is passed straight
  // through. This cannot mask a server that starts and then misbehaves.
  return `node scripts/e2e-prepare-local.mjs && ${buildLocalReleaseServerRetryScript(server)}`;
}

/**
 * Seconds a dev server must survive before an exit counts as a real result
 * rather than a boot failure worth retrying.
 */
export const LOCAL_RELEASE_SERVER_BOOT_SECONDS = 15;

export const LOCAL_RELEASE_SERVER_MAX_ATTEMPTS = 3;
export const LOCAL_RELEASE_SERVER_RETRY_DELAY_SECONDS = 3;

/**
 * Build the bounded shell retry loop. The command parameters are shell
 * fragments so tests can inject deterministic clocks and pauses without
 * starting a server or sleeping.
 *
 * @param {string} serverCommand
 * @param {{ clockStartCommand?: string, clockEndCommand?: string, pauseCommand?: string }} [commands]
 * @returns {string}
 */
export function buildLocalReleaseServerRetryScript(
  serverCommand,
  {
    clockStartCommand = "date +%s",
    clockEndCommand = "date +%s",
    pauseCommand = `sleep ${LOCAL_RELEASE_SERVER_RETRY_DELAY_SECONDS}`,
  } = {},
) {
  if (typeof serverCommand !== "string" || serverCommand.length === 0) {
    throw new Error("invalid_local_release_server_command");
  }
  return `for attempt in 1 2 3; do started=$(${clockStartCommand}); ${serverCommand}; rc=$?; ran=$(( $(${clockEndCommand}) - started )); if [ "$rc" -eq 0 ] || [ "$ran" -ge ${LOCAL_RELEASE_SERVER_BOOT_SECONDS} ] || [ "$attempt" -eq ${LOCAL_RELEASE_SERVER_MAX_ATTEMPTS} ]; then exit "$rc"; fi; echo "local-release-server: boot failed in ${"${ran}"}s (attempt ${"${attempt}"}/${LOCAL_RELEASE_SERVER_MAX_ATTEMPTS}), retrying" >&2; ${pauseCommand}; done; exit 1`;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function resolveLocalReleaseRunTimeout(value) {
  if (value === undefined || value === null || value === "") return 15 * 60 * 1000;
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
