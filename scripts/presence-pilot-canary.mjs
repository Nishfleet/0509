#!/usr/bin/env node
/**
 * Controlled pilot canary for Presence website tracking.
 * Runs security + sync integrity tests and validates pilot access gates.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const suites = [
  "tests/presence-robots.test.ts",
  "tests/presence-safe-fetch.test.ts",
  "tests/presence-tracking.test.ts",
  "tests/presence-pilot-rollout.test.ts",
];

const result = spawnSync(
  "npx",
  ["vitest", "run", ...suites],
  { cwd: root, stdio: "inherit", env: process.env },
);

if (result.status !== 0) {
  console.error("presence pilot canary: failed");
  process.exit(result.status ?? 1);
}

console.log("presence pilot canary: ok");
