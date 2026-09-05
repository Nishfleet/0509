#!/usr/bin/env node
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Environment contract that boots the isolated release server against a
 * loopback-only interface view. The cross-browser matrix workflow sets it on
 * the hardened self-hosted runners where `os.networkInterfaces()` intermittently
 * throws `uv_interface_addresses returned Unknown system error 97`
 * (EAFNOSUPPORT) while the Cloudflare Vite plugin resolves its inspector port
 * via `getLocalHosts`/`getPorts`. The release server only ever binds
 * 127.0.0.1, so interface enumeration is irrelevant to it and the failure is
 * purely environmental.
 */
export const LOOPBACK_INTERFACES_ONLY_ENV = "E2E_LOOPBACK_INTERFACES_ONLY";

/**
 * The deterministic interface view substituted when host enumeration fails.
 * Mirrors the `os.networkInterfaces()` entry shape for the loopback interface
 * so downstream consumers (the plugin's host list, port probing) keep working.
 *
 * @returns {Record<string, Array<Record<string, unknown>>>}
 */
export function loopbackInterfaceAddresses() {
  return {
    lo: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
  };
}

/**
 * Apply the loopback-only interface contract to an `os`-shaped module.
 *
 * Under the contract the real `networkInterfaces` call is wrapped so a failed
 * enumeration is replaced by {@link loopbackInterfaceAddresses} instead of
 * throwing. Successful enumerations pass through untouched, so healthy
 * environments see byte-identical behavior and the fallback rescues only the
 * exact failure it exists for. When the contract is disabled the module is
 * left alone and an enumeration failure keeps propagating (fail clearly).
 *
 * @param {{ osModule?: { networkInterfaces?: (...args: unknown[]) => unknown }, enabled?: boolean }} [options]
 * @returns {boolean} whether the contract was applied
 */
export function applyLoopbackInterfaceContract({
  osModule = os,
  enabled = process.env[LOOPBACK_INTERFACES_ONLY_ENV] === "1",
} = {}) {
  if (!enabled) return false;
  if (typeof osModule.networkInterfaces !== "function") return false;
  const realNetworkInterfaces = osModule.networkInterfaces;
  osModule.networkInterfaces = function loopbackOnlyNetworkInterfaces() {
    try {
      return realNetworkInterfaces.call(osModule);
    } catch (error) {
      process.stderr.write(
        `local-release-server: interface enumeration failed (${error instanceof Error ? error.message : String(error)}); booting with the loopback-only view under ${LOOPBACK_INTERFACES_ONLY_ENV}\n`,
      );
      return loopbackInterfaceAddresses();
    }
  };
  return true;
}

/**
 * Boot the react-router dev CLI in-process after applying the loopback
 * contract. Reuses the published `@react-router/dev` bin so the command line,
 * NODE_ENV defaulting, and the `--conditions=development` self-restart behave
 * exactly like `./node_modules/.bin/react-router dev`. The self-restart
 * re-runs this launcher, so the contract is re-applied in the restarted child.
 *
 * @returns {Promise<void>}
 */
async function main() {
  applyLoopbackInterfaceContract();
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("@react-router/dev/package.json");
  const binPath = path.join(path.dirname(packageJsonPath), "bin.cjs");
  await import(pathToFileURL(binPath).href);
}

const isLauncherEntry =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isLauncherEntry) {
  main().catch((error) => {
    if (error) console.error(error);
    process.exit(1);
  });
}
