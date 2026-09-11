import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupAutomationBackupLocalDirectory,
  prepareBackupLocalDirectory,
} from "../scripts/d1-backup-local-storage.mjs";

describe("D1 backup local storage cleanup", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }).catch(() => undefined),
      ),
    );
  });

  async function makeTemporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "d1-backup-local-"));
    temporaryDirectories.push(directory);
    return directory;
  }

  it("refuses to delete when GITHUB_ACTIONS is not \"true\" (the retained local backup directory survives)", async () => {
    const directory = await makeTemporaryDirectory();
    const retainedDirectory = join(
      directory,
      ".local",
      "state",
      "0509",
      "backups",
      "d1",
    );
    await prepareBackupLocalDirectory(retainedDirectory);

    await expect(
      cleanupAutomationBackupLocalDirectory(retainedDirectory, {}),
    ).rejects.toThrow();
    await expect(
      (await import("node:fs/promises")).stat(retainedDirectory),
    ).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("refuses to delete a run-scoped directory when GITHUB_ACTIONS is not \"true\"", async () => {
    const directory = await makeTemporaryDirectory();
    const runScopedDirectory = join(directory, "0509-d1-backups-123456-1");
    await prepareBackupLocalDirectory(runScopedDirectory);

    await expect(
      cleanupAutomationBackupLocalDirectory(runScopedDirectory, {}),
    ).rejects.toThrow();
  });

  it("refuses to delete a non-run-scoped directory even when GITHUB_ACTIONS is \"true\"", async () => {
    const directory = await makeTemporaryDirectory();
    const retainedDirectory = join(
      directory,
      ".local",
      "state",
      "0509",
      "backups",
      "d1",
    );
    await prepareBackupLocalDirectory(retainedDirectory);

    await expect(
      cleanupAutomationBackupLocalDirectory(retainedDirectory, {
        GITHUB_ACTIONS: "true",
        RUNNER_TEMP: directory,
        GITHUB_RUN_ID: "123456",
        GITHUB_RUN_ATTEMPT: "1",
      }),
    ).rejects.toThrow();
    await expect(
      (await import("node:fs/promises")).stat(retainedDirectory),
    ).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("deletes only the exact run-scoped Actions directory when GITHUB_ACTIONS is \"true\"", async () => {
    const runnerTemp = await makeTemporaryDirectory();
    const runScopedDirectory = join(runnerTemp, "0509-d1-backups-123456-1");
    await prepareBackupLocalDirectory(runScopedDirectory);

    await expect(
      cleanupAutomationBackupLocalDirectory(runScopedDirectory, {
        GITHUB_ACTIONS: "true",
        RUNNER_TEMP: runnerTemp,
        GITHUB_RUN_ID: "123456",
        GITHUB_RUN_ATTEMPT: "1",
      }),
    ).resolves.toBe(true);

    const { stat } = await import("node:fs/promises");
    await expect(stat(runScopedDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses a run-scoped-looking directory outside RUNNER_TEMP when GITHUB_ACTIONS is \"true\"", async () => {
    const directory = await makeTemporaryDirectory();
    const impostorDirectory = join(directory, "0509-d1-backups-123456-1");
    await prepareBackupLocalDirectory(impostorDirectory);

    await expect(
      cleanupAutomationBackupLocalDirectory(impostorDirectory, {
        GITHUB_ACTIONS: "true",
        RUNNER_TEMP: join(directory, "elsewhere"),
        GITHUB_RUN_ID: "123456",
        GITHUB_RUN_ATTEMPT: "1",
      }),
    ).rejects.toThrow();
  });
});
