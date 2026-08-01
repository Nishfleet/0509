#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildProductionDeployPlan,
  executeProductionDeployPlan,
} from "./deploy-production-plan.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const localEnvFilePattern = /^(?:\.dev\.vars(?:\..+)?|\.env(?:\..+)?)$/;
const cloudflareCredentialEnvNames = [
  "CF_ACCOUNT_ID",
  "CF_API_KEY",
  "CF_API_TOKEN",
  "CF_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_EMAIL",
];

const movedLocalEnvFiles = [];
let exitCode = 0;

function commandEnv({ includeCloudflareCredentials = false } = {}) {
  const env = {
    ...process.env,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  };

  if (!includeCloudflareCredentials) {
    for (const name of cloudflareCredentialEnvNames) {
      delete env[name];
    }
  }

  return env;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...commandEnv(options), ...(options.env ?? {}) },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(" ")} failed`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

try {
  const holdDirectory = join(root, "tmp");
  mkdirSync(holdDirectory, { recursive: true });
  for (const name of readdirSync(root)) {
    if (!localEnvFilePattern.test(name)) {
      continue;
    }

    const source = join(root, name);
    if (!statSync(source).isFile()) {
      continue;
    }

    const held = join(holdDirectory, `.deploy-hold-${process.pid}-${movedLocalEnvFiles.length}-${name.slice(1)}`);
    renameSync(source, held);
    movedLocalEnvFiles.push({ source, held });
  }

  const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const manifestPath = `test-results/deploy-readiness-${nonce}.json`;
  const remoteRestoreEvidencePath = process.env.D1_REMOTE_RESTORE_EVIDENCE_PATH;
  const backupProofStatus = process.env.BACKUP_PROOF_STATUS;
  const wranglerOutputPath = `test-results/wrangler-deploy-output-${nonce}.jsonl`;
  const rollbackTargetPath = `test-results/worker-rollback-target-${nonce}.json`;
  const plan = buildProductionDeployPlan({
    manifestPath,
    remoteRestoreEvidencePath,
    backupProofStatus,
    wranglerOutputPath,
    rollbackTargetPath,
  });
  executeProductionDeployPlan(plan, (step) => run(step.command, step.args, step));
} catch (error) {
  exitCode = error && typeof error.exitCode === "number" ? error.exitCode : 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  for (const { source, held } of movedLocalEnvFiles.reverse()) {
    if (existsSync(held)) {
      renameSync(held, source);
    }
  }
}

process.exit(exitCode);
