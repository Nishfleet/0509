import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const AUTOMATION_DIRECTORY_PREFIX = "0509-d1-backups";

/**
 * Require GitHub Actions dumps to live in the exact run-scoped runner temp
 * directory. Mode bits do not isolate jobs that share one OS account.
 *
 * @param {string} directoryPath
 * @param {Record<string, string | undefined>} env
 */
export function assertAutomationBackupLocalDirectory(
  directoryPath,
  env = process.env,
) {
  if (env.GITHUB_ACTIONS !== "true") return false;
  const runnerTemp = env.RUNNER_TEMP?.trim() ?? "";
  const runId = env.GITHUB_RUN_ID?.trim() ?? "";
  const runAttempt = env.GITHUB_RUN_ATTEMPT?.trim() ?? "";
  if (
    !runnerTemp ||
    !/^[1-9][0-9]{4,19}$/u.test(runId) ||
    !/^[1-9][0-9]{0,5}$/u.test(runAttempt)
  ) {
    throw new Error("backup_automation_local_directory_context_invalid");
  }
  const expected = join(
    resolve(runnerTemp),
    `${AUTOMATION_DIRECTORY_PREFIX}-${runId}-${runAttempt}`,
  );
  if (resolve(directoryPath) !== expected) {
    throw new Error("backup_automation_local_directory_invalid");
  }
  return true;
}

/**
 * Create or repair the retained-backup directory so production SQL dumps are
 * accessible only to the runner account.
 *
 * @param {string} directoryPath
 */
export async function prepareBackupLocalDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  await chmod(directoryPath, 0o700);
}

/**
 * Wrangler creates the export file, so enforce the private mode after every
 * successful export before inspecting, uploading, or retaining it.
 *
 * @param {string} filePath
 */
export async function secureBackupLocalFile(filePath) {
  await chmod(filePath, 0o600);
}

/**
 * Remove only the exact run-scoped Actions directory after every workflow
 * outcome. The strict identity check prevents a malformed variable from
 * widening the recursive deletion target.
 *
 * @param {string} directoryPath
 * @param {Record<string, string | undefined>} env
 */
export async function cleanupAutomationBackupLocalDirectory(
  directoryPath,
  env = process.env,
) {
  assertAutomationBackupLocalDirectory(directoryPath, env);
  await rm(resolve(directoryPath), { force: true, recursive: true });
  try {
    await stat(resolve(directoryPath));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return true;
    }
    throw error;
  }
  throw new Error("backup_automation_local_directory_cleanup_incomplete");
}

/**
 * Retry only Cloudflare's explicit pre-start export-busy response. Retrying
 * an auth, local I/O, generic network, or post-export failure can start a
 * second production export after the first one actually completed.
 *
 * @param {unknown} error
 */
export function isRetryableD1ExportBusyError(error) {
  const safeStderr =
    error &&
    typeof error === "object" &&
    "safeStderr" in error &&
    typeof error.safeStderr === "string"
      ? error.safeStderr
      : "";
  return (
    /\b(?:an(?:other)?\s+)?export(?:\s+(?:operation|job))?\s+is\s+(?:already\s+|currently\s+)?in progress\b/iu.test(
      safeStderr,
    ) ||
    /\bdatabase\s+is\s+(?:already\s+|currently\s+)?being exported\b/iu.test(
      safeStderr,
    )
  );
}
