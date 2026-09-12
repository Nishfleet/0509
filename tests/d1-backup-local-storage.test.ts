import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupAutomationBackupLocalDirectory,
  isRetryableD1ExportBusyError,
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

/** @param {string} safeStderr */
function busyError(safeStderr: string): Error {
  return Object.assign(new Error("npx_failed"), { safeStderr });
}

describe("isRetryableD1ExportBusyError", () => {
  it("retries the pinned wrangler's current export-busy wording, ANSI-decorated as observed in run 34697921342", () => {
    // Raw stderr captured from 0509 run 34697921342 (2026-09-12T13:59:24Z):
    // the run failed 2 s after the export started because no legacy wording
    // matched and the 16-attempt busy retry never fired.
    expect(
      isRetryableD1ExportBusyError(
        busyError(
          "\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m Currently processing a long-running export. Cannot start a new export until that completes or times out.\x1b[0m",
        ),
      ),
    ).toBe(true);
  });

  it("still retries the legacy export-busy wordings", () => {
    expect(
      isRetryableD1ExportBusyError(
        busyError("an export operation is already in progress"),
      ),
    ).toBe(true);
    expect(
      isRetryableD1ExportBusyError(busyError("Another export is in progress")),
    ).toBe(true);
    expect(
      isRetryableD1ExportBusyError(busyError("database is being exported")),
    ).toBe(true);
  });

  it("does not retry errors that are not the pre-start export-busy response", () => {
    expect(
      isRetryableD1ExportBusyError(
        busyError("✘ [ERROR] Authentication error [code: 10000]"),
      ),
    ).toBe(false);
    expect(
      isRetryableD1ExportBusyError(
        busyError("D1 export produced an empty file; not uploading."),
      ),
    ).toBe(false);
    expect(isRetryableD1ExportBusyError(new Error("no safeStderr here"))).toBe(
      false,
    );
    expect(isRetryableD1ExportBusyError(undefined)).toBe(false);
  });
});
