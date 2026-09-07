import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const capture = await import("../scripts/e2e-auth-capture.mjs");
const validate = await import("../scripts/e2e-validate-auth-state.mjs");

const canonicalOrigin = "https://0509.io";
const rejectionMessage = `E2E_PROD_BASE_URL must be exactly ${canonicalOrigin}.`;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("production auth origin guard", () => {
  it.each([
    "http://0509.io",
    "https://www.0509.io",
    "https://0509.io.evil.example",
    "https://user:password@0509.io",
    "https://0509.io:443",
    "https://0509.io/app",
    "https://0509.io?redirect=/app",
    "https://0509.io#app",
  ])("rejects noncanonical base URL %s", (value) => {
    expect(() => capture.parseCanonicalProductionOrigin(value)).toThrow(rejectionMessage);
    expect(() => validate.parseCanonicalProductionOrigin(value)).toThrow(rejectionMessage);
  });

  it.each([canonicalOrigin, `${canonicalOrigin}/`])("accepts canonical base URL %s", (value) => {
    expect(capture.parseCanonicalProductionOrigin(value).origin).toBe(canonicalOrigin);
    expect(validate.parseCanonicalProductionOrigin(value).origin).toBe(canonicalOrigin);
  });

  it.each([
    "https://0509.io/app",
    "https://0509.io/app/projects?from=login#top",
  ])("permits same-origin auth redirect %s", (value) => {
    expect(capture.isAllowedAuthRedirect(value)).toBe(true);
  });

  it.each([
    "http://0509.io/app",
    "https://www.0509.io/app",
    "https://0509.io.evil.example/app",
    "https://user:password@0509.io/app",
    "https://0509.io:443/app",
    "https://0509.io/apple",
  ])("rejects auth redirect leaving the canonical origin: %s", (value) => {
    expect(capture.isAllowedAuthRedirect(value)).toBe(false);
  });

  it("fails closed before browser launch when capture receives a noncanonical origin", () => {
    const result = spawnSync("node", ["scripts/e2e-auth-capture.mjs"], {
      env: {
        ...process.env,
        E2E_PROD_BASE_URL: "https://0509.io:443",
        E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: "a".repeat(64),
        AUTH_STATE: ".auth/origin-guard-state.json",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(rejectionMessage);
    expect(result.stderr).not.toContain("Opening Five to Nine sign-in");
  });

  it("fails closed before reading auth state when validation receives a noncanonical origin", () => {
    const result = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
      env: {
        ...process.env,
        E2E_PROD_BASE_URL: "https://0509.io/login",
        E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: "a".repeat(64),
        AUTH_STATE: ".auth/origin-guard-state.json",
        AUTH_STATE_META: ".auth/origin-guard-state.meta.json",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(rejectionMessage);
    expect(result.stderr).not.toContain("Auth state is missing");
  });

  it("rejects session cookies scoped to a subdomain of the canonical host", () => {
    // mkdtemp requires its parent to exist. Create .auth here instead of
    // relying on a sibling test file to have created it as a side effect,
    // so this file passes standalone and in any file order.
    mkdirSync(join(process.cwd(), ".auth"), { recursive: true, mode: 0o700 });
    const dir = mkdtempSync(join(process.cwd(), ".auth", "origin-guard-"));
    const statePath = join(dir, "state.json");
    const metaPath = join(dir, "state.meta.json");
    const expectedHash = "a".repeat(64);
    const stateJson = JSON.stringify({
      cookies: [{ domain: "evil.0509.io", name: "better-auth.session_token", value: "redacted" }],
    });

    try {
      writeFileSync(statePath, stateJson);
      writeFileSync(
        metaPath,
        JSON.stringify({
          accountEmailSha256: expectedHash,
          capturedAt: new Date().toISOString(),
          origin: canonicalOrigin,
          storageStateSha256: sha256(stateJson),
        }),
      );
      chmodSync(statePath, 0o600);
      chmodSync(metaPath, 0o600);

      const result = spawnSync("node", ["scripts/e2e-validate-auth-state.mjs"], {
        env: {
          ...process.env,
          E2E_PROD_BASE_URL: canonicalOrigin,
          E2E_INTERNAL_ACCOUNT_EMAIL_SHA256: expectedHash,
          AUTH_STATE: statePath,
          AUTH_STATE_META: metaPath,
        },
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("does not contain a 0509.io session cookie");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
