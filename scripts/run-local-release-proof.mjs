#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFixtureInvariants,
  assertReleaseState,
  isolatedReleasePersistPath,
  fixtureInvariantQuery,
  fixtureReleaseStateQuery,
  parseWranglerQueryOutput,
  postflightFixtureExpectations,
  releaseStateReadyForAssertion,
  remainingE2ePostflightQueryTimeout,
  resolveE2ePostflightQueryTimeout,
  resolveE2ePostflightTimeout,
  resolveE2ePersistPath,
} from "./e2e-local-fixture.mjs";
import {
  markManifestFailed,
  recordManifestPostflight,
  resolveOutputPath,
  supportsReleaseCoverage,
  writePreflightManifest,
} from "./playwright-release-manifest-reporter.mjs";
import {
  createLocalReleaseServerIdentity,
  reserveLocalReleaseOrigin,
  resolveLocalReleaseRunTimeout,
} from "./local-release-server.mjs";
import { runLocalD1ScratchRestore } from "./e2e-local-restore-drill.mjs";
import {
  resolveReleaseCandidateBase,
  resolveReleaseProofInvocation,
  resolveReleaseProofProject,
} from "../e2e/helpers/release-scope.mjs";

const root = process.cwd();
let journeyScope;
let diagnosticSubset;
let releaseProject;
try {
  ({ journeys: journeyScope, diagnosticSubset } = resolveReleaseProofInvocation(
    process.argv.slice(2),
    process.env,
  ));
  releaseProject = resolveReleaseProofProject(process.env);
} catch (error) {
  process.stderr.write(
    `release proof refused: ${error instanceof Error ? error.message : "invalid_release_journey_scope"}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `${diagnosticSubset ? "diagnostic subset" : "canonical release"} proof journey scope: ${journeyScope.join(",")} (${releaseProject})\n`,
);
if (!supportsReleaseCoverage(journeyScope)) {
  process.stderr.write("release proof refused: coverage_scope_unsupported\n");
  process.exit(1);
}
const base = resolveReleaseCandidateBase(process.env);
const candidateScript = resolve(root, "scripts/customer-readiness-candidate.mjs");
const playwright = resolve(root, "node_modules/.bin/playwright");
const localStateQueryScript = resolve(root, "scripts/e2e-local-state-query.mjs");
const serverIdentity = createLocalReleaseServerIdentity();
const persistPath = resolveE2ePersistPath(
  root,
  isolatedReleasePersistPath(serverIdentity),
);
let postflightTimeout;
let postflightQueryTimeout;
try {
  postflightTimeout = resolveE2ePostflightTimeout(process.env.E2E_POSTFLIGHT_TIMEOUT_MS);
  postflightQueryTimeout = resolveE2ePostflightQueryTimeout(process.env.E2E_POSTFLIGHT_QUERY_TIMEOUT_MS);
} catch {
  process.stderr.write("release proof refused: invalid_postflight_timeout\n");
  process.exit(1);
}

function queryLocalState(sql, queryTimeout, timeoutError, failedError) {
  const result = spawnSync(
    process.execPath,
    [localStateQueryScript, persistPath.absolutePath],
    {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      input: sql,
      stdio: ["pipe", "pipe", "inherit"],
      timeout: queryTimeout,
      killSignal: "SIGTERM",
    },
  );
  if (result.error?.code === "ETIMEDOUT") throw new Error(timeoutError);
  if (result.error || result.status !== 0) throw new Error(failedError);
  try {
    return JSON.parse((result.stdout ?? "").trim());
  } catch {
    throw new Error(failedError);
  }
}

function queryReleaseState(releaseStartedAt, queryTimeout) {
  return queryLocalState(
    fixtureReleaseStateQuery(releaseStartedAt),
    queryTimeout,
    "release_state_query_timeout",
    "release_state_query_failed",
  );
}

function queryFixtureState(queryTimeout) {
  return queryLocalState(
    fixtureInvariantQuery(),
    queryTimeout,
    "fixture_invariant_query_timeout",
    "fixture_invariant_query_failed",
  );
}

async function verifyReleaseState(releaseStartedAt) {
  const deadline = Date.now() + postflightTimeout;
  const remainingQueryTimeout = () =>
    remainingE2ePostflightQueryTimeout(deadline, postflightQueryTimeout);
  let row = queryReleaseState(releaseStartedAt, remainingQueryTimeout());
  while (!releaseStateReadyForAssertion(row, journeyScope)) {
    const remaining = Math.floor(deadline - Date.now());
    if (remaining < 1) {
      // The assertion reports only bounded aggregate counts. Keep the
      // isolated database disposable while making a deterministic state
      // mismatch distinguishable from process/query latency.
      assertReleaseState(row, journeyScope);
      throw new Error("release_state_timeout");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(250, remaining)));
    if (Date.now() >= deadline) {
      assertReleaseState(row, journeyScope);
      throw new Error("release_state_timeout");
    }
    row = queryReleaseState(releaseStartedAt, remainingQueryTimeout());
  }
  assertReleaseState(row, journeyScope);
  const fixtureState = queryFixtureState(remainingQueryTimeout());
  assertFixtureInvariants(fixtureState, postflightFixtureExpectations(journeyScope));
  const scratchRestore = runLocalD1ScratchRestore({
    persistPath: persistPath.absolutePath,
    outputRoot: resolve(root, "test-results"),
  });
  return { releaseState: row, fixtureState, scratchRestore };
}

function launchConfigEvidence(candidateState) {
  const config = {
    wranglerWorktreeSha256: candidateState?.wrangler?.worktreeSha256,
    productionSearchRolloutMode: candidateState?.wrangler?.worktreeSearchRolloutMode,
    localProofSearchRolloutMode: "v2",
    providerNetworkDeny: true,
    authProvider: "better-auth",
    retries: 0,
    workers: 1,
    browserProject: releaseProject,
  };
  if (
    typeof config.wranglerWorktreeSha256 !== "string" ||
    config.productionSearchRolloutMode !== "v2"
  ) {
    throw new Error("release_config_identity_unavailable");
  }
  return {
    ...config,
    identity: createHash("sha256").update(JSON.stringify(config)).digest("hex"),
  };
}

function candidate(extraArgs = []) {
  let output;
  try {
    output = execFileSync(process.execPath, [candidateScript, "--base", base, ...extraArgs], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (error) {
    output = typeof error?.stdout === "string" ? error.stdout : "";
  }
  try {
    return JSON.parse(output.trim());
  } catch {
    return { ok: false, blockers: ["candidate_identity_unavailable"] };
  }
}

let manifestPath;
const manifestRelativePath = process.env.E2E_RELEASE_MANIFEST_PATH || `test-results/gate-b-manifest-${releaseProject}-${serverIdentity}.json`;
try {
  manifestPath = resolveOutputPath({ outputPath: manifestRelativePath });
  rmSync(manifestPath, { force: true });
  writePreflightManifest(manifestPath, {
    candidateFingerprint: null,
    environment: "local",
    runOrigin: null,
    serverIdentity: null,
  });
} catch {
  process.stderr.write("release proof refused: invalid_release_manifest_path\n");
  process.exit(1);
}

const before = candidate();
if (!before.ok || typeof before.fingerprint !== "string") {
  process.stderr.write(`release proof refused: ${(before.blockers ?? ["candidate_identity_unavailable"]).join(",")}\n`);
  process.exit(1);
}

let serverReservation;
try {
  serverReservation = await reserveLocalReleaseOrigin();
} catch {
  process.stderr.write("release proof refused: isolated_local_origin_unavailable\n");
  process.exit(1);
}
let runTimeout;
try {
  runTimeout = resolveLocalReleaseRunTimeout(process.env.E2E_RELEASE_RUN_TIMEOUT_MS);
} catch {
  await serverReservation.release();
  process.stderr.write("release proof refused: invalid_browser_run_timeout\n");
  process.exit(1);
}
try {
  writePreflightManifest(manifestPath, {
    candidateFingerprint: before.fingerprint,
    environment: "local",
    runOrigin: serverReservation.origin,
    serverIdentity,
  });
} catch {
  await serverReservation.release();
  process.stderr.write("release proof refused: invalid_release_manifest_path\n");
  process.exit(1);
}

const releaseStartedAt = new Date().toISOString();
try {
  await serverReservation.release();
} catch {
  markManifestFailed(manifestPath, "origin_release_failed");
  process.stderr.write("release proof refused: isolated_local_origin_release_failed\n");
  process.exit(1);
}
const run = spawnSync(
  playwright,
  [
    "test",
    ...journeyScope.map((journey) => `e2e/journey-${journey}-release.spec.ts`),
    "--config=playwright.config.ts",
    `--project=${releaseProject}`,
    // Canonical (chromium) proofs stay strict at zero retries. Diagnostic
    // cross-browser subsets keep retries for residual single-engine flakes,
    // but the primary budget lives on playwright.config.ts diagnostic
    // engine projects (60s): nightly run 31236680609 showed mobile-safari
    // J1 desktop systematically at ~31–33s, so retries alone never recover.
    // CLI --retries beats playwright.config, so this remains the knob.
    `--retries=${diagnosticSubset ? 2 : 0}`,
    "--workers=1",
    // Issue #1727: append the release-manifest reporter on top of the
    // configured reporters instead of overriding them in playwright.config.
    // The reporter's strict mode is its constructor default, so the flag's
    // no-options form is sufficient.
    "--add-reporter=./scripts/playwright-release-manifest-reporter.mjs",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      E2E_START_LOCAL_SERVER: "1",
      E2E_PERSIST_PATH: persistPath.relativePath,
      E2E_RELEASE_STRICT: "1",
      E2E_PROVIDER_NETWORK_DENY: "1",
      E2E_BASE_URL: serverReservation.origin,
      PLAYWRIGHT_RELEASE_CANDIDATE_FINGERPRINT: before.fingerprint,
      PLAYWRIGHT_RELEASE_MANIFEST_PATH: manifestRelativePath,
      PLAYWRIGHT_RELEASE_ENV: "local",
      PLAYWRIGHT_RELEASE_ORIGIN: serverReservation.origin,
      PLAYWRIGHT_RELEASE_SERVER_ID: serverIdentity,
      E2E_RELEASE_JOURNEYS: journeyScope.join(","),
    },
    timeout: runTimeout,
    killSignal: "SIGTERM",
    stdio: "inherit",
  },
);

const after = candidate(["--expect-fingerprint", before.fingerprint]);
let postflightIssue = null;
let postflightEvidence = null;
const runIssue = run.error?.code === "ETIMEDOUT"
  ? "browser_run_timeout"
  : run.error || (run.status ?? 1) !== 0
    ? "browser_run_failed"
    : null;
if (runIssue) {
  postflightIssue = runIssue;
} else {
  try {
    postflightEvidence = await verifyReleaseState(releaseStartedAt);
  } catch (error) {
    const postflightError = error instanceof Error
      ? error.message.slice(0, 512)
      : "unknown_postflight_error";
    postflightIssue = error instanceof Error && [
      "release_state_timeout",
      "release_state_query_timeout",
      "fixture_invariant_query_timeout",
      "e2e_postflight_deadline_exceeded",
      "scratch_restore_export_timeout",
      "scratch_restore_import_timeout",
    ].includes(error.message)
      ? "post_run_fixture_timeout"
      : "post_run_fixture_integrity";
    process.stderr.write(
      `release proof post-run fixture integrity failed (${postflightError})\n`,
    );
  }
}

let persistCleanupIssue = null;
try {
  rmSync(persistPath.absolutePath, { force: true, recursive: true });
  if (existsSync(persistPath.absolutePath)) throw new Error("persist_cleanup_incomplete");
} catch {
  persistCleanupIssue = "local_fixture_cleanup_failed";
  process.stderr.write("release proof isolated fixture cleanup failed\n");
}

if (!runIssue && !postflightIssue && !persistCleanupIssue && after.ok && postflightEvidence) {
  try {
    recordManifestPostflight(manifestPath, {
      journeys: journeyScope,
      ...postflightEvidence,
      launchConfig: launchConfigEvidence(before),
      isolatedPersistenceRemoved: true,
    });
  } catch {
    postflightIssue = "postflight_manifest_evidence_failed";
    process.stderr.write("release proof postflight manifest evidence failed\n");
  }
}

const manifestIssues = [
  ...(!after.ok ? ["candidate_fingerprint_changed"] : []),
  ...(postflightIssue ? [postflightIssue] : []),
  ...(persistCleanupIssue ? [persistCleanupIssue] : []),
];
let manifestInvalidationFailed = false;
for (const issue of manifestIssues) {
  try {
    markManifestFailed(manifestPath, issue);
  } catch {
    manifestInvalidationFailed = true;
    process.stderr.write("release proof manifest invalidation failed closed\n");
    break;
  }
}

if (!after.ok) {
  process.stderr.write(`release proof invalidated: ${(after.blockers ?? ["candidate_identity_unavailable"]).join(",")}\n`);
}
if (run.error) process.stderr.write("release proof runner unavailable\n");

const failed =
  !after.ok ||
  Boolean(run.error) ||
  (run.status ?? 1) !== 0 ||
  Boolean(postflightIssue) ||
  Boolean(persistCleanupIssue) ||
  manifestInvalidationFailed;
process.exit(failed ? 1 : 0);
