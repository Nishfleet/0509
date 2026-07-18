import { describe, expect, it } from "vitest";

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
} from "../scripts/d1-backup-command-args.mjs";

describe("D1 backup command arguments", () => {
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
