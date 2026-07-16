#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import {
  formatProductionCanaryReport,
  runProductionCanary,
} from "./prod-canary.lib.mjs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const wranglerOutputPath = readArg("--wrangler-output");
  if (!wranglerOutputPath) throw new Error("wrangler_output_path_missing");
  const workerVersionId = readDeployedWorkerVersionId(
    readFileSync(resolve(wranglerOutputPath), "utf8"),
  );
  const report = await runProductionCanary({
    expectedWorkerVersionId: workerVersionId,
    expectedSearchRolloutMode: "shadow",
    canaryBypassToken: process.env.CANARY_BYPASS_TOKEN,
  });
  const evidencePath = resolve(
    wranglerOutputPath.replace(/\.jsonl$/u, "-canary.json"),
  );
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${formatProductionCanaryReport(report)}\n`);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "post_deploy_release_verification_failed"}\n`);
  process.exitCode = 1;
}
