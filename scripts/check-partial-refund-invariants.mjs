#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PARTIAL_REFUND_PREFLIGHT_QUERY,
  parsePartialRefundPreflightOutput,
  partialRefundPreflightHasFindings,
} from "./partial-refund-preflight.lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const result = spawnSync(
  "wrangler",
  ["d1", "execute", "0509", "--remote", "--command", PARTIAL_REFUND_PREFLIGHT_QUERY, "--json"],
  { cwd: root, env: process.env, encoding: "utf8" },
);

if (result.error) {
  console.error(`partial refund preflight could not run: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr?.trim() || "partial refund preflight query failed");
  process.exit(1);
}

try {
  const counts = parsePartialRefundPreflightOutput(result.stdout ?? "");
  if (partialRefundPreflightHasFindings(counts)) {
    console.error(
      `partial refund preflight failed: ${JSON.stringify(counts)}. Stop deployment; reconcile only from provider evidence with an idempotent compensation plan.`,
    );
    process.exit(1);
  }
  console.log("partial refund preflight passed: no historical over-claw evidence found.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
