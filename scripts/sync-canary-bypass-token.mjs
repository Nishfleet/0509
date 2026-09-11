// d1-budget: reads=0 writes=0 runs_per_day=10
// Sync CANARY_BYPASS_TOKEN onto the deployed Worker via the classic
// `wrangler secret put`, with a bounded retry that absorbs Cloudflare's
// "currently deployed" lag AND re-promotes the production version when a
// preview upload has polluted the script's latest version.
//
// Why this exists: the workflow's "Synchronize Worker secrets" step
// runs `wrangler secret put` right after `npm run deploy` returns. Classic
// `secret put` requires the Worker's latest version to be marked currently
// deployed. Two things break that precondition:
//
//   1. Deployment-mark lag behind `wrangler deploy` (run 34079008963).
//   2. Root cause of #1981: PR-CI workflows (preview-assert, merge_group)
//      upload PREVIEW versions of the production script on pull_request and
//      merge_group events. Each preview upload advances the script's LATEST
//      version without deploying it (verified on the Cloudflare versions API:
//      versions tagged `workers/triggered_by: version_upload` with a
//      `preview-assert-<sha>` alias). From that moment the put fails with
//      "Secret edit failed ... latest version of your Worker isn't currently
//      deployed" and a plain retry can NEVER succeed inside this run —
//      nothing re-promotes until the next production deploy. That is why
//      runs 34192323408, 34196632642 and 34198106528 failed all 10 attempts
//      and the workflow step failed minutes later.
//
// The fix: after a failed put, read the script's latest version and the
// active deployment from the Cloudflare API. When they diverge (a preview
// upload moved `latest`), re-run `wrangler deploy` — the same promotion the
// deploy step performed — so latest == deployed again, then retry the put.
// The retry IS the poll; the re-promote is bounded. Once a put lands here,
// the workflow step's identical put is a no-op rewrite that cannot hit the
// precondition. Classic `secret put` only; `wrangler versions secret put`
// stays rejected ("Failed to parse body as FormData", run 31514742997).
//
// Failure posture: this step runs non-blocking in the deploy plan. An
// exhausted retry must never roll back a good deploy — the workflow step
// still runs after the plan and gets the final word.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planNextAction } from "./canary-token-sync-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const maxAttempts = Math.max(
  1,
  Number.parseInt(process.env.CANARY_SYNC_MAX_ATTEMPTS ?? "10", 10) || 10,
);
const retryDelayMs = Math.max(
  0,
  Number.parseInt(process.env.CANARY_SYNC_RETRY_DELAY_MS ?? "10000", 10) || 0,
);
const maxRepromotes = Math.max(
  0,
  Number.parseInt(process.env.CANARY_SYNC_MAX_REPROMOTES ?? "3", 10) || 3,
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

/**
 * Read the script's latest uploaded version id and the version served by the
 * active deployment. Returns nulls when either cannot be determined — the
 * caller then falls back to plain put attempts.
 */
async function fetchDeploymentState(accountId, apiToken, name) {
  const headers = { Authorization: `Bearer ${apiToken}` };
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${name}`;
  try {
    const [versionsRes, deploymentsRes] = await Promise.all([
      fetch(`${base}/versions?per_page=1`, { headers }),
      fetch(`${base}/deployments`, { headers }),
    ]);
    if (!versionsRes.ok || !deploymentsRes.ok) {
      console.error(
        `canary token sync state probe failed (versions ${versionsRes.status}, deployments ${deploymentsRes.status})`,
      );
      return { latestVersionId: null, deployedVersionId: null };
    }
    const versions = await versionsRes.json();
    const deployments = await deploymentsRes.json();
    const latestVersionId =
      versions?.result?.items?.[0]?.id ?? null;
    const active = deployments?.result?.deployments?.[0] ?? null;
    const deployedVersionId = active?.versions?.[0]?.version_id ?? null;
    return { latestVersionId, deployedVersionId };
  } catch (error) {
    console.error(
      `canary token sync state probe errored: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { latestVersionId: null, deployedVersionId: null };
  }
}

function sleepSync(ms) {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";

let lastDetail = "unknown";
let putAttempts = 0;
let repromotes = 0;
let state = { latestVersionId: null, deployedVersionId: null };
for (;;) {
  const action = planNextAction({
    putAttempts,
    repromotes,
    maxAttempts,
    maxRepromotes,
    ...state,
  });
  if (action === "give_up") {
    console.error(
      `canary token sync failed after ${putAttempts} attempts (${lastDetail})`,
    );
    process.exit(1);
  }

  if (action === "repromote") {
    // The latest version is an undeployed preview upload. Re-run the same
    // promotion the deploy step performed (`wrangler deploy`) so the put's
    // precondition holds again. Same cwd/config as the plan's deploy step.
    repromotes += 1;
    console.error(
      `canary token sync: latest version is not the deployed version (preview upload advanced it); re-promoting with wrangler deploy (repromote ${repromotes}/${maxRepromotes})`,
    );
    const promote = spawnSync(wranglerBin, ["deploy"], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    if (promote.status !== 0) {
      lastDetail = `repromote exit ${promote.status ?? "signal " + promote.signal}`;
      console.error(`canary token sync repromote failed (${lastDetail})`);
      sleepSync(retryDelayMs);
      continue;
    }
  }

  putAttempts += 1;
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
    console.error(`canary token sync attempt ${putAttempts} ${lastDetail}`);
  } else if (result.status === 0) {
    console.log(`canary token synced on attempt ${putAttempts}`);
    process.exit(0);
  } else {
    lastDetail = `exit ${result.status ?? "signal " + result.signal}`;
    console.error(
      `canary token sync attempt ${putAttempts} failed (${lastDetail}); ` +
        "checking whether a preview upload moved the latest version",
    );
  }
  // Only consult the Cloudflare API when a put actually failed — a successful
  // put exits above. Unknown credentials degrade to plain put retries.
  if (accountId.length > 0 && apiToken.length > 0) {
    state = await fetchDeploymentState(accountId, apiToken, workerName);
  }
  sleepSync(retryDelayMs);
}
