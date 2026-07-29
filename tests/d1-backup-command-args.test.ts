import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BACKUP_AUTOMATION_APPROVAL,
  BACKUP_BUCKET_NAME,
  BACKUP_DATABASE_NAME,
  MANUAL_BACKUP_APPROVAL,
  assertBackupAutomationApproval,
  assertManualBackupApproval,
  buildD1ExportArgs,
  buildBackupObjectKey,
  buildR2DeleteArgs,
  buildR2GetArgs,
  buildR2PutArgs,
  resolveBackupLocalDirectory,
} from "../scripts/d1-backup-command-args.mjs";
import {
  prepareBackupLocalDirectory,
  secureBackupLocalFile,
} from "../scripts/d1-backup-local-storage.mjs";

describe("D1 backup command arguments", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  it("keeps retained local backups outside the checkout", () => {
    vi.stubEnv("GITHUB_ACTIONS", "false");
    expect(resolveBackupLocalDirectory("/srv/runner-home")).toBe(
      "/srv/runner-home/.local/state/0509/backups/d1",
    );
  });

  it("enforces private modes on retained backup directories and files", async () => {
    const root = await mkdtemp(join(tmpdir(), "d1-backup-modes-"));
    temporaryDirectories.push(root);
    const directory = join(root, "retained");
    const file = join(directory, "0509.sql");

    await prepareBackupLocalDirectory(directory);
    await writeFile(file, "backup", { mode: 0o666 });
    await secureBackupLocalFile(file);

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("keeps remote D1 export confirmation unless an approval path opts out", () => {
    expect(buildD1ExportArgs("0509", "/tmp/backup.sql")).toEqual([
      "wrangler",
      "d1",
      "export",
      "0509",
      "--remote",
      "--output",
      "/tmp/backup.sql",
    ]);
  });

  it("skips interactive export confirmation only for approved automation", () => {
    expect(buildD1ExportArgs("0509", "/tmp/backup.sql", { skipConfirmation: true })).toEqual([
      "wrangler",
      "d1",
      "export",
      "0509",
      "--remote",
      "--skip-confirmation",
      "--output",
      "/tmp/backup.sql",
    ]);
  });

  it("uploads the exported file to the configured R2 backup prefix", () => {
    expect(buildR2PutArgs("0509-landing-page-artifacts", "backups/d1/file.sql", "/tmp/file.sql")).toEqual([
      "wrangler",
      "r2",
      "object",
      "put",
      "0509-landing-page-artifacts/backups/d1/file.sql",
      "--file",
      "/tmp/file.sql",
      "--remote",
    ]);
  });

  it("builds one canonical backup key plus remote get/delete commands", () => {
    expect(buildBackupObjectKey("0509", "2026-07-18T00-00-00-000Z")).toBe(
      "backups/d1/0509-2026-07-18T00-00-00-000Z.sql",
    );
    expect(buildR2GetArgs("bucket", "backups/d1/file.sql", "/tmp/file.sql")).toEqual([
      "wrangler", "r2", "object", "get", "bucket/backups/d1/file.sql", "--file", "/tmp/file.sql", "--remote",
    ]);
    expect(buildR2DeleteArgs("bucket", "backups/d1/file.sql")).toEqual([
      "wrangler", "r2", "object", "delete", "bucket/backups/d1/file.sql", "--remote", "--force",
    ]);
  });

  it("allows GitHub automation only for the pinned backup target", () => {
    const env = {
      GITHUB_ACTIONS: "true",
      D1_BACKUP_AUTOMATION_APPROVED: BACKUP_AUTOMATION_APPROVAL,
    };

    expect(
      assertBackupAutomationApproval({
        databaseName: BACKUP_DATABASE_NAME,
        bucketName: BACKUP_BUCKET_NAME,
        env,
      }),
    ).toBe(true);

    expect(() =>
      assertBackupAutomationApproval({
        databaseName: "other-db",
        bucketName: BACKUP_BUCKET_NAME,
        env,
      }),
    ).toThrow(`GitHub backup automation database must be ${BACKUP_DATABASE_NAME}.`);
  });

  it("blocks GitHub automation when the explicit approval marker is missing", () => {
    expect(() =>
      assertBackupAutomationApproval({
        databaseName: BACKUP_DATABASE_NAME,
        bucketName: BACKUP_BUCKET_NAME,
        env: { GITHUB_ACTIONS: "true" },
      }),
    ).toThrow("GitHub backup automation approval is missing or invalid.");
  });

  it("requires an explicit local manual approval marker before production D1 export", () => {
    expect(() =>
      assertManualBackupApproval({
        databaseName: BACKUP_DATABASE_NAME,
        bucketName: BACKUP_BUCKET_NAME,
        automationApproved: false,
        env: {},
      }),
    ).toThrow(`Manual D1 backup approval is required: set D1_BACKUP_MANUAL_APPROVED=${MANUAL_BACKUP_APPROVAL}.`);

    expect(
      assertManualBackupApproval({
        databaseName: BACKUP_DATABASE_NAME,
        bucketName: BACKUP_BUCKET_NAME,
        automationApproved: false,
        env: { D1_BACKUP_MANUAL_APPROVED: MANUAL_BACKUP_APPROVAL },
      }),
    ).toBe(true);
  });

  it("does not require local manual approval for approved GitHub automation", () => {
    expect(
      assertManualBackupApproval({
        databaseName: BACKUP_DATABASE_NAME,
        bucketName: BACKUP_BUCKET_NAME,
        automationApproved: true,
        env: {},
      }),
    ).toBe(false);
  });
});
