import { describe, expect, it, vi } from "vitest";

import { redactSensitiveOutput, runCommandRedacted } from "../scripts/safe-command-output.mjs";

async function waitFor(predicate: () => boolean) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 1_000) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("safe command output", () => {
  it("redacts signed URL query strings before logging provider command output", () => {
    const signedUrl =
      "https://example.r2.cloudflarestorage.com/dump.sql?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123";

    expect(redactSensitiveOutput(`download ${signedUrl}\n`)).toBe(
      "download https://example.r2.cloudflarestorage.com/dump.sql?[redacted]\n",
    );
  });

  it("leaves ordinary non-query output intact", () => {
    expect(redactSensitiveOutput("Backup complete.\n")).toBe("Backup complete.\n");
  });

  it("redacts stdout and stderr from the command runner before writing logs", async () => {
    let stdout = "";
    let stderr = "";
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    });

    try {
      await runCommandRedacted(process.execPath, [
        "-e",
        [
          "console.log('stdout https://example.r2.cloudflarestorage.com/dump.sql?X-Amz-Signature=abc123')",
          "console.error('stderr https://example.r2.cloudflarestorage.com/dump.sql?X-Amz-Credential=secret')",
        ].join(";"),
      ]);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(stdout).toContain("stdout https://example.r2.cloudflarestorage.com/dump.sql?[redacted]");
    expect(stderr).toContain("stderr https://example.r2.cloudflarestorage.com/dump.sql?[redacted]");
    expect(`${stdout}\n${stderr}`).not.toContain("X-Amz-Signature");
    expect(`${stdout}\n${stderr}`).not.toContain("X-Amz-Credential");
  });

  it("redacts failed command output and rejects without including sensitive output", async () => {
    let stderr = "";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    });

    let failure: unknown;
    try {
      try {
        await runCommandRedacted(process.execPath, [
          "-e",
          [
            "console.error('failed https://example.r2.cloudflarestorage.com/dump.sql?X-Amz-Signature=abc123')",
            "process.exit(7)",
          ].join(";"),
        ]);
      } catch (error) {
        failure = error;
      }
    } finally {
      stderrSpy.mockRestore();
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(`${process.execPath} exited with code 7`);
    expect((failure as Error & { safeStderr?: string }).safeStderr).toContain(
      "https://example.r2.cloudflarestorage.com/dump.sql?[redacted]",
    );
    expect((failure as Error & { safeStderr?: string }).safeStderr).not.toContain("X-Amz-Signature");
    expect(stderr).toContain("failed https://example.r2.cloudflarestorage.com/dump.sql?[redacted]");
    expect(stderr).not.toContain("X-Amz-Signature");
  });

  it("streams redacted complete lines before the child process exits", async () => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    });

    try {
      const run = runCommandRedacted(process.execPath, [
        "-e",
        [
          "process.stdout.write('progress https://example.r2.cloudflarestorage.com/dump.sql?X-Amz-Signature=abc123\\n')",
          "setTimeout(() => process.stderr.write('final https://example.r2.cloudflarestorage.com/dump.sql?X-Amz-Credential=secret\\n'), 100)",
          "setTimeout(() => process.exit(0), 150)",
        ].join(";"),
      ]).finally(() => {
        settled = true;
      });

      await waitFor(() => stdout.includes("progress https://example.r2.cloudflarestorage.com/dump.sql?[redacted]"));
      expect(settled).toBe(false);
      await run;
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(stderr).toContain("final https://example.r2.cloudflarestorage.com/dump.sql?[redacted]");
    expect(`${stdout}\n${stderr}`).not.toContain("X-Amz-Signature");
    expect(`${stdout}\n${stderr}`).not.toContain("X-Amz-Credential");
  });
});
