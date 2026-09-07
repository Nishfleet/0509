#!/usr/bin/env node
// Sync CANARY_BYPASS_TOKEN onto the deployed Worker via the classic
// `wrangler secret put`, with a bounded retry that absorbs Cloudflare's
// "currently deployed" lag.
//
// Why this exists: the workflow's "Synchronize private canary token" step
// runs `wrangler secret put` right after `npm run deploy` returns. Classic
// `secret put` requires the Worker's latest version to be marked currently
// deployed, and that mark lags behind `wrangler deploy` returning — so the
// step can die with "Secret edit failed ... latest version of your Worker
// isn't currently deployed." even though the deploy itself succeeded
// (run 34079008963). This script performs the same sync earlier, inside the
// deploy plan, retrying until the version is marked deployed. The retry IS
// the poll for the mark — no fragile API parsing. Once a put lands here,
// the workflow step's identical put is a no-op rewrite that cannot hit the
// lag. Classic `secret put` only: `wrangler versions secret put` stays
// rejected ("Failed to parse body as FormData", run 31514742997).
//
// Failure posture: this step runs non-blocking in the deploy plan. An
// exhausted retry must never roll back a good deploy — the workflow step
// still runs after the plan and gets the final word.
import { spawnSync } from "node:child_process";

const maxAttempts = Math.max(
  1,
  Number.parseInt(process.env.CANARY_SYNC_MAX_ATTEMPTS ?? "10", 10) || 10,
);
const retryDelayMs = Math.max(
  0,
  Number.parseInt(process.env.CANARY_SYNC_RETRY_DELAY_MS ?? "10000", 10) || 0,
);
const wranglerBin = process.env.WRANGLER_BIN || "wrangler";
const workerName = process.env.CANARY_SYNC_WORKER_NAME || "0509";
const token = process.env.CANARY_BYPASS_TOKEN ?? "";

if (token.length === 0) {
  // Break-glass local deploys may not carry the token; the workflow step is
  // the authoritative sync in CI. Skipping is never worse than before this
  // step existed.
  console.log("canary token sync skipped: CANARY_BYPASS_TOKEN is not set");
  process.exit(0);
}

let lastDetail = "unknown";
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  // The token travels on stdin only — never argv, so it cannot leak into
  // process listings or step logs.
  const result = spawnSync(
    wranglerBin,
    ["secret", "put", "CANARY_BYPASS_TOKEN", "--name", workerName],
    {
      input: token,
      stdio: ["pipe", "inherit", "inherit"],
      env: process.env,
    },
  );
  if (result.error) {
    lastDetail = `spawn failed: ${result.error.message}`;
    console.error(`canary token sync attempt ${attempt} ${lastDetail}`);
  } else if (result.status === 0) {
    console.log(`canary token synced on attempt ${attempt}`);
    process.exit(0);
  } else {
    lastDetail = `exit ${result.status ?? "signal " + result.signal}`;
    console.error(
      `canary token sync attempt ${attempt} failed (${lastDetail}); ` +
        "waiting for the deployed version to be marked currently deployed",
    );
  }
  if (attempt < maxAttempts && retryDelayMs > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
  }
}

console.error(
  `canary token sync failed after ${maxAttempts} attempts (${lastDetail})`,
);
process.exit(1);
