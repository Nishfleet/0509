import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function makeIgnoredAuthStateDir(prefix: string) {
  const authDir = join(process.cwd(), ".auth");
  mkdirSync(authDir, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(authDir, prefix));
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
    const prodAuthSpec = readFileSync("e2e/prod-authenticated.spec.ts", "utf8");

    expect(captureScript).toContain("E2E_INTERNAL_ACCOUNT_EMAIL_SHA256");
    expect(captureScript).toContain("accountEmailSha256");
    expect(captureScript).toContain("storageStateSha256");
    expect(captureScript).toContain("resolveSafeAuthStatePath");
    expect(captureScript).toContain("defaultAuthStateMetaPath");
    expect(captureScript).toContain("AUTH_STATE_META must not point");
    expect(validateScript).toContain("E2E_INTERNAL_ACCOUNT_EMAIL_SHA256");
    expect(validateScript).toContain("authStateMetaPath");
    expect(validateScript).toContain("meta?.accountEmailSha256 !== expectedEmailHash");
    expect(validateScript).toContain("meta?.storageStateSha256 !== sha256(stateRaw)");
    expect(validateScript).toContain("meta?.capturedAt");
    expect(validateScript).toContain("assertPrivateFile(authStatePath");
    expect(validateScript).toContain("resolveSafeAuthStatePath");
    expect(prodAuthSpec).toContain("scripts/e2e-validate-auth-state.mjs");
    expect(prodAuthSpec).toContain("Production auth-state validation failed before browser launch");
  });

  it("refuses to capture production auth state into a trackable path", () => {
    const unsafeCapture = spawnSync("node", ["scripts/e2e-auth-capture.mjs"], {
      env: {
        ...process.env,
        AUTH_STATE: "0509-internal-auth.json",
        AUTH_STATE_META: "0509-internal-auth.meta.json",
        E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: "a".repeat(64),
      },
      encoding: "utf8",
    });

    expect(unsafeCapture.status).toBe(1);
    expect(unsafeCapture.stderr).toContain("AUTH_STATE must point under .auth/");
    expect(unsafeCapture.stderr).toContain("Refusing to write production auth material");
  });

  it("refuses to validate production auth state from a trackable path", () => {
    const statePath = "0509-internal-auth-trackable.json";
    const metaPath = "0509-internal-auth-trackable.meta.json";
    const expectedHash = "a".repeat(64);
    const stateJson = JSON.stringify({
      cookies: [{ domain: ".0509.io", name: "better-auth.session_token", value: "redacted" }],
    });
    try {
      writeFileSync(statePath, stateJson);
      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: new Date().toISOString(),
          origin: "https://0509.io",
          storageStateSha256: sha256(stateJson),
        }),
      );
      chmodSync(statePath, 0o600);
      chmodSync(metaPath, 0o600);

      const unsafeValidate = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
        },
        encoding: "utf8",
      });

      expect(unsafeValidate.status).toBe(1);
      expect(unsafeValidate.stderr).toContain("AUTH_STATE must point under .auth/");
      expect(unsafeValidate.stderr).toContain("Refusing to write production auth material");
    } finally {
      rmSync(statePath, { force: true });
      rmSync(metaPath, { force: true });
    }
  });

  it("rejects deployable ignored paths for production auth state", () => {
    const statePath = join("build", "client", "0509-internal-auth.json");
    const metaPath = join("build", "client", "0509-internal-auth.meta.json");
    const expectedHash = "a".repeat(64);
    const stateJson = JSON.stringify({
      cookies: [{ domain: ".0509.io", name: "better-auth.session_token", value: "redacted" }],
    });
    try {
      mkdirSync(join("build", "client"), { recursive: true });
      writeFileSync(statePath, stateJson);
      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: new Date().toISOString(),
          origin: "https://0509.io",
          storageStateSha256: sha256(stateJson),
        }),
      );
      chmodSync(statePath, 0o600);
      chmodSync(metaPath, 0o600);

      const unsafeValidate = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
        },
        encoding: "utf8",
      });

      expect(unsafeValidate.status).toBe(1);
      expect(unsafeValidate.stderr).toContain("AUTH_STATE must point under .auth/");
    } finally {
      rmSync(statePath, { force: true });
      rmSync(metaPath, { force: true });
    }
  });

  it("fails production auth-state validation without the expected account hash", () => {
    const dir = makeIgnoredAuthStateDir("f9-auth-state-");
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
          origin: "https://0509.io",
          storageStateSha256: storageStateHash,
        }),
      );
      chmodSync(statePath, 0o600);
      chmodSync(metaPath, 0o600);

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
          origin: "https://0509.io",
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
          origin: "https://0509.io",
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
          origin: "https://0509.io",
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

  it("fails production auth-state validation when auth state is absent or malformed", () => {
    const dir = makeIgnoredAuthStateDir("f9-auth-state-invalid-");
    try {
      const missingState = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: join(dir, "missing.json"),
          AUTH_STATE_META: join(dir, "missing.meta.json"),
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: "a".repeat(64),
        },
        encoding: "utf8",
      });
      expect(missingState.status).toBe(1);
      expect(missingState.stderr).toContain("Auth state is missing");

      const statePath = join(dir, "state.json");
      const metaPath = join(dir, "state.meta.json");
      writeFileSync(statePath, "{");
      writeFileSync(metaPath, "{}");
      chmodSync(statePath, 0o600);
      chmodSync(metaPath, 0o600);
      const invalidJson = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: "a".repeat(64),
        },
        encoding: "utf8",
      });
      expect(invalidJson.status).toBe(1);
      expect(invalidJson.stderr).toContain("Missing or invalid auth state");

      writeFileSync(statePath, JSON.stringify({ cookies: [] }));
      chmodSync(statePath, 0o600);
      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: "a".repeat(64),
          capturedAt: new Date().toISOString(),
          origin: "https://0509.io",
          storageStateSha256: sha256(JSON.stringify({ cookies: [] })),
        }),
      );
      chmodSync(metaPath, 0o600);
      const noSessionCookie = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: "a".repeat(64),
        },
        encoding: "utf8",
      });
      expect(noSessionCookie.status).toBe(1);
      expect(noSessionCookie.stderr).toContain("does not contain a 0509.io session cookie");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses a separate metadata path when AUTH_STATE has no json suffix", () => {
    const dir = makeIgnoredAuthStateDir("f9-auth-state-no-extension-");
    try {
      const statePath = join(dir, "state-without-extension");
      const metaPath = `${statePath}.meta.json`;
      const expectedHash = "a".repeat(64);
      const stateJson = JSON.stringify({
        cookies: [{ domain: ".0509.io", name: "better-auth.session_token", value: "redacted" }],
      });
      writeFileSync(statePath, stateJson);
      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: new Date().toISOString(),
          origin: "https://0509.io",
          storageStateSha256: sha256(stateJson),
        }),
      );
      chmodSync(statePath, 0o600);
      chmodSync(metaPath, 0o600);

      const noExtension = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
        },
        encoding: "utf8",
      });

      expect(noExtension.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid or future auth-state capture timestamps", () => {
    const dir = makeIgnoredAuthStateDir("f9-auth-state-time-");
    try {
      const statePath = join(dir, "state.json");
      const metaPath = join(dir, "state.meta.json");
      const expectedHash = "a".repeat(64);
      const stateJson = JSON.stringify({
        cookies: [{ domain: ".0509.io", name: "better-auth.session_token", value: "redacted" }],
      });
      writeFileSync(statePath, stateJson);
      chmodSync(statePath, 0o600);

      for (const [capturedAt, expectedMessage] of [
        ["not-a-date", "valid capturedAt timestamp"],
        [new Date(Date.now() + 10 * 60 * 1000).toISOString(), "capturedAt timestamp is in the future"],
      ] as const) {
        writeFileSync(
          metaPath,
          JSON.stringify({
            accountEmailSha256: expectedHash,
            capturedAt,
            origin: "https://0509.io",
            storageStateSha256: sha256(stateJson),
          }),
        );
        chmodSync(metaPath, 0o600);
        const result = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
          env: {
            ...process.env,
            AUTH_STATE: statePath,
            AUTH_STATE_META: metaPath,
            E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
          },
          encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(expectedMessage);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects group- or world-readable production auth state", () => {
    const dir = makeIgnoredAuthStateDir("f9-auth-state-perms-");
    try {
      const statePath = join(dir, "state.json");
      const metaPath = join(dir, "state.meta.json");
      const expectedHash = "a".repeat(64);
      const stateJson = JSON.stringify({
        cookies: [{ domain: ".0509.io", name: "better-auth.session_token", value: "redacted" }],
      });
      writeFileSync(statePath, stateJson);
      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: new Date().toISOString(),
          origin: "https://0509.io",
          storageStateSha256: sha256(stateJson),
        }),
      );
      chmodSync(statePath, 0o644);
      chmodSync(metaPath, 0o600);

      const readableState = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
        },
        encoding: "utf8",
      });

      expect(readableState.status).toBe(1);
      expect(readableState.stderr).toContain("readable only by the owner");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects auth-state metadata captured for a different origin", () => {
    const dir = makeIgnoredAuthStateDir("f9-auth-state-origin-");
    try {
      const statePath = join(dir, "state.json");
      const metaPath = join(dir, "state.meta.json");
      const expectedHash = "a".repeat(64);
      const stateJson = JSON.stringify({
        cookies: [{ domain: ".0509.io", name: "better-auth.session_token", value: "redacted" }],
      });
      writeFileSync(statePath, stateJson);
      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: new Date().toISOString(),
          origin: "https://wrong.0509.io",
          storageStateSha256: sha256(stateJson),
        }),
      );
      chmodSync(statePath, 0o600);
      chmodSync(metaPath, 0o600);

      const wrongOrigin = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
        },
        encoding: "utf8",
      });

      expect(wrongOrigin.status).toBe(1);
      expect(wrongOrigin.stderr).toContain("metadata origin does not match");
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
