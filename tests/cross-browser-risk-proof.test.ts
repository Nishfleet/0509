import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const {
  REQUIRED_CROSS_BROWSER_RISK_SCOPES,
  validateCrossBrowserRiskManifest,
  validateCrossBrowserRiskProof,
} = await import("../scripts/verify-cross-browser-risk-proof.mjs");
const { RELEASE_COVERAGE_MATRIX, expectedReleaseArtifacts } = await import(
  "../scripts/playwright-release-manifest-reporter.mjs"
);

const fingerprint = "a".repeat(64);
const wranglerHash = "b".repeat(64);

function finalUrl(expected: any, viewport: string) {
  if (expected.exact) return expected.exact;
  const query = expected.search
    ? new URLSearchParams(expected.search).toString()
    : expected.searchKeys.map((key: string) => `${key}=e2e-${viewport}`).join("&");
  return `${expected.pathname}?${query}`;
}

function manifest(project: string, journeys: readonly number[]) {
  const releaseCoverageMatrix = RELEASE_COVERAGE_MATRIX as Readonly<Record<number, readonly any[]>>;
  const entries = journeys.flatMap((journey) => releaseCoverageMatrix[journey] ?? []).map((expected: any) => {
    const entry: any = {
      sourceFile: expected.sourceFile,
      browser: project.includes("firefox") ? "firefox" : project.includes("webkit") || project.includes("safari") ? "webkit" : "chromium",
      project,
      persona: expected.persona,
      scenario: expected.scenario,
      viewport: expected.viewport,
      finalUrl: finalUrl(expected.finalUrl, expected.viewport),
      status: "passed",
      retry: 0,
      firstAttempt: { status: "passed", passed: true, retry: 0 },
    };
    entry.artifacts = expectedReleaseArtifacts(entry).map((artifact: any) => ({
      kind: artifact.kind,
      state: artifact.state,
      name: `gate-b-artifacts/${fingerprint}/local-0123456789abcdef0123456789abcdef/${artifact.attachmentName}`,
      contentType: artifact.contentType,
      bytes: 9,
      sha256: "c".repeat(64),
    }));
    return entry;
  });
  return {
    schemaVersion: 3,
    candidateFingerprint: fingerprint,
    environment: "local",
    status: "passed",
    strict: true,
    entries,
    postflight: {
      journeys: [...journeys],
      releaseState: { count: 1 },
      fixtureState: { count: 1 },
      launchConfig: {
        identity: "d".repeat(64),
        wranglerWorktreeSha256: wranglerHash,
        productionSearchRolloutMode: "v2",
        localProofSearchRolloutMode: "v2",
        providerNetworkDeny: true,
        authProvider: "better-auth",
        browserProject: project,
        retries: 0,
        workers: 1,
      },
      scratchRestore: {
        sourceDumpSha256: "e".repeat(64),
        transformedSqlSha256: "f".repeat(64),
        integrity: "ok",
        foreignKeyViolations: 0,
        exactRowCounts: true,
        dodoLinkagePreserved: true,
        scratchDatabaseRemoved: true,
      },
      isolatedPersistenceRemoved: true,
    },
  };
}

const candidate = {
  ok: true,
  fingerprint,
  branch: "main",
  baseCommit: "1".repeat(40),
  headCommit: "1".repeat(40),
  status: { hasChanges: false },
  wrangler: { worktreeSha256: wranglerHash },
};

describe("risk-based cross-browser release proof", () => {
  it("installs every browser engine required by the protected-main deploy gate", () => {
    const workflow = readFileSync(resolve(".github/workflows/deploy-production.yml"), "utf8");
    expect(workflow).toContain(
      "npx playwright install chromium firefox webkit",
    );
  });

  it("accepts the frozen representative browser and journey matrix", () => {
    const manifests = Object.fromEntries(
      Object.entries(REQUIRED_CROSS_BROWSER_RISK_SCOPES).map(([project, journeys]) => [
        project,
        manifest(project, journeys as readonly number[]),
      ]),
    );
    expect(validateCrossBrowserRiskProof({ manifests, candidate, validateFiles: false })).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("accepts an exact clean pre-merge release candidate", () => {
    const project = "local-release-firefox";
    const journeys = REQUIRED_CROSS_BROWSER_RISK_SCOPES[project];
    expect(validateCrossBrowserRiskManifest({
      manifest: manifest(project, journeys),
      project,
      journeys,
      candidate: { ...candidate, branch: "codex/customer-readiness-inventory-closeout" },
      validateFiles: false,
    })).toEqual({ ok: true, issues: [] });
  });

  it("rejects a passing manifest from the wrong browser project", () => {
    const project = "local-release-webkit";
    const journeys = REQUIRED_CROSS_BROWSER_RISK_SCOPES[project];
    const evidence = manifest(project, journeys);
    evidence.postflight.launchConfig.browserProject = "local-release";
    expect(validateCrossBrowserRiskManifest({
      manifest: evidence,
      project,
      journeys,
      candidate,
      validateFiles: false,
    })).toMatchObject({ ok: false, issues: expect.arrayContaining(["postflight_config_identity"]) });
  });

  it("rejects candidate drift and a missing required browser manifest", () => {
    const manifests = Object.fromEntries(
      Object.entries(REQUIRED_CROSS_BROWSER_RISK_SCOPES).map(([project, journeys]) => [
        project,
        manifest(project, journeys as readonly number[]),
      ]),
    );
    delete manifests["local-release-firefox"];
    expect(validateCrossBrowserRiskProof({
      manifests,
      candidate: { ...candidate, fingerprint: "9".repeat(64) },
      validateFiles: false,
    })).toMatchObject({ ok: false });
  });
});
