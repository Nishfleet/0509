#!/usr/bin/env node

import { resolveBackupLocalDirectory } from "./d1-backup-command-args.mjs";
import { cleanupAutomationBackupLocalDirectory } from "./d1-backup-local-storage.mjs";

try {
  await cleanupAutomationBackupLocalDirectory(resolveBackupLocalDirectory());
  process.stdout.write("Run-scoped D1 backup files removed.\n");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "backup_local_cleanup_failed"}\n`,
  );
  process.exitCode = 1;
}
