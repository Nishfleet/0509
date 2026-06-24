#!/usr/bin/env node
/**
 * Bounded internal canary for Presence website connector hardening.
 * Runs focused Vitest suites — no customer delivery, no live outbound fetches.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const internalWorkspaceId = process.env.PRESENCE_INTERNAL_WORKSPACE_ID?.trim();

if (!internalWorkspaceId) {
  console.error("Missing PRESENCE_INTERNAL_WORKSPACE_ID");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  [
    "vitest",
    "run",
    "tests/presence-robots.test.ts",
    "tests/presence-safe-fetch.test.ts",
    "tests/presence-tracking.test.ts",
    "-t",
    "website|robots|safe fetch",
  ],
  { cwd: root, stdio: "inherit", env: { ...process.env, PRESENCE_INTERNAL_WORKSPACE_ID: internalWorkspaceId } },
);

if (result.status !== 0) {
  console.error("presence website canary: failed");
  process.exit(result.status ?? 1);
}

console.log("presence website canary: ok");
