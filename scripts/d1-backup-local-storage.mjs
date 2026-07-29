import { chmod, mkdir } from "node:fs/promises";

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
