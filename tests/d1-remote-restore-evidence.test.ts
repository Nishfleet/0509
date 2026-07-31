import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import {
  assertAutomationContext,
  assertConfiguredProductionDatabase,
  assertExactR2Backup,
  assertMigrationLedgerMatchesRepository,
  assertRestoreRoundTrip,
  buildRemoteRestoreEvidence,
  buildScratchDatabaseName,
  cleanupScratchDatabaseNames,
  cleanupLocalRestoreTempDirectories,
  parseCreatedDatabaseUuid,
  parseWranglerJson,
  readOwnedBackupManifest,
  removeScratchDatabase,
  rethrowWithMigrationLedgerDiagnostics,
  resolveMaxSqlBytes,
  staleScratchDatabaseNames,
  sweepStaleScratchDatabases,
  withScratchCleanup,
} from "../scripts/d1-remote-restore-evidence.mjs";
import { buildRemoteRestoreCandidateManifest } from "../scripts/build-remote-restore-candidate-manifest.mjs";
import {
  collectDatabaseEvidence,
  currentRunScratchDatabaseNames,
  importSqlite,
} from "../scripts/d1-remote-restore-evidence-core.mjs";
import { selectRecentRemoteRestoreArtifact } from "../scripts/find-recent-remote-restore-artifact.mjs";

const fingerprint = "a".repeat(64);
const wranglerHash = "b".repeat(64);
const fileHash = "c".repeat(64);
const toyLedgerOptions = {
  baseline: ["0001_first.sql", "0002_second.sql"],
  retiredMigrations: new Set<string>(),
};

function aggregateEvidence() {
  return {
    integrity: "ok",
    foreignKeyViolations: 0,
    rowCounts: [
      { table: "d1_migrations", count: 2 },
      { table: "user_plan", count: 1 },
    ],
    rowCountDigestSha256: "d".repeat(64),
    schemaDigestSha256: "1".repeat(64),
    contentDigestSha256: "2".repeat(64),
    migrationLedger: [
      {
        id: 1,
        name: "0001_first.sql",
        appliedAt: "2026-07-01 00:00:00",
      },
      {
        id: 2,
        name: "0002_second.sql",
        appliedAt: "2026-07-02 00:00:00",
      },
    ],
    migrationLedgerSha256: "e".repeat(64),
    planRowCount: 1,
    dodoLinkedPlanRowCount: 1,
  };
}

