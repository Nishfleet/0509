// Empty unless a future destructive cleanup must intentionally run after a
// schema-compatible Worker deploy. Completed cleanups should not remain here.
/** @type {Set<string>} */
export const POST_DEPLOY_CLEANUP_MIGRATIONS = new Set();

/**
 * @param {string} output
 */
export function pendingMigrationNames(output) {
  return [...new Set(output.match(/\b\d{4}_[A-Za-z0-9_]+\.sql\b/g) ?? [])];
}

/**
 * @param {string} output
 */
export function blockingPendingMigrationNames(output) {
  return pendingMigrationNames(output).filter(
    (migrationName) => !POST_DEPLOY_CLEANUP_MIGRATIONS.has(migrationName),
  );
}

/**
 * @param {string} output
 */
export function hasOnlyPostDeployCleanupMigrations(output) {
  const pending = pendingMigrationNames(output);
  return pending.length > 0 && blockingPendingMigrationNames(output).length === 0;
}
