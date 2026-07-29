import { homedir } from "node:os";
import { resolve } from "node:path";

export const BACKUP_AUTOMATION_APPROVAL = "0509-weekly-d1-to-r2";
export const MANUAL_BACKUP_APPROVAL = "0509-manual-d1-export";
export const BACKUP_DATABASE_NAME = "0509";
export const BACKUP_BUCKET_NAME = "0509-landing-page-artifacts";

/**
 * @param {string} homeDirectory
 * @param {Record<string, string | undefined>} env
 */
export function resolveBackupLocalDirectory(
  homeDirectory = homedir(),
  env = process.env,
) {
  const automationDirectory = env.D1_BACKUP_LOCAL_DIRECTORY?.trim();
  if (env.GITHUB_ACTIONS === "true") {
    if (!automationDirectory || automationDirectory.includes("\0")) {
      throw new Error("backup_automation_local_directory_missing");
    }
    return resolve(automationDirectory);
  }
  const home = String(homeDirectory).trim();
  if (!home || home.includes("\0")) {
    throw new Error("backup_local_directory_invalid");
  }
  return resolve(home, ".local", "state", "0509", "backups", "d1");
}

/** @param {string} databaseName @param {string} stamp */
export function buildBackupObjectKey(databaseName, stamp) {
  if (!/^[a-z0-9._-]{1,64}$/u.test(databaseName) || !/^[0-9TZ._-]{1,96}$/u.test(stamp)) {
    throw new Error("backup_object_key_input_invalid");
  }
  return `backups/d1/${databaseName}-${stamp}.sql`;
}

/**
 * @param {string} databaseName
 * @param {string} localPath
 * @param {{ skipConfirmation?: boolean }} options
 * @returns {string[]}
 */
export function buildD1ExportArgs(databaseName, localPath, { skipConfirmation = false } = {}) {
  const args = [
    "wrangler",
    "d1",
    "export",
    databaseName,
    "--remote",
    "--output",
    localPath,
  ];
  if (skipConfirmation) {
    args.splice(5, 0, "--skip-confirmation");
  }
  return args;
}

/**
 * @param {string} bucketName
 * @param {string} remoteKey
 * @param {string} localPath
 * @returns {string[]}
 */
export function buildR2PutArgs(bucketName, remoteKey, localPath) {
  return ["wrangler", "r2", "object", "put", `${bucketName}/${remoteKey}`, "--file", localPath, "--remote"];
}

/** @param {string} bucketName @param {string} remoteKey @param {string} localPath */
export function buildR2GetArgs(bucketName, remoteKey, localPath) {
  return ["wrangler", "r2", "object", "get", `${bucketName}/${remoteKey}`, "--file", localPath, "--remote"];
}

/** @param {string} bucketName @param {string} remoteKey */
export function buildR2DeleteArgs(bucketName, remoteKey) {
  return ["wrangler", "r2", "object", "delete", `${bucketName}/${remoteKey}`, "--remote", "--force"];
}

/**
 * GitHub Actions runs this without Nish's local safe-deploy wrapper, so keep the
 * scheduled production target pinned and explicitly approved in-repo.
 *
 * @param {{ databaseName: string; bucketName: string; env?: Record<string, string | undefined> }} input
 */
export function assertBackupAutomationApproval({ databaseName, bucketName, env = process.env }) {
  if (env.GITHUB_ACTIONS !== "true") return false;

  if (env.D1_BACKUP_AUTOMATION_APPROVED !== BACKUP_AUTOMATION_APPROVAL) {
    throw new Error("GitHub backup automation approval is missing or invalid.");
  }
  if (databaseName !== BACKUP_DATABASE_NAME) {
    throw new Error(`GitHub backup automation database must be ${BACKUP_DATABASE_NAME}.`);
  }
  if (bucketName !== BACKUP_BUCKET_NAME) {
    throw new Error(`GitHub backup automation bucket must be ${BACKUP_BUCKET_NAME}.`);
  }
  return true;
}

/**
 * @param {{
 *   databaseName: string;
 *   bucketName: string;
 *   automationApproved: boolean;
 *   env?: Record<string, string | undefined>;
 * }} input
 */
export function assertManualBackupApproval({
  databaseName,
  bucketName,
  automationApproved,
  env = process.env,
}) {
  if (automationApproved) return false;
  if (databaseName !== BACKUP_DATABASE_NAME || bucketName !== BACKUP_BUCKET_NAME) {
    throw new Error(`Manual backup target must be ${BACKUP_DATABASE_NAME} -> ${BACKUP_BUCKET_NAME}.`);
  }
  if (env.D1_BACKUP_MANUAL_APPROVED !== MANUAL_BACKUP_APPROVAL) {
    throw new Error(
      `Manual D1 backup approval is required: set D1_BACKUP_MANUAL_APPROVED=${MANUAL_BACKUP_APPROVAL}.`,
    );
  }
  return true;
}
