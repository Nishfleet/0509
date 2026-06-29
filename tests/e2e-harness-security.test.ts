import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("E2E harness security guardrails", () => {
  it("keeps captured auth state and browser artifacts out of Git", () => {
    const gitignore = readFileSync(".gitignore", "utf8");

    expect(gitignore).toContain("/.auth/");
    expect(gitignore).toContain("/test-results/");
    expect(gitignore).toContain("/playwright-report/");
  });

  it("does not configure production authenticated traces, screenshots, or videos", () => {
    const config = readFileSync("playwright.config.ts", "utf8");
    const prodAuthBlock = config.slice(config.indexOf('name: "prod-auth"'));

    expect(prodAuthBlock).toContain('storageState: authState');
    expect(prodAuthBlock).toContain('screenshot: "off"');
    expect(prodAuthBlock).toContain('trace: "off"');
    expect(prodAuthBlock).toContain('video: "off"');
  });

  it("does not reuse an already-running local server before fixture seeding", () => {
    const config = readFileSync("playwright.config.ts", "utf8");

    expect(config).toContain("reuseExistingServer: false");
  });

  it("requires internal account metadata before production authenticated smoke", () => {
    const captureScript = readFileSync("scripts/e2e-auth-capture.mjs", "utf8");
    const validateScript = readFileSync("scripts/e2e-validate-auth-state.mjs", "utf8");

    expect(captureScript).toContain("E2E_INTERNAL_ACCOUNT_EMAIL_SHA256");
    expect(captureScript).toContain("accountEmailSha256");
    expect(captureScript).toContain("storageStateSha256");
    expect(validateScript).toContain("E2E_INTERNAL_ACCOUNT_EMAIL_SHA256");
    expect(validateScript).toContain("authStateMetaPath");
    expect(validateScript).toContain("meta?.accountEmailSha256 !== expectedEmailHash");
    expect(validateScript).toContain("meta?.storageStateSha256 !== sha256(stateRaw)");
    expect(validateScript).toContain("meta?.capturedAt");
  });

  it("fails production auth-state validation without the expected account hash", () => {
    const dir = mkdtempSync(join(tmpdir(), "f9-auth-state-"));
    try {
      const statePath = join(dir, "state.json");
      const metaPath = join(dir, "state.meta.json");
      const expectedHash = "a".repeat(64);
      const stateJson = JSON.stringify({
        cookies: [{ domain: ".0509.io", name: "better-auth.session_token", value: "redacted" }],
      });
      const storageStateHash = sha256(stateJson);
      const freshCapturedAt = new Date().toISOString();
      writeFileSync(
        statePath,
        stateJson,
      );
      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: freshCapturedAt,
          storageStateSha256: storageStateHash,
        }),
      );

      const missingHash = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: { ...process.env, AUTH_STATE: statePath, AUTH_STATE_META: metaPath, E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: "" },
        encoding: "utf8",
      });
      expect(missingHash.status).toBe(1);
      expect(missingHash.stderr).toContain("E2E_INTERNAL_ACCOUNT_EMAIL_SHA256");

      const mismatch = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: "b".repeat(64),
        },
        encoding: "utf8",
      });
      expect(mismatch.status).toBe(1);
      expect(mismatch.stderr).toContain("expected internal non-customer account");

      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: freshCapturedAt,
          storageStateSha256: "c".repeat(64),
        }),
      );
      const stateMismatch = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
        },
        encoding: "utf8",
      });
      expect(stateMismatch.status).toBe(1);
      expect(stateMismatch.stderr).toContain("metadata does not match");

      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          storageStateSha256: storageStateHash,
        }),
      );
      const stale = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
        },
        encoding: "utf8",
      });
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain("Auth state is older");

      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: freshCapturedAt,
          storageStateSha256: storageStateHash,
        }),
      );
      const match = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
        },
        encoding: "utf8",
      });
      expect(match.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not add a production auth bypass route", () => {
    const authSource = readFileSync("app/lib/e2e-auth.server.ts", "utf8");

    expect(authSource).toContain("LOCAL_TEST_HOSTS");
    expect(authSource).toContain("PRODUCTION_HOST_PATTERN");
    expect(authSource).not.toContain("0509.io/app?");
    expect(authSource).not.toContain("magic-link/verify");
  });
});
