#!/usr/bin/env node
// d1-budget: reads=200 writes=0 runs_per_day=8
/**
 * Bounded internal canary for Presence website connector hardening.
 * Runs focused Vitest suites — no customer delivery, no live outbound fetches.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SYNTHETIC_GA_WORKSPACE_ID = "presence-ga-canary-workspace";

/**
 * @typedef {{
 *   PRESENCE_WEBSITE_ROLLOUT?: string,
 *   PRESENCE_INTERNAL_WORKSPACE_ID?: string,
 * }} PresenceWebsiteCanaryEnv
 *
 * @typedef {{
 *   env?: PresenceWebsiteCanaryEnv,
 *   configText?: string,
 * }} PresenceWebsiteCanaryInput
 *
 * @typedef {{
 *   ok: boolean,
 *   message: string | null,
 *   rollout: string,
 *   internalWorkspaceId: string,
 * }} PresenceWebsiteCanaryConfig
 */

/**
 * @param {string} configText
 * @returns {string}
 */
export function parsePresenceWebsiteRollout(configText) {
  const match = configText.match(/"PRESENCE_WEBSITE_ROLLOUT"\s*:\s*"([^"]+)"/);
  return match?.[1] || "";
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
export function normalizePresenceWebsiteRollout(value) {
  const normalized = String(value || "");
  if (normalized === "generally_available") return "ga";
  if (normalized === "disabled" || normalized === "internal" || normalized === "pilot" || normalized === "ga") {
    return normalized;
  }
  return "disabled";
}

/**
 * @param {PresenceWebsiteCanaryInput} [input]
 * @returns {PresenceWebsiteCanaryConfig}
 */
export function resolvePresenceWebsiteCanaryConfig(input = {}) {
  const env = input.env ?? process.env;
  const configText =
    input.configText ??
    readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const rollout = normalizePresenceWebsiteRollout(
    env.PRESENCE_WEBSITE_ROLLOUT || parsePresenceWebsiteRollout(configText),
  );
  const configuredWorkspaceId = env.PRESENCE_INTERNAL_WORKSPACE_ID?.trim() || "";

  if (rollout === "internal" && !configuredWorkspaceId) {
    return {
      ok: false,
      message: "Missing PRESENCE_INTERNAL_WORKSPACE_ID for internal Presence rollout",
      rollout,
      internalWorkspaceId: "",
    };
  }

  if (rollout !== "ga" && rollout !== "internal") {
    return {
      ok: false,
      message: `Presence website rollout is ${rollout}; expected ga or internal`,
      rollout,
      internalWorkspaceId: "",
    };
  }

  return {
    ok: true,
    message: null,
    rollout,
    internalWorkspaceId: configuredWorkspaceId || SYNTHETIC_GA_WORKSPACE_ID,
  };
}

/**
 * @param {PresenceWebsiteCanaryInput} [input]
 * @returns {number}
 */
export function runPresenceWebsiteCanary(input = {}) {
  const config = resolvePresenceWebsiteCanaryConfig(input);
  if (!config.ok) {
    console.error(config.message);
    return 1;
  }
  const childEnv = /** @type {NodeJS.ProcessEnv} */ ({
    ...process.env,
    PRESENCE_WEBSITE_ROLLOUT: config.rollout,
    PRESENCE_INTERNAL_WORKSPACE_ID: config.internalWorkspaceId,
  });

  const result = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "tests/presence-robots.test.ts",
      "tests/presence-safe-fetch.test.ts",
      "tests/presence-tracking.test.ts",
      "tests/presence-ga-rollout.test.ts",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: childEnv,
    },
  );

  if (result.status !== 0) {
    console.error("presence website canary: failed");
    return result.status ?? 1;
  }

  console.log("presence website canary: ok");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const status = runPresenceWebsiteCanary();
  process.exit(status);
}
