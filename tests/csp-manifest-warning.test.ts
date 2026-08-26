import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  collectReactRouterManifestCspWarnings,
  isReactRouterManifestCspWarning,
  REACT_ROUTER_MANIFEST_PATH as AUDIT_MANIFEST_PATH,
} from "../e2e/csp-manifest-warning.mjs";
import { REACT_ROUTER_MANIFEST_PATH } from "../workers/security-headers";

const WAVE1_FIREFOX_WARNING = `Content-Security-Policy: (Report-Only policy) The page's settings would
block the loading of a resource (connect-src) at
https://0509.io/__manifest?paths=%2F%2C%2Fauth%2C%2Fauth%2F…`;

describe("React Router __manifest CSP warning classifier", () => {
  it("recognizes the wave-1 Firefox Report-Only connect-src warning", () => {
    expect(REACT_ROUTER_MANIFEST_PATH).toBe("/__manifest");
    expect(AUDIT_MANIFEST_PATH).toBe(REACT_ROUTER_MANIFEST_PATH);
    expect(isReactRouterManifestCspWarning(WAVE1_FIREFOX_WARNING)).toBe(true);
  });

  it("ignores unrelated console noise", () => {
    expect(isReactRouterManifestCspWarning("Failed to load resource")).toBe(false);
    expect(isReactRouterManifestCspWarning("Content-Security-Policy: script-src blocked https://evil.example/x.js")).toBe(
      false,
    );
    expect(isReactRouterManifestCspWarning("")).toBe(false);
  });

  it("collects console text and securitypolicyviolation events for the canary sweep", () => {
    const collected = collectReactRouterManifestCspWarnings({
      consoleMessages: [
        { text: WAVE1_FIREFOX_WARNING },
        { text: "unrelated" },
      ],
      violations: [
        {
          blockedURI: `https://0509.io${REACT_ROUTER_MANIFEST_PATH}?paths=%2Fauth`,
          violatedDirective: "connect-src",
          disposition: "report",
        },
        {
          blockedURI: "https://siterep.net/api/public/config",
          violatedDirective: "connect-src",
          disposition: "enforce",
        },
      ],
    });
    expect(collected).toHaveLength(2);
  });

  it("keeps the visual-defect audit wired to the classifier and the violation listener", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../e2e/visual-defect-audit.mjs", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("collectReactRouterManifestCspWarnings");
    expect(source).toContain("installCspViolationListener");
    expect(source).toContain("securitypolicyviolation");
  });
});
