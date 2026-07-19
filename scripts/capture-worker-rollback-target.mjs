#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseWorkerDeploymentStatus } from "./worker-rollback-target.mjs";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
if (outputIndex < 0 || outputIndex + 1 >= args.length || args.length !== 2) {
  throw new Error("worker_rollback_output_required");
}
const outputPath = resolve(process.cwd(), args[outputIndex + 1]);
const result = spawnSync(process.env.WRANGLER_BIN || "wrangler", ["deployments", "status", "--json"], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("worker_deployment_status_failed");
const target = parseWorkerDeploymentStatus(result.stdout);
const evidence = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  source: "wrangler deployments status --json",
  ...target,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ ok: true, versionId: evidence.versionId })}\n`);
