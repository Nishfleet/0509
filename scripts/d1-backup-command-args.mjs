export const BACKUP_AUTOMATION_APPROVAL = "0509-weekly-d1-to-r2";
export const MANUAL_BACKUP_APPROVAL = "0509-manual-d1-export";
export const BACKUP_DATABASE_NAME = "0509";
export const BACKUP_BUCKET_NAME = "0509-landing-page-artifacts";

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
