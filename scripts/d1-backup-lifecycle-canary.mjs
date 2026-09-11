#!/usr/bin/env node
// d1-budget: reads=0 writes=0 runs_per_day=1

import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKUP_BUCKET_NAME,
  buildR2DeleteArgs,
  buildR2GetArgs,
  buildR2PutArgs,
} from "./d1-backup-command-args.mjs";
import { runCommandRedacted } from "./safe-command-output.mjs";

const POLICY_PATH = resolve("config/r2-retention-policy.json");
const WRANGLER_CONFIG_PATH = resolve("wrangler.jsonc");

/** @param {unknown} value @returns {string} */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(
      ([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** @param {unknown} value */
export function sha256CanonicalJson(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** @param {Buffer | string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} rules */
export function canonicalizeLifecycleRules(rules) {
  if (!Array.isArray(rules)) throw new Error("r2_lifecycle_rules_invalid");
  return rules.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("r2_lifecycle_rule_invalid");
    const rule = /** @type {Record<string, any>} */ (entry);
    return {
      id: typeof rule.id === "string" ? rule.id : "",
      enabled: rule.enabled === true,
      prefix: typeof rule.conditions?.prefix === "string" ? rule.conditions.prefix : "",
      deleteConditionType: typeof rule.deleteObjectsTransition?.condition?.type === "string"
        ? rule.deleteObjectsTransition.condition.type
        : null,
      deleteMaxAge: rule.deleteObjectsTransition?.condition?.type === "Age" &&
          Number.isSafeInteger(rule.deleteObjectsTransition?.condition?.maxAge)
        ? rule.deleteObjectsTransition.condition.maxAge
        : null,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @param {{ accountId: string, apiToken: string, bucket?: string, fetchImpl?: typeof fetch }} input
 */
export async function fetchLiveLifecycleRules({
  accountId,
  apiToken,
  bucket = BACKUP_BUCKET_NAME,
  fetchImpl = fetch,
}) {
  if (!/^[a-f0-9]{32}$/iu.test(accountId) || !apiToken) throw new Error("r2_lifecycle_credentials_missing");
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/lifecycle`,
    { headers: { authorization: `Bearer ${apiToken}` } },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object") throw new Error("r2_lifecycle_fetch_failed");
  const record = /** @type {Record<string, any>} */ (body);
  const rules = record.result?.rules ?? record.rules;
  return canonicalizeLifecycleRules(rules);
}

/** @param {unknown} policy @param {ReturnType<typeof canonicalizeLifecycleRules>} liveRules */
export function assertExpectedLifecyclePolicy(policy, liveRules) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("r2_lifecycle_policy_invalid");
  const record = /** @type {Record<string, any>} */ (policy);
  if (
    record.schemaVersion !== 1 ||
    record.bucket !== BACKUP_BUCKET_NAME ||
    !Array.isArray(record.applicationManagedPrefixes) ||
    !record.applicationManagedPrefixes.every((prefix) => typeof prefix === "string" && prefix.length > 0) ||
    !Array.isArray(record.rules)
  ) {
    throw new Error("r2_lifecycle_policy_invalid");
  }
  for (const protectedPrefix of record.applicationManagedPrefixes) {
    const unsafeDeletionRule = liveRules.find((rule) =>
      rule.enabled &&
      (rule.prefix.startsWith(protectedPrefix) || protectedPrefix.startsWith(rule.prefix)) &&
      (rule.deleteConditionType === "Age" || rule.deleteConditionType === "Date"),
    );
    if (unsafeDeletionRule) throw new Error("r2_lifecycle_unsafe_overlap");
  }
  for (const expected of record.rules) {
    const maxAge = expected?.expireDays * 86_400;
    const match = liveRules.find((rule) =>
      rule.id === expected?.id && rule.prefix === expected?.prefix && rule.enabled && rule.deleteMaxAge === maxAge,
    );
    if (!match) throw new Error("r2_lifecycle_policy_drift");
    const unsafeOverlap = liveRules.find((rule) =>
      rule.id !== expected?.id &&
      rule.enabled &&
      (rule.prefix.startsWith(expected?.prefix ?? "") || (expected?.prefix ?? "").startsWith(rule.prefix)) &&
      (
        rule.deleteConditionType === "Date" ||
        (rule.deleteConditionType === "Age" && typeof rule.deleteMaxAge === "number" && rule.deleteMaxAge < maxAge)
      ),
    );
    if (unsafeOverlap) throw new Error("r2_lifecycle_unsafe_overlap");
  }
  return true;
}

/**
 * Read-only lifecycle recheck used when fresh passed Gate C evidence is reused.
 * @param {{ accountId: string, apiToken: string, fetchImpl?: typeof fetch }} input
 */
export async function checkBackupLifecyclePolicy({ accountId, apiToken, fetchImpl = fetch }) {
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  const liveRules = await fetchLiveLifecycleRules({ accountId, apiToken, fetchImpl });
  assertExpectedLifecyclePolicy(policy, liveRules);
  return {
    ok: true,
    lifecycleConfigSha256: sha256CanonicalJson(liveRules),
    policySha256: sha256CanonicalJson(policy),
  };
}

/** @param {unknown} error */
export function isConfirmedR2ObjectMissing(error) {
  const safeStderr = error && typeof error === "object" && "safeStderr" in error
    ? /** @type {{ safeStderr?: unknown }} */ (error).safeStderr
    : null;
  return typeof safeStderr === "string" && safeStderr.includes("The specified key does not exist.");
}

/** @param {string} workerVersionId @param {string} lifecycleSha256 */
export function buildBackupCanaryObjectKey(workerVersionId, lifecycleSha256) {
  const safeVersion = workerVersionId.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!safeVersion || safeVersion.length > 110 || !/^[a-f0-9]{64}$/u.test(lifecycleSha256)) {
    throw new Error("backup_lifecycle_object_key_invalid");
  }
  return `backups/d1/canary/gate-c/${safeVersion}/${lifecycleSha256}.json`;
}

/**
 * @param {{ operation: () => Promise<void>, injectFailureOnce?: boolean }} input
 */
export async function deleteObjectWithRetry({ operation, injectFailureOnce = true }) {
  const errors = [];
  let attempts = 0;
  if (injectFailureOnce) {
    attempts += 1;
    errors.push("r2_delete_injected_once");
  }
  for (let index = 0; index < 2; index += 1) {
    attempts += 1;
    try {
      await operation();
      return { ok: true, attempts, errors };
    } catch {
      errors.push("r2_delete_failed");
    }
  }
  return { ok: false, attempts, errors };
}

/**
 * @param {{
 *   workerVersionId: string,
 *   gateRunId: string,
 *   accountId: string,
 *   apiToken: string,
 *   now?: () => Date,
 *   fetchImpl?: typeof fetch,
 *   runCommand?: (command: string, args: string[]) => Promise<void>
 * }} input
 */
export async function runBackupLifecycleCanary({
  workerVersionId,
  gateRunId,
  accountId,
  apiToken,
  now = () => new Date(),
  fetchImpl = fetch,
  runCommand = runCommandRedacted,
}) {
  if (!/^[a-z0-9._-]{1,128}$/u.test(gateRunId)) throw new Error("backup_lifecycle_gate_run_invalid");
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  const liveBefore = await fetchLiveLifecycleRules({ accountId, apiToken, fetchImpl });
  assertExpectedLifecyclePolicy(policy, liveBefore);
  const lifecycleConfigSha256 = sha256CanonicalJson(liveBefore);
  const policySha256 = sha256CanonicalJson(policy);
  const wranglerConfigSha256 = sha256(readFileSync(WRANGLER_CONFIG_PATH));
  const objectKey = buildBackupCanaryObjectKey(workerVersionId, lifecycleConfigSha256);
  const root = mkdtempSync(join(tmpdir(), "0509-r2-lifecycle-"));
  const sourcePath = join(root, "manifest.json");
  const retrievedPath = join(root, "retrieved.json");
  const manifest = {
    schemaVersion: 1,
    kind: "0509_d1_backup_lifecycle_canary",
    workerVersionId,
    gateRunId,
    bucket: BACKUP_BUCKET_NAME,
    prefix: "backups/d1/",
    wranglerConfigSha256,
    lifecycleConfigSha256,
    policySha256,
    createdAt: now().toISOString(),
    objectKey,
  };
  const sourceBytes = `${canonicalJson(manifest)}\n`;
  writeFileSync(sourcePath, sourceBytes, { mode: 0o600 });
  let uploadMayHaveSucceeded = false;
  let deleted = false;
  let deleteEvidence = { ok: false, attempts: 0, errors: /** @type {string[]} */ ([]) };
  try {
    uploadMayHaveSucceeded = true;
    await runCommand("npx", buildR2PutArgs(BACKUP_BUCKET_NAME, objectKey, sourcePath));
    await runCommand("npx", buildR2GetArgs(BACKUP_BUCKET_NAME, objectKey, retrievedPath));
    const retrieved = readFileSync(retrievedPath);
    if (sha256(retrieved) !== sha256(sourceBytes) || retrieved.toString("utf8") !== sourceBytes) {
      throw new Error("backup_lifecycle_retrieval_mismatch");
    }
    deleteEvidence = await deleteObjectWithRetry({
      operation: () => runCommand("npx", buildR2DeleteArgs(BACKUP_BUCKET_NAME, objectKey)),
    });
    if (!deleteEvidence.ok) throw new Error("backup_lifecycle_delete_failed");
    deleted = true;
    let absent = false;
    try {
      await runCommand("npx", buildR2GetArgs(BACKUP_BUCKET_NAME, objectKey, retrievedPath));
    } catch (error) {
      if (!isConfirmedR2ObjectMissing(error)) throw error;
      absent = true;
    }
    if (!absent) throw new Error("backup_lifecycle_object_still_present");
    const liveAfter = await fetchLiveLifecycleRules({ accountId, apiToken, fetchImpl });
    assertExpectedLifecyclePolicy(policy, liveAfter);
    if (sha256CanonicalJson(liveAfter) !== lifecycleConfigSha256) throw new Error("r2_lifecycle_changed_during_canary");
    return {
      ok: true,
      objectKey,
      lifecycleConfigSha256,
      policySha256,
      wranglerConfigSha256,
      deleteAttempts: deleteEvidence.attempts,
      remoteObjectAbsent: true,
    };
  } finally {
    if (uploadMayHaveSucceeded && !deleted) {
      await deleteObjectWithRetry({
        operation: () => runCommand("npx", buildR2DeleteArgs(BACKUP_BUCKET_NAME, objectKey)),
        injectFailureOnce: false,
      });
    }
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Cleanup-only recovery for an interrupted Gate C lifecycle canary. It derives
 * the deterministic object key from the current verified lifecycle policy and
 * never uploads or queries customer data.
 * @param {{
 *   workerVersionId: string,
 *   accountId: string,
 *   apiToken: string,
 *   fetchImpl?: typeof fetch,
 *   runCommand?: (command: string, args: string[]) => Promise<void>
 * }} input
 */
export async function cleanupBackupLifecycleCanary({
  workerVersionId,
  accountId,
  apiToken,
  fetchImpl = fetch,
  runCommand = runCommandRedacted,
}) {
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  const liveBefore = await fetchLiveLifecycleRules({ accountId, apiToken, fetchImpl });
  assertExpectedLifecyclePolicy(policy, liveBefore);
  const lifecycleConfigSha256 = sha256CanonicalJson(liveBefore);
  const objectKey = buildBackupCanaryObjectKey(workerVersionId, lifecycleConfigSha256);
  const deletion = await deleteObjectWithRetry({
    operation: () => runCommand("npx", buildR2DeleteArgs(BACKUP_BUCKET_NAME, objectKey)),
    injectFailureOnce: false,
  });
  if (!deletion.ok) throw new Error("backup_lifecycle_cleanup_failed");
  const root = mkdtempSync(join(tmpdir(), "0509-r2-lifecycle-cleanup-"));
  try {
    let absent = false;
    try {
      await runCommand("npx", buildR2GetArgs(BACKUP_BUCKET_NAME, objectKey, join(root, "recovered.json")));
    } catch (error) {
      if (!isConfirmedR2ObjectMissing(error)) throw error;
      absent = true;
    }
    if (!absent) throw new Error("backup_lifecycle_cleanup_incomplete");
    const liveAfter = await fetchLiveLifecycleRules({ accountId, apiToken, fetchImpl });
    assertExpectedLifecyclePolicy(policy, liveAfter);
    if (sha256CanonicalJson(liveAfter) !== lifecycleConfigSha256) throw new Error("r2_lifecycle_changed_during_cleanup");
    return { ok: true, objectKey, remoteObjectAbsent: true, lifecycleConfigSha256 };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const workerVersionId = process.env.CANARY_EXPECTED_WORKER_VERSION_ID?.trim();
  const gateRunId = process.env.CANARY_GATE_RUN_ID?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!workerVersionId || !gateRunId || !accountId || !apiToken) throw new Error("backup_lifecycle_inputs_missing");
  const result = await runBackupLifecycleCanary({ workerVersionId, gateRunId, accountId, apiToken });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "backup_lifecycle_canary_failed"}\n`);
    process.exitCode = 1;
  });
}
