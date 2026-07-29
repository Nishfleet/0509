// Empty unless a future destructive cleanup must intentionally run after a
// schema-compatible Worker deploy. Completed cleanups should not remain here.
/** @type {Set<string>} */
export const POST_DEPLOY_CLEANUP_MIGRATIONS = new Set();

/**
 * A cleanup allowlist may remove only a contiguous migration suffix. Accept
 * both the pre-cleanup ledger and the fully applied ledger so the protected
 * deploy can land before destructive cleanup and closeout can follow safely.
 *
 * @param {string[]} repositoryMigrations
 * @param {Set<string>} cleanupMigrations
 * @returns {string[][]}
 */
export function allowedRemoteMigrationLedgers(
  repositoryMigrations,
  cleanupMigrations = POST_DEPLOY_CLEANUP_MIGRATIONS,
) {
  if (
    !Array.isArray(repositoryMigrations) ||
    repositoryMigrations.length === 0 ||
    repositoryMigrations.some(
      (name) => !/^\d{4}_[A-Za-z0-9_]+\.sql$/u.test(name),
    ) ||
    new Set(repositoryMigrations).size !== repositoryMigrations.length ||
    JSON.stringify([...repositoryMigrations].sort()) !==
      JSON.stringify(repositoryMigrations) ||
    !(cleanupMigrations instanceof Set)
  ) {
    throw new Error("migration_repository_ledger_invalid");
  }
  const cleanupNames = [...cleanupMigrations];
  if (cleanupNames.length === 0) return [[...repositoryMigrations]];
  const firstCleanupIndex = repositoryMigrations.findIndex((name) =>
    cleanupMigrations.has(name),
  );
  if (
    firstCleanupIndex < 1 ||
    cleanupNames.some((name) => !repositoryMigrations.includes(name)) ||
    repositoryMigrations
      .slice(firstCleanupIndex)
      .some((name) => !cleanupMigrations.has(name)) ||
    cleanupNames.length !== repositoryMigrations.length - firstCleanupIndex
  ) {
    throw new Error("post_deploy_cleanup_migration_allowlist_invalid");
  }
  return [
    [...repositoryMigrations],
    repositoryMigrations.slice(0, firstCleanupIndex),
  ];
}

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
