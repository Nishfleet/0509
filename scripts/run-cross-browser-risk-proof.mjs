#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CROSS_BROWSER_MANIFEST_PATHS,
  REQUIRED_CROSS_BROWSER_RISK_SCOPES,
} from "./verify-cross-browser-risk-proof.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

for (const [project, journeys] of Object.entries(REQUIRED_CROSS_BROWSER_RISK_SCOPES)) {
  process.stdout.write(`cross-browser risk proof: ${project} journeys ${journeys.join(",")}\n`);
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-local-release-proof.mjs",
      "--diagnostic-subset",
      `--journeys=${journeys.join(",")}`,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        E2E_RELEASE_BASE: "HEAD",
        E2E_RELEASE_PROJECT: project,
        E2E_RELEASE_MANIFEST_PATH: CROSS_BROWSER_MANIFEST_PATHS[project],
      },
      stdio: "inherit",
    },
  );
  if (result.error || result.status !== 0) {
    process.stderr.write(`cross-browser risk proof failed: ${project}\n`);
    process.exit(1);
  }
}

const verify = spawnSync(
  process.execPath,
  ["scripts/verify-cross-browser-risk-proof.mjs", "--base", "HEAD"],
  { cwd: root, env: process.env, stdio: "inherit" },
);
process.exit(verify.error || verify.status !== 0 ? 1 : 0);