describe("D1 remote restore evidence automation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forwards cancellation to a detached provider child before exiting", async () => {
    const root = mkdtempSync(join(tmpdir(), "0509-d1-cancel-"));
    const helper = join(root, "cancel-helper.mjs");
    const childPidFile = join(root, "provider.pid");
    const moduleUrl = pathToFileURL(
      resolve("scripts/d1-remote-restore-evidence.mjs"),
    ).href;
    writeFileSync(
      helper,
      [
        `import { runCaptured } from ${JSON.stringify(moduleUrl)};`,
        `await runCaptured(process.execPath, ["-e", ${JSON.stringify(
          [
            'const { writeFileSync } = require("node:fs");',
            "writeFileSync(process.argv[1], String(process.pid));",
            'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 250));',
            "setInterval(() => {}, 1_000);",
          ].join(""),
        )}, process.argv[2]]);`,
      ].join("\n"),
    );
    const helperProcess = spawn(process.execPath, [helper, childPidFile], {
      stdio: "ignore",
    });
    const completed = new Promise<{ code: number | null; signal: string | null }>(
      (resolveCompleted, reject) => {
        helperProcess.once("error", reject);
        helperProcess.once("close", (code, signal) => {
          resolveCompleted({ code, signal });
        });
      },
    );
    let childPid = 0;

    try {
      const deadline = Date.now() + 2_000;
      while (!existsSync(childPidFile)) {
        if (Date.now() >= deadline) throw new Error("provider child did not start");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      childPid = Number(readFileSync(childPidFile, "utf8"));
      expect(() => process.kill(childPid, 0)).not.toThrow();

      helperProcess.kill("SIGTERM");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      expect(() => process.kill(childPid, 0)).not.toThrow();

      expect(await completed).toEqual({ code: null, signal: "SIGTERM" });
      expect(() => process.kill(childPid, 0)).toThrow();
    } finally {
      helperProcess.kill("SIGKILL");
      if (Number.isInteger(childPid) && childPid > 0) {
        try {
          process.kill(-childPid, "SIGKILL");
        } catch {
          // The cancellation relay should already have reaped the child group.
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("wires exact-R2 retrieval and independent exact-run cleanup into Actions", () => {
    const script = readFileSync(
      "scripts/d1-remote-restore-evidence.mjs",
      "utf8",
    );
    const core = readFileSync(
      "scripts/d1-remote-restore-evidence-core.mjs",
      "utf8",
    );
    const workflow = parse(
      readFileSync(
        ".github/workflows/d1-remote-restore-evidence.yml",
        "utf8",
      ),
    ) as {
      on?: {
        workflow_dispatch?: unknown;
        schedule?: Array<{ cron?: string }>;
      };
      jobs?: {
        cleanup?: {
          env?: Record<string, string>;
          environment?: string;
          if?: string;
          needs?: string;
          steps?: Array<{
            name?: string;
            run?: string;
            with?: Record<string, unknown>;
          }>;
        };
        restore?: {
          env?: Record<string, string>;
          environment?: string;
          "timeout-minutes"?: number;
          steps?: Array<{ name?: string; run?: string }>;
        };
      };
    };
    expect(script).toContain("buildR2GetArgs(");
    expect(script).toContain(
      "importSqlite(sourceDatabasePath, sourceSql",
    );
    expect(script).not.toContain(
      "importSqlite(sourceDatabasePath, transformed.sql",
    );
    expect(script).toContain("removeOwnedLocalBackup(freshBackupPath)");
    expect(script).toContain(
      "remote_restore_local_backup_cleanup_incomplete",
    );
    expect(script.lastIndexOf("readOwnedBackupManifest(")).toBeLessThan(
      script.lastIndexOf("rmSync(root"),
    );
    expect(core).toContain("fresh_r2_backup_hash_mismatch");
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.on?.schedule).toEqual([
      { cron: "47 20 * * SUN,WED" },
    ]);
    expect(workflow.jobs?.restore?.environment).toBe("production");
    expect(workflow.jobs?.cleanup?.environment).toBe("production");
    expect(workflow.jobs?.cleanup?.if).toContain("always()");
    expect(workflow.jobs?.cleanup?.needs).toBe("restore");
    // startup_failure class (run 30584838622): job-level env cannot use the
    // runner context. Bind RUNNER_TEMP via a step → GITHUB_ENV instead.
    const workflowSource = readFileSync(
      ".github/workflows/d1-remote-restore-evidence.yml",
      "utf8",
    );
    expect(workflowSource).not.toMatch(
      /^[ \t]+[A-Z0-9_]+:[ \t]+\$\{\{[ \t]*runner\./m,
    );
    expect(workflowSource).toContain("runs-on: ubuntu-latest");
    expect(workflowSource).not.toContain("vars.RECOVERY_RUNNER");
    for (const [job, consumer] of [
      [
        workflow.jobs?.restore,
        "node scripts/d1-remote-restore-evidence.mjs",
      ],
      [
        workflow.jobs?.cleanup,
        "node scripts/d1-remote-restore-evidence.mjs --cleanup-only",
      ],
    ] as const) {
      expect(job?.env?.D1_BACKUP_LOCAL_DIRECTORY).toBeUndefined();
      for (const value of Object.values(job?.env ?? {})) {
        expect(String(value)).not.toContain("runner.");
      }
      const bindingIndex = job?.steps?.findIndex(
        (step) => step.name === "Bind run-scoped backup directory",
      ) ?? -1;
      expect(bindingIndex).toBeGreaterThanOrEqual(0);
      const bindingStep = job?.steps?.[bindingIndex];
      expect(bindingStep?.run).toContain("D1_BACKUP_LOCAL_DIRECTORY=%s");
      expect(bindingStep?.run).toContain(
        "$RUNNER_TEMP/0509-d1-backups-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}",
      );
      expect(bindingStep?.run).toContain('>> "$GITHUB_ENV"');
      const consumerIndex = job?.steps?.findIndex((step) =>
        step.run?.includes(consumer)
      ) ?? -1;
      expect(consumerIndex).toBeGreaterThan(bindingIndex);
      expect(job?.steps).toContainEqual(expect.objectContaining({
        run: "./scripts/deploy-window-lock.sh run -- npm ci --ignore-scripts",
      }));
      expect(job?.steps?.[consumerIndex]?.run).toContain(
        "./scripts/deploy-window-lock.sh run -- node scripts/d1-remote-restore-evidence.mjs",
      );
    }
    expect(workflow.jobs?.restore?.["timeout-minutes"]).toBe(300);
    expect(
      (workflow.jobs?.cleanup as any)?.steps?.[0]?.with?.clean,
    ).toBe(true);
    expect(workflow.jobs?.cleanup?.steps).toContainEqual(
      expect.objectContaining({
        run: "./scripts/deploy-window-lock.sh run -- node scripts/d1-remote-restore-evidence.mjs --cleanup-only --sweep-stale",
      }),
    );
  });

  it("retains and reuses private evidence without mutating GitHub secrets", () => {
    const deployWorkflow = readFileSync(
      ".github/workflows/deploy-production.yml",
      "utf8",
    );
    const prepareScript = readFileSync(
      "scripts/ci-prepare-remote-restore-evidence.sh",
      "utf8",
    );
    const manualWorkflow = readFileSync(
      ".github/workflows/d1-remote-restore-evidence.yml",
      "utf8",
    );
    const backupWorkflow = readFileSync(
      ".github/workflows/d1-backup-r2.yml",
      "utf8",
    );
    expect(deployWorkflow).toContain(
      "./scripts/ci-prepare-remote-restore-evidence.sh",
    );
    expect(prepareScript).toContain(
      "node scripts/find-recent-remote-restore-artifact.mjs",
    );
    expect(prepareScript).toContain("resolve_gh_bin()");
    expect(prepareScript).toContain(
      'tool_root="${DEPLOY_WINDOW_TOOL_ROOT:-/opt/0509-runner/bin}"',
    );
    expect(prepareScript).toContain('candidate="${tool_root}/gh"');
    expect(prepareScript).toContain('"$gh_bin" run download "$run_id"');
    expect(prepareScript).toContain(
      '[[ "$(tar -tvzf "${archives[0]}")" = -* ]]',
    );
    expect(prepareScript).toContain('tar -xOzf "${archives[0]}"');
    expect(prepareScript).toContain(
      "Recent private restore evidence is valid for this deploy.",
    );
    expect(deployWorkflow).not.toContain(
      "npm run restore:d1:remote-evidence",
    );
    expect(deployWorkflow).not.toContain(
      "D1_REMOTE_RESTORE_EVIDENCE_JSON",
    );
    expect(deployWorkflow).toContain("retention-days: 8");
    expect(manualWorkflow).toContain("retention-days: 8");
    expect(backupWorkflow).toContain("timeout-minutes: 300");
    expect(deployWorkflow).not.toContain("group: d1-production-export");
    expect(manualWorkflow).not.toContain("group: d1-production-export");
    expect(backupWorkflow).not.toContain("group: d1-production-export");
    expect(backupWorkflow).toContain(
      "run: ./scripts/deploy-window-lock.sh run -- node scripts/d1-backup-to-r2.mjs",
    );
    const backupScript = readFileSync(
      "scripts/d1-backup-to-r2.mjs",
      "utf8",
    );
    expect(backupScript).toContain("const PROVIDER_ATTEMPTS = 4");
    expect(backupScript).toContain("resolveBackupLocalDirectory()");
    expect(backupScript).not.toContain('resolve("backups/d1")');
    expect(backupScript).toContain("const D1_EXPORT_ATTEMPTS = 16");
    expect(backupScript).toContain(
      "const D1_EXPORT_RETRY_DELAY_CAP_MS = 300_000",
    );
    expect(backupScript).toContain("runProviderOperationWithRetry");
    expect(backupScript).toContain(
      "`${label} failed after ${attempts} attempts.`",
    );
    expect(backupScript).toContain("attempts: D1_EXPORT_ATTEMPTS");
    expect(backupScript).toContain(
      "delayCapMs: D1_EXPORT_RETRY_DELAY_CAP_MS",
    );
    expect(backupScript).toMatch(
      /if \(!localManifestPath\) \{\s+const entries =/u,
    );
    expect(backupScript).toContain("removePartialLocalExport");
    expect(backupScript).toContain(
      "D1 export failed and its partial local file could not be removed.",
    );
    expect(backupScript).toContain(
      "R2 upload failed and its unverified local export could not be removed.",
    );
    expect(backupScript).toContain(
      "buildR2PutArgs(bucketName, remoteKey, localPath)",
    );
    expect(deployWorkflow).not.toContain("gh secret set");
  });

  it("reuses artifacts only from successful same-repo trusted main runs", () => {
    const runId = 30423695493;
    const headSha = "9".repeat(40);
    const name = `d1-remote-restore-evidence-${headSha}-${runId}`;
    const trustedRun = {
      id: runId,
      status: "completed",
      conclusion: "success",
      head_branch: "main",
      head_sha: headSha,
      created_at: "2026-07-29T06:00:00.000Z",
      repository: { full_name: "nish3451/0509" },
      head_repository: { full_name: "nish3451/0509" },
      workflowFile: "deploy-production.yml",
    };
    const artifact = {
      id: 1,
      name,
      expired: false,
      workflow_run: {
        id: runId,
        head_branch: "main",
        head_sha: headSha,
      },
    };

    expect(
      selectRecentRemoteRestoreArtifact({
        currentRunId: 30423695500,
        runs: [trustedRun],
        artifactsByRun: { [runId]: [artifact] },
      }),
    ).toEqual({ runId, name });
    expect(
      selectRecentRemoteRestoreArtifact({
        currentRunId: 30423695500,
        runs: [{ ...trustedRun, workflowFile: "ci.yml" }],
        artifactsByRun: { [runId]: [artifact] },
      }),
    ).toBeNull();
    expect(
      selectRecentRemoteRestoreArtifact({
        currentRunId: 30423695500,
        runs: [
          {
            ...trustedRun,
            head_repository: { full_name: "attacker/fork" },
          },
        ],
        artifactsByRun: { [runId]: [artifact] },
      }),
    ).toBeNull();
    expect(
      selectRecentRemoteRestoreArtifact({
        currentRunId: 30423695500,
        runs: [trustedRun],
        artifactsByRun: {
          [runId]: [{ ...artifact, name: `${name}-forged` }],
        },
      }),
    ).toBeNull();
  });

  it("sweeps only run-scoped scratch names older than 24 hours", () => {
    const now = new Date("2026-07-29T06:00:00.000Z");
    expect(
      staleScratchDatabaseNames(
        [
          {
            name: "0509-restore-test-30423695493-1",
            createdAt: "2026-07-28T05:59:59.000Z",
          },
          {
            name: "0509-restore-test-30423695494-1",
            createdAt: "2026-07-29T05:00:00.000Z",
          },
          {
            name: "0509",
            createdAt: "2020-01-01T00:00:00.000Z",
          },
          {
            name: "0509-restore-test-manual",
            createdAt: "2020-01-01T00:00:00.000Z",
          },
        ],
        now,
      ),
    ).toEqual(["0509-restore-test-30423695493-1"]);
  });

  it("targets every scratch attempt for the current workflow run only", () => {
    expect(
      currentRunScratchDatabaseNames(
        [
          {
            name: "0509-restore-test-30423695493-1",
            uuid: "1",
            createdAt: null,
          },
          {
            name: "0509-restore-test-30423695493-2",
            uuid: "2",
            createdAt: null,
          },
          {
            name: "0509-restore-test-30423695494-1",
            uuid: "3",
            createdAt: null,
          },
          { name: "0509", uuid: "4", createdAt: null },
        ],
        "30423695493",
      ),
    ).toEqual([
      "0509-restore-test-30423695493-1",
      "0509-restore-test-30423695493-2",
    ]);
  });

  it("binds local backup cleanup to the child-owned private manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-backup-manifest-test-"));
    const backupDirectory = join(root, "backups", "d1");
    const manifestPath = join(root, "backup-local-manifest.json");
    const fileName = "0509-2026-07-29T04-38-02-954Z.sql";
    const localPath = join(backupDirectory, fileName);
    mkdirSync(backupDirectory, { recursive: true });
    try {
      writeFileSync(
        manifestPath,
        JSON.stringify({
          schemaVersion: 1,
          localPath,
          remoteKey: `backups/d1/${fileName}`,
        }),
      );
      expect(
        readOwnedBackupManifest(manifestPath, backupDirectory),
      ).toEqual({
        fileName,
        localPath,
        remoteKey: `backups/d1/${fileName}`,
      });

      writeFileSync(
        manifestPath,
        JSON.stringify({
          schemaVersion: 1,
          localPath: join(root, "other", fileName),
          remoteKey: `backups/d1/${fileName}`,
        }),
      );
      expect(() =>
        readOwnedBackupManifest(manifestPath, backupDirectory),
      ).toThrow("remote_restore_backup_manifest_invalid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes only current-run and stale strict local restore temp directories", () => {
    vi.stubEnv("GITHUB_ACTIONS", "false");
    const root = mkdtempSync(join(tmpdir(), "0509-local-cleanup-test-"));
    const current = join(
      root,
      "0509-remote-restore-30423695493-2-Ab12Cd",
    );
    const otherFresh = join(
      root,
      "0509-remote-restore-30423695494-1-Ef34Gh",
    );
    const stale = join(
      root,
      "0509-remote-restore-30423695495-1-Ij56Kl",
    );
    for (const path of [current, otherFresh, stale]) {
      mkdirSync(path);
      writeFileSync(join(path, "source.sql"), "private fixture");
    }
    utimesSync(stale, new Date("2020-01-01"), new Date("2020-01-01"));
    try {
      expect(
        cleanupLocalRestoreTempDirectories({
          runId: "30423695493",
          tempDirectory: root,
          now: new Date("2026-07-29T12:00:00.000Z"),
          sweepStale: true,
        }),
      ).toEqual([current, stale].sort());
      expect(existsSync(current)).toBe(false);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(otherFresh)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deletes a manifest-owned external backup before removing its temp directory", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-local-owned-cleanup-test-"));
    const backupDirectory = join(root, "retained");
    const current = join(
      root,
      "0509-remote-restore-30423695493-2-Ab12Cd",
    );
    const fileName = "0509-2026-07-29T04-38-02-954Z.sql";
    const localPath = join(backupDirectory, fileName);
    mkdirSync(backupDirectory);
    mkdirSync(current);
    writeFileSync(localPath, "private fixture");
    writeFileSync(
      join(current, "backup-local-manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        localPath,
        remoteKey: `backups/d1/${fileName}`,
      }),
    );
    try {
      expect(
        cleanupLocalRestoreTempDirectories({
          runId: "30423695493",
          tempDirectory: root,
          backupDirectory,
        }),
      ).toEqual([current]);
      expect(existsSync(localPath)).toBe(false);
      expect(existsSync(current)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deletes stale-run and prior-attempt temp directories against their owning backups", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-local-stale-cleanup-test-"));
    const tempDirectory = join(root, "temp");
    const backupRoot = join(root, "backups");
    const currentBackupDirectory = join(
      backupRoot,
      "0509-d1-backups-30423695493-2",
    );
    const priorAttemptBackupDirectory = join(
      backupRoot,
      "0509-d1-backups-30423695493-1",
    );
    const staleBackupDirectory = join(
      backupRoot,
      "0509-d1-backups-30423695495-1",
    );
    const priorAttempt = join(
      tempDirectory,
      "0509-remote-restore-30423695493-1-Ab12Cd",
    );
    const stale = join(
      tempDirectory,
      "0509-remote-restore-30423695495-1-Ij56Kl",
    );
    const fileName = "0509-2026-07-29T04-38-02-954Z.sql";
    const priorAttemptLocalPath = join(
      priorAttemptBackupDirectory,
      fileName,
    );
    const staleLocalPath = join(staleBackupDirectory, fileName);
    mkdirSync(currentBackupDirectory, { recursive: true });
    mkdirSync(priorAttemptBackupDirectory, { recursive: true });
    mkdirSync(staleBackupDirectory, { recursive: true });
    mkdirSync(priorAttempt, { recursive: true });
    mkdirSync(stale, { recursive: true });
    writeFileSync(priorAttemptLocalPath, "private fixture");
    writeFileSync(staleLocalPath, "private fixture");
    writeFileSync(
      join(priorAttempt, "backup-local-manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        localPath: priorAttemptLocalPath,
        remoteKey: `backups/d1/${fileName}`,
      }),
    );
    writeFileSync(
      join(stale, "backup-local-manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        localPath: staleLocalPath,
        remoteKey: `backups/d1/${fileName}`,
      }),
    );
    utimesSync(stale, new Date("2020-01-01"), new Date("2020-01-01"));
    try {
      expect(
        cleanupLocalRestoreTempDirectories({
          runId: "30423695493",
          tempDirectory,
          backupDirectory: currentBackupDirectory,
          now: new Date("2026-07-29T12:00:00.000Z"),
          sweepStale: true,
        }),
      ).toEqual([priorAttempt, stale].sort());
      expect(existsSync(priorAttemptLocalPath)).toBe(false);
      expect(existsSync(priorAttempt)).toBe(false);
      expect(existsSync(staleLocalPath)).toBe(false);
      expect(existsSync(stale)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves ownership metadata when an external backup cannot be deleted", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-local-failed-cleanup-test-"));
    const backupDirectory = join(root, "retained");
    const current = join(
      root,
      "0509-remote-restore-30423695493-2-Ab12Cd",
    );
    const fileName = "0509-2026-07-29T04-38-02-954Z.sql";
    const localPath = join(backupDirectory, fileName);
    mkdirSync(backupDirectory);
    mkdirSync(current);
    mkdirSync(localPath);
    const manifestPath = join(current, "backup-local-manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        localPath,
        remoteKey: `backups/d1/${fileName}`,
      }),
    );
    try {
      expect(() =>
        cleanupLocalRestoreTempDirectories({
          runId: "30423695493",
          tempDirectory: root,
          backupDirectory,
        }),
      ).toThrow("remote_restore_local_temp_cleanup_failed");
      expect(existsSync(localPath)).toBe(true);
      expect(existsSync(manifestPath)).toBe(true);
      expect(existsSync(current)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("computes stable SQLite schema/content/ledger evidence and detects mutations", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-evidence-core-test-"));
    const firstPath = join(root, "first.sqlite");
    const secondPath = join(root, "second.sqlite");
    const sql = `
      CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE user_plan (
        id TEXT PRIMARY KEY,
        dodo_payment_id TEXT,
        dodo_subscription_id TEXT,
        dodo_customer_id TEXT
      );
      CREATE TABLE sample_values (
        id INTEGER PRIMARY KEY,
        text_value TEXT,
        real_value REAL,
        blob_value BLOB,
        big_integer INTEGER
      );
      INSERT INTO d1_migrations VALUES
        (1, '0001_first.sql', '2026-07-01T00:00:00.000Z');
      INSERT INTO user_plan VALUES
        ('plan-1', 'payment-1', NULL, NULL);
      INSERT INTO sample_values VALUES
        (1, 'alpha', 1.5, X'00FF', 9223372036854775807);
    `;
    try {
      importSqlite(firstPath, sql);
      importSqlite(secondPath, sql);
      const first = collectDatabaseEvidence(firstPath);
      const equivalent = collectDatabaseEvidence(secondPath);
      expect(equivalent).toEqual(first);
      expect(first).toMatchObject({
        integrity: "ok",
        foreignKeyViolations: 0,
        planRowCount: 1,
        dodoLinkedPlanRowCount: 1,
      });

      importSqlite(
        secondPath,
        "UPDATE sample_values SET text_value = 'changed' WHERE id = 1;",
      );
      const changed = collectDatabaseEvidence(secondPath);
      expect(changed.rowCountDigestSha256).toBe(
        first.rowCountDigestSha256,
      );
      expect(changed.schemaDigestSha256).toBe(
        first.schemaDigestSha256,
      );
      expect(changed.contentDigestSha256).not.toBe(
        first.contentDigestSha256,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the exact R2 object differs from the local export", () => {
    expect(assertExactR2Backup("same", "same")).toBe(true);
    expect(() => assertExactR2Backup("local-export", "different-r2-object"))
      .toThrow("fresh_r2_backup_hash_mismatch");
  });

  it("uses a bounded configurable SQL ceiling with deployment headroom", () => {
    expect(resolveMaxSqlBytes({})).toBe(256 * 1024 * 1024);
    expect(
      resolveMaxSqlBytes({
        D1_REMOTE_RESTORE_MAX_SQL_BYTES: String(384 * 1024 * 1024),
      }),
    ).toBe(384 * 1024 * 1024);
    expect(() =>
      resolveMaxSqlBytes({ D1_REMOTE_RESTORE_MAX_SQL_BYTES: "unbounded" }),
    ).toThrow("remote_restore_max_sql_bytes_invalid");
    expect(() =>
      resolveMaxSqlBytes({
        D1_REMOTE_RESTORE_MAX_SQL_BYTES: String(512 * 1024 * 1024),
      }),
    ).toThrow("remote_restore_max_sql_bytes_invalid");
  });

  it("cleans up when provider creation succeeds but its output cannot be parsed", async () => {
    let providerCreationHappened = false;
    let cleanupCalls = 0;
    await expect(
      withScratchCleanup({
        create: async () => {
          providerCreationHappened = true;
          return parseCreatedDatabaseUuid("database created; malformed output");
        },
        use: async () => "unused",
        remove: async () => {
          cleanupCalls += 1;
        },
      }),
    ).rejects.toThrow("scratch_database_id_missing");
    expect(providerCreationHappened).toBe(true);
    expect(cleanupCalls).toBe(1);
  });

  it("preserves the primary restore error when exact cleanup also fails", async () => {
    const restoreError = new Error("provider_import_failed");
    const firstCleanupError = new Error("provider_delete_failed_once");
    const secondCleanupError = new Error("provider_delete_failed_twice");
    let cleanupCalls = 0;
    const failure = await withScratchCleanup({
      create: async () => "scratch-created",
      use: async () => {
        throw restoreError;
      },
      remove: async () => {
        cleanupCalls += 1;
        throw cleanupCalls === 1
          ? firstCleanupError
          : secondCleanupError;
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      message: "scratch_database_cleanup_failed_after_restore_failure",
      cause: restoreError,
      errors: [restoreError, firstCleanupError, secondCleanupError],
    });
  });

  it("accepts a verified restore when exact cleanup succeeds on retry", async () => {
    let cleanupCalls = 0;
    await expect(
      withScratchCleanup({
        create: async () => "scratch-created",
        use: async () => "round-trip-verified",
        remove: async () => {
          cleanupCalls += 1;
          if (cleanupCalls === 1) {
            throw new Error("transient_provider_delete_failure");
          }
        },
      }),
    ).resolves.toEqual({
      created: "scratch-created",
      result: "round-trip-verified",
      scratchRemoved: true,
    });
    expect(cleanupCalls).toBe(2);
  });

  it("deletes only the exact listed scratch UUID and verifies absence", async () => {
    const scratchName = "0509-restore-test-30423695493-1";
    const scratchUuid = "2a4e173d-34db-43c5-986d-4786efafd453";
    let listCalls = 0;
    let deletionConfig: Record<string, unknown> | null = null;
    const commands: string[][] = [];

    await expect(
      removeScratchDatabase(scratchName, {
        listDatabases: async () => {
          listCalls += 1;
          return listCalls === 1
            ? [{ name: scratchName, uuid: scratchUuid, createdAt: null }]
            : [];
        },
        runCommand: async (_command, args) => {
          commands.push(args);
          const configIndex = args.indexOf("--config");
          deletionConfig = JSON.parse(
            readFileSync(args[configIndex + 1], "utf8"),
          );
          return { stdout: "", stderr: "" };
        },
        wait: async () => {},
      }),
    ).resolves.toBe(true);

    expect(commands).toHaveLength(1);
    expect(commands[0].slice(0, 4)).toEqual([
      "wrangler",
      "d1",
      "delete",
      "RESTORE_DB",
    ]);
    expect(deletionConfig).toMatchObject({
      d1_databases: [
        {
          database_name: scratchName,
          database_id: scratchUuid,
        },
      ],
    });
    expect(listCalls).toBe(2);
  });

  it("fails the stale sweep when any exact stale database cannot be removed", async () => {
    const scratchName = "0509-restore-test-30423695493-1";
    const removed: string[] = [];
    await expect(
      sweepStaleScratchDatabases({
        listDatabases: async () => [
          {
            name: scratchName,
            uuid: "2a4e173d-34db-43c5-986d-4786efafd453",
            createdAt: "2020-01-01T00:00:00.000Z",
          },
        ],
        removeDatabase: async (name) => {
          removed.push(name);
          throw new Error("provider_delete_failed");
        },
        wait: async () => {},
      }),
    ).rejects.toThrow("scratch_database_cleanup_batch_failed");
    expect(removed).toEqual([scratchName, scratchName, scratchName]);
  });

  it("attempts every deduplicated scratch cleanup before aggregating failures", async () => {
    const attempted: string[] = [];
    const failure = cleanupScratchDatabaseNames(
      [
        "0509-restore-test-30423695493-2",
        "0509-restore-test-30423695493-1",
        "0509-restore-test-30423695493-2",
      ],
      {
        removeDatabase: async (name) => {
          attempted.push(name);
          if (name.endsWith("-1")) {
            throw new Error("first_delete_failed");
          }
        },
        wait: async () => {},
      },
    );
    await expect(failure).rejects.toMatchObject({
      message: "scratch_database_cleanup_batch_failed",
      errors: [
        expect.objectContaining({
          message: "remote_restore_cleanup_provider_failed",
          errors: [
            expect.objectContaining({ message: "first_delete_failed" }),
            expect.objectContaining({ message: "first_delete_failed" }),
            expect.objectContaining({ message: "first_delete_failed" }),
          ],
        }),
      ],
    });
    expect(attempted).toEqual([
      "0509-restore-test-30423695493-1",
      "0509-restore-test-30423695493-1",
      "0509-restore-test-30423695493-1",
      "0509-restore-test-30423695493-2",
    ]);
  });

  it("retries a transient mandatory cleanup provider failure", async () => {
    let attempts = 0;
    await expect(
      cleanupScratchDatabaseNames(
        ["0509-restore-test-30423695493-1"],
        {
          removeDatabase: async () => {
            attempts += 1;
            if (attempts === 1) {
              throw new Error("transient_delete_failure");
            }
          },
          wait: async () => {},
        },
      ),
    ).resolves.toEqual(["0509-restore-test-30423695493-1"]);
    expect(attempts).toBe(2);
  });

  it("builds only a clean exact-head manifest for the repository verifier", () => {
    const manifest = buildRemoteRestoreCandidateManifest({
      ok: true,
      headCommit: "9".repeat(40),
      fingerprint,
      status: { hasChanges: false },
      wrangler: {
        worktreeSha256: wranglerHash,
        worktreeSearchRolloutMode: "shadow",
      },
    });
    expect(manifest).toEqual({
      candidateFingerprint: fingerprint,
      headCommit: "9".repeat(40),
      postflight: {
        launchConfig: {
          wranglerWorktreeSha256: wranglerHash,
        },
      },
    });
    expect(() =>
      buildRemoteRestoreCandidateManifest({
        ok: true,
        headCommit: "9".repeat(40),
        fingerprint,
        status: { hasChanges: true },
        wrangler: {
          worktreeSha256: wranglerHash,
          worktreeSearchRolloutMode: "shadow",
        },
      }),
    ).toThrow("remote_restore_candidate_manifest_invalid");
  });

  it("requires the exact GitHub Actions approval context", () => {
    expect(() =>
      assertAutomationContext({
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "nish3451/0509",
        GITHUB_REF: "refs/heads/main",
        D1_REMOTE_RESTORE_AUTOMATION_APPROVED:
          "0509-remote-restore-evidence",
        GITHUB_RUN_ID: "30423695493",
      }),
    ).not.toThrow();

    expect(() =>
      assertAutomationContext({
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "nish3451/0509",
        GITHUB_REF: "refs/heads/main",
        D1_REMOTE_RESTORE_AUTOMATION_APPROVED: "wrong",
        GITHUB_RUN_ID: "30423695493",
      }),
    ).toThrow("remote_restore_automation_not_approved");
  });

  it("builds a bounded unique scratch database name", () => {
    expect(buildScratchDatabaseName("30423695493", "2")).toBe(
      "0509-restore-test-30423695493-2",
    );
    expect(() => buildScratchDatabaseName("../bad", "1")).toThrow(
      "remote_restore_run_identity_invalid",
    );
  });

  it("parses Wrangler machine output without accepting an invalid database id", () => {
    expect(
      parseWranglerJson(
        `notice\n[{"success":true,"finalBookmark":"bookmark-123456"}]\n`,
      ),
    ).toEqual([
      { success: true, finalBookmark: "bookmark-123456" },
    ]);

    expect(
      parseCreatedDatabaseUuid(`
        {
          "binding": "RESTORE_DB",
          "database_name": "0509-restore-test-1-1",
          "database_id": "2a4e173d-34db-43c5-986d-4786efafd453"
        }
      `),
    ).toBe("2a4e173d-34db-43c5-986d-4786efafd453");
    expect(() =>
      parseCreatedDatabaseUuid(`{"database_id":"not-a-uuid"}`),
    ).toThrow("scratch_database_id_missing");
  });

  it("fails closed when the scratch round trip changes any release aggregate", () => {
    const source = aggregateEvidence();
    expect(assertRestoreRoundTrip(source, structuredClone(source))).toBe(true);
    expect(() =>
      assertRestoreRoundTrip(source, {
        ...structuredClone(source),
        rowCounts: [
          { table: "d1_migrations", count: 2 },
          { table: "user_plan", count: 0 },
        ],
      }),
    ).toThrow("scratch_restore_row_counts_mismatch");
    expect(() =>
      assertRestoreRoundTrip(source, {
        ...structuredClone(source),
        schemaDigestSha256: "3".repeat(64),
      }),
    ).toThrow("scratch_restore_schema_mismatch");
    expect(() =>
      assertRestoreRoundTrip(source, {
        ...structuredClone(source),
        contentDigestSha256: "4".repeat(64),
      }),
    ).toThrow("scratch_restore_content_mismatch");
  });

  it("requires the complete ordered migration ledger, not only the latest name", () => {
    const ledger = aggregateEvidence().migrationLedger;
    expect(
      assertMigrationLedgerMatchesRepository(ledger, [
        "0001_first.sql",
        "0002_second.sql",
      ], undefined, toyLedgerOptions),
    ).toBe(true);
    expect(() =>
      assertMigrationLedgerMatchesRepository(
        [ledger[1]],
        ["0001_first.sql", "0002_second.sql"],
        undefined,
        toyLedgerOptions,
      ),
    ).toThrow("source_backup_migration_ledger_stale");
  });

  it("reports migration filenames only for a stale ledger and rethrows", () => {
    const ledger = aggregateEvidence().migrationLedger;
    const repository = ["0001_first.sql", "0002_second.sql"];
    const staleError = new Error("source_backup_migration_ledger_stale");
    const write = vi.fn();

    let thrown;
    try {
      rethrowWithMigrationLedgerDiagnostics(
        staleError,
        ledger,
        repository,
        write,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(staleError);
    expect(write.mock.calls).toEqual([
      [
        'source_backup_migration_ledger_names:["0001_first.sql","0002_second.sql"]',
      ],
      [
        'repository_migration_names:["0001_first.sql","0002_second.sql"]',
      ],
    ]);

    const unrelatedError = new Error("scratch_restore_content_mismatch");
    write.mockClear();
    thrown = undefined;
    try {
      rethrowWithMigrationLedgerDiagnostics(
        unrelatedError,
        ledger,
        repository,
        write,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(unrelatedError);
    expect(write).not.toHaveBeenCalled();
  });

  it("accepts exactly an allowlisted cleanup suffix before or after cleanup", () => {
    const ledger = aggregateEvidence().migrationLedger;
    const repository = [
      "0001_first.sql",
      "0002_second.sql",
      "0003_destructive_cleanup.sql",
    ];
    const cleanup = new Set(["0003_destructive_cleanup.sql"]);
    expect(
      assertMigrationLedgerMatchesRepository(
        ledger,
        repository,
        cleanup,
        toyLedgerOptions,
      ),
    ).toBe(true);
    expect(
      assertMigrationLedgerMatchesRepository(
        [
          ...ledger,
          {
            id: 3,
            name: "0003_destructive_cleanup.sql",
            appliedAt: "2026-07-03 00:00:00",
          },
        ],
        repository,
        cleanup,
        toyLedgerOptions,
      ),
    ).toBe(true);
    expect(() =>
      assertMigrationLedgerMatchesRepository(
        [ledger[0]],
        repository,
        cleanup,
        toyLedgerOptions,
      ),
    ).toThrow("source_backup_migration_ledger_stale");
  });

  it("binds the listed production database to the configured Worker D1 UUID", () => {
    const configured = {
      binding: "DB",
      name: "0509",
      uuid: "746c6e3d-782e-443a-82d6-28ca93a16294",
    };
    expect(
      assertConfiguredProductionDatabase(configured, {
        name: "0509",
        uuid: configured.uuid,
      }),
    ).toBe(true);
    expect(() =>
      assertConfiguredProductionDatabase(configured, {
        name: "0509",
        uuid: "2a4e173d-34db-43c5-986d-4786efafd453",
      }),
    ).toThrow("production_database_binding_identity_mismatch");
  });

  it("builds strict candidate-bound evidence after verified cleanup", () => {
    const aggregate = aggregateEvidence();
    const evidence = buildRemoteRestoreEvidence({
      candidate: {
        fingerprint,
        wrangler: {
          worktreeSha256: wranglerHash,
          worktreeSearchRolloutMode: "shadow",
          worktreeD1Database: {
            binding: "DB",
            name: "0509",
            uuid: "746c6e3d-782e-443a-82d6-28ca93a16294",
          },
        },
      },
      aggregate,
      sourceDumpSha256: fileHash,
      transformedSqlSha256: "f".repeat(64),
      productionDatabase: {
        name: "0509",
        uuid: "746c6e3d-782e-443a-82d6-28ca93a16294",
      },
      scratchDatabase: {
        name: "0509-restore-test-30423695493-1",
        uuid: "2a4e173d-34db-43c5-986d-4786efafd453",
      },
      databaseBookmark: "bookmark-123456",
      latestMigration: "0002_second.sql",
      migrationCount: 2,
      generatedAt: "2026-07-29T04:53:06.765Z",
      scratchDatabaseRemoved: true,
    });

    expect(evidence).toMatchObject({
      schemaVersion: 2,
      candidateFingerprint: fingerprint,
      wranglerWorktreeSha256: wranglerHash,
      latestMigration: "0002_second.sql",
      migrationCount: 2,
      migrationLedgerNames: ["0001_first.sql", "0002_second.sql"],
      migrationLedgerNamesSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      migrationLedgerBaselineSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      productionSearchRolloutMode: "shadow",
      integrity: "ok",
      foreignKeyViolations: 0,
      exactRowCounts: true,
      dodoLinkagePreserved: true,
      scratchDatabaseRemoved: true,
      schemaDigestSha256: "1".repeat(64),
      contentDigestSha256: "2".repeat(64),
    });
    expect(evidence.databaseIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.scratchDatabaseIdentitySha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});
