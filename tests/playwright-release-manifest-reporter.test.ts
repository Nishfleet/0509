import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-ignore JavaScript reporter module is intentionally exercised through Vitest.
const {
  GateBManifestReporter,
  RELEASE_ARTIFACT_STATE_MATRIX,
  RELEASE_COVERAGE_MATRIX,
  buildManifest,
  expectedReleaseArtifacts,
  markManifestFailed,
  recordManifestPostflight,
  resolveOutputPath,
  supportsReleaseCoverage,
  validateReleaseCoverage,
  validateReleaseArtifacts,
  writePreflightManifest,
} = await import("../scripts/playwright-release-manifest-reporter.mjs");

// The release-artifact state list the E2E specs attach (source of truth for
// what screenshots/ARIA snapshots a release run produces) is kept in a
// separate TypeScript helper. The reporter's RELEASE_ARTIFACT_STATE_MATRIX is
// the gate that validates those attachments. A state added to the spec helper
// but not the reporter matrix silently fails every production deploy with
// artifact_count/artifact_extra (issue #1354). This import pins the two
// together so the drift is caught by `npm test`, not by a halted deploy train.
const { RELEASE_ARTIFACT_STATES } = await import("../e2e/helpers/release-artifacts");

const fingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const runOrigin = "http://127.0.0.1:43127";
const serverIdentity = "local-0123456789abcdef0123456789abcdef";

type FakeProject = {
  name: string;
  use: {
    browserName?: string;
    defaultBrowserType?: string;
  };
};

// The reporter's JavaScript helper accepts the augmented ProcessEnv type; this
// keeps these path-resolution tests explicit without supplying production vars.
const emptyProcessEnv: NodeJS.ProcessEnv = Object.create(null);

function makeTestDirectory() {
  const outputRoot = resolve(process.cwd(), "test-results");
  mkdirSync(outputRoot, { recursive: true });
  return mkdtempSync(join(outputRoot, "gate-b-manifest-"));
}

function fakeTest(
  id: string,
  annotations: Array<{ type: string; description?: string }>,
  file = `/private/worktree/e2e/${id}.spec.ts`,
) {
  return {
    id,
    annotations,
    expectedStatus: "passed",
    location: { file, line: 10, column: 1 },
    parent: {
      project: (): FakeProject => ({ name: "local-release", use: { browserName: "chromium" } }),
    },
  };
}

function annotations(overrides: Partial<Record<"persona" | "scenario" | "viewport" | "finalUrl", string>> = {}) {
  return [
    { type: "persona", description: overrides.persona ?? "e2e-starter" },
    { type: "scenario", description: overrides.scenario ?? "monitoring-proof" },
    { type: "viewport", description: overrides.viewport ?? "375x812" },
    { type: "finalUrl", description: overrides.finalUrl ?? "/app/watchlists?watchlist=e2e-watchlist-starter-1" },
  ];
}

function result(
  status: string,
  retry = 0,
  annotationsOverride: Array<{ type: string; description?: string }> = [],
  attachments: Array<{ name: string; contentType: string; body?: Buffer; path?: string }> = [],
) {
  return { status, retry, annotations: annotationsOverride, attachments };
}

const pngBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const ariaBody = Buffer.from(
  JSON.stringify([{ role: "main", name: "0509", children: [{ role: "heading", name: "Proof" }] }]),
  "utf8",
);

function releaseAttachments(entry: { scenario: string; viewport: string }): Array<{
  name: string;
  contentType: string;
  body?: Buffer;
  path?: string;
}> {
  return expectedReleaseArtifacts(entry).map((artifact: { attachmentName: string; contentType: string; kind: string }) => ({
    name: artifact.attachmentName,
    contentType: artifact.contentType,
    body: artifact.kind === "screenshot" ? pngBody : ariaBody,
  }));
}

function matrixFinalUrl(expected: { exact?: string; pathname?: string; search?: Record<string, string>; searchKeys?: string[] }, viewport: string) {
  if (expected.exact) return expected.exact;
  const query = expected.search
    ? new URLSearchParams(expected.search).toString()
    : (expected.searchKeys ?? []).map((key) => `${key}=e2e-${viewport}`).join("&");
  return `${expected.pathname}?${query}`;
}

type ReleaseCoverageEntry = {
  sourceFile: string;
  persona: string;
  scenario: string;
  viewport: string;
  finalUrl: {
    exact?: string;
    pathname?: string;
    search?: Record<string, string>;
    searchKeys?: string[];
  };
};

function releaseCoverageEntries(journeys: number[] = [1, 2]) {
  const matrix = RELEASE_COVERAGE_MATRIX as unknown as Record<number, readonly ReleaseCoverageEntry[]>;
  return journeys.flatMap((journey) => matrix[journey] ?? []).map((entry) => ({
    ...entry,
    finalUrl: matrixFinalUrl(entry.finalUrl, entry.viewport),
  }));
}

function suite(tests: unknown[]) {
  return { allTests: () => tests };
}

function fullResult(status = "passed") {
  return { status, startTime: new Date(0), duration: 1 };
}

function readManifest(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Gate-B Playwright release manifest reporter", () => {
  it("keeps the reporter artifact state matrix in sync with the E2E spec helper (issue #1354)", () => {
    // The spec helper (e2e/helpers/release-artifacts.ts RELEASE_ARTIFACT_STATES)
    // is keyed by prefix; the reporter matrix is keyed by scenario with a
    // `prefix` field. Re-key the reporter by prefix and assert every prefix
    // carries the exact same ordered state list. A drift here is the class
    // that halted every production deploy on 2026-08-27/28.
    const reporterByPrefix = new Map<string, string[]>();
    for (const [scenario, definition] of Object.entries(RELEASE_ARTIFACT_STATE_MATRIX)) {
      const { prefix, states } = definition as { prefix: string; states: readonly string[] };
      expect(reporterByPrefix.has(prefix)).toBe(false);
      reporterByPrefix.set(prefix, [...states]);
    }

    const specPrefixes = Object.keys(RELEASE_ARTIFACT_STATES);
    expect(specPrefixes.sort()).toEqual([...reporterByPrefix.keys()].sort());

    for (const prefix of specPrefixes) {
      const specStates = [...(RELEASE_ARTIFACT_STATES as Record<string, readonly string[]>)[prefix]];
      const reporterStates = reporterByPrefix.get(prefix) ?? [];
      expect(specStates).toEqual(reporterStates);
    }
  });

  it("requires the exact Journey 1-2 three-width identity matrix", () => {
    expect(supportsReleaseCoverage([1, 2])).toBe(true);
    expect(supportsReleaseCoverage([1, 3])).toBe(true);
    const entries = releaseCoverageEntries();

    expect(validateReleaseCoverage(entries, [1, 2])).toEqual([]);
    expect(validateReleaseCoverage(entries.slice(1), [1, 2])).toEqual([
      "coverage_count:9:10",
    ]);
    expect(validateReleaseCoverage([...entries, entries[0]], [1, 2])).toEqual([
      "coverage_count:11:10",
    ]);
    expect(validateReleaseCoverage(entries.map((entry, index) => index === 0 ? { ...entry, viewport: "1024x768" } : entry), [1, 2])).toEqual([
      "coverage_missing:journey-1-release.spec.ts:first visit → value → signup:375x812",
      "coverage_unexpected_entry",
    ]);
    expect(validateReleaseCoverage(entries, [6])).toEqual(["coverage_count:10:18"]);

    const directory = makeTestDirectory();
    const outputPath = join(directory, "unsupported.json");
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      releaseJourneys: "7",
      strict: true,
    });
    reporter.onBegin({}, suite([]));
    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    expect(readManifest(outputPath).strictIssues).toContain("coverage_scope_invalid");
    rmSync(directory, { recursive: true, force: true });
  });

  it("defines every current Journey 3-6 scenario as an exact canonical three-width contract", () => {
    expect(supportsReleaseCoverage([1, 2, 3, 4, 5, 6])).toBe(true);
    const entries = releaseCoverageEntries([1, 2, 3, 4, 5, 6]);
    expect(entries).toHaveLength(73);
    expect(validateReleaseCoverage(entries, [1, 2, 3, 4, 5, 6])).toEqual([]);

    expect(entries.filter((entry) => entry.sourceFile === "journey-3-release.spec.ts").map((entry) => entry.scenario)).toEqual([
      "monitoring-proof-freshness-delivery",
      "digest-notifications-accessibility",
      "empty-gated-recovery-before-delivery",
      "preseeded-empty-and-recovered-monitoring-states",
      "owner-member-delivery-privacy",
      "first-run-wait-arc-and-free-capacity",
      "first-brief-front-page-and-cadence",
      "monitoring-proof-freshness-delivery",
      "digest-notifications-accessibility",
      "empty-gated-recovery-before-delivery",
      "preseeded-empty-and-recovered-monitoring-states",
      "owner-member-delivery-privacy",
      "first-run-wait-arc-and-free-capacity",
      "first-brief-front-page-and-cadence",
      "monitoring-proof-freshness-delivery",
      "digest-notifications-accessibility",
      "empty-gated-recovery-before-delivery",
      "preseeded-empty-and-recovered-monitoring-states",
      "owner-member-delivery-privacy",
      "first-run-wait-arc-and-free-capacity",
      "first-brief-front-page-and-cadence",
    ]);
    expect(
      entries
        .filter((entry) =>
          entry.sourceFile === "journey-3-release.spec.ts" &&
          ["empty-gated-recovery-before-delivery", "owner-member-delivery-privacy"].includes(entry.scenario)
        )
        .map((entry) => entry.finalUrl),
    ).toEqual([
      "/app/watchlists?watchlist=e2e-watchlist-scout-1&tab=delivery",
      "/app/watchlists?watchlist=e2e-watchlist-agency-1&tab=delivery",
      "/app/watchlists?watchlist=e2e-watchlist-scout-1&tab=delivery",
      "/app/watchlists?watchlist=e2e-watchlist-agency-1&tab=delivery",
      "/app/watchlists?watchlist=e2e-watchlist-scout-1&tab=delivery",
      "/app/watchlists?watchlist=e2e-watchlist-agency-1&tab=delivery",
    ]);
    expect(new Set(entries.filter((entry) => entry.sourceFile === "journey-4-release.spec.ts").map((entry) => entry.scenario))).toEqual(new Set([
      "report-proof-freshness-client-readable",
      "export-share-plan-truth",
      "client-room-empty-gated-delivery",
      "review-share-anonymous-open-revoke-re-review",
      "client-room-approval-recovery",
      "missing-report-recovery",
    ]));
    expect(new Set(entries
      .filter((entry) => [
        "empty-gated-recovery-before-delivery",
        "owner-member-delivery-privacy",
      ].includes(entry.scenario))
      .map((entry) => entry.finalUrl))).toEqual(new Set([
      "/app/watchlists?watchlist=e2e-watchlist-scout-1&tab=delivery",
      "/app/watchlists?watchlist=e2e-watchlist-agency-1&tab=delivery",
    ]));
    expect(new Set(entries.filter((entry) => entry.sourceFile === "journey-5-release.spec.ts").map((entry) => entry.scenario))).toEqual(new Set([
      "journey-5-plan-boundary-entitlement",
      "journey-5-signed-lifecycle-readback",
    ]));
    expect(new Set(entries.filter((entry) => entry.sourceFile === "journey-6-release.spec.ts").map((entry) => entry.scenario))).toEqual(new Set([
      "journey-6-returning-dashboard-account",
      "journey-6-account-validation-recovery",
      "journey-6-support-persistence-failure-recovery",
      "journey-6-retention-scratch-restore-integrity",
      "journey-6-auth-backend-outage-recovery",
      "journey-6-owner-member-invite-concurrency-stale-conflicts",
    ]));

    const combinedViewport = entries.find((entry) => entry.scenario === "digest-notifications-accessibility");
    expect(validateReleaseCoverage(entries.map((entry) => entry === combinedViewport ? { ...entry, viewport: "375x812;768x900;1440x900" } : entry), [1, 2, 3, 4, 5, 6])).toEqual([
      "coverage_missing:journey-3-release.spec.ts:digest-notifications-accessibility:375x812",
      "coverage_unexpected_entry",
    ]);
  });

  it("requires screenshot and ARIA evidence for every canonical scenario, including Journeys 3-6", () => {
    const entries = releaseCoverageEntries([3, 4, 5, 6]).map((entry) => ({
      ...entry,
      artifacts: expectedReleaseArtifacts(entry).map((artifact: { kind: string; state: string; attachmentName: string; contentType: string }) => ({
        kind: artifact.kind,
        state: artifact.state,
        name: `gate-b-artifacts/${fingerprint}/${serverIdentity}/${artifact.attachmentName}`,
        contentType: artifact.contentType,
        bytes: 1,
        sha256: fingerprint,
      })),
    }));
    expect(entries).toHaveLength(63);
    const lifecycleEntries = entries.filter((entry) => entry.scenario === "journey-5-signed-lifecycle-readback");
    expect(lifecycleEntries).toHaveLength(3);
    expect(lifecycleEntries.every((entry) => entry.artifacts.length === 6)).toBe(true);
    expect(entries
      .filter((entry) => entry.scenario !== "journey-5-signed-lifecycle-readback")
      .every((entry) => entry.artifacts.length === 2)).toBe(true);
    expect(validateReleaseArtifacts(entries)).toEqual([]);
    expect(validateReleaseArtifacts(entries.map((entry, index) => index === 0 ? { ...entry, artifacts: entry.artifacts.slice(1) } : entry)).sort()).toEqual(["artifact_count", "artifact_missing"]);
    expect(validateReleaseArtifacts(entries.map((entry, index) => index === 1 ? { ...entry, artifacts: [...entry.artifacts, { ...entry.artifacts[0], name: `${entry.artifacts[0].name}.extra` }] } : entry)).sort()).toEqual(["artifact_count", "artifact_extra"]);
  });

  it("persists the exact successful Journey 1-2 screenshot and ARIA artifact matrix", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const entries = releaseCoverageEntries();
    const tests = entries.map((entry, index) => fakeTest(
      `release-${index}`,
      annotations({
        persona: entry.persona,
        scenario: entry.scenario,
        viewport: entry.viewport,
        finalUrl: entry.finalUrl,
      }),
      `/private/worktree/e2e/${entry.sourceFile}`,
    ));
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      releaseJourneys: "1,2",
      strict: true,
    });
    reporter.onBegin(
      { projects: [{ name: "local-release", use: { baseURL: runOrigin } }] },
      suite(tests),
    );
    tests.forEach((releaseTest, index) => {
      const releaseAnnotations = releaseTest.annotations;
      reporter.onTestEnd(releaseTest, result(
        "passed",
        0,
        releaseAnnotations,
        releaseAttachments(entries[index]),
      ));
    });

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "passed" });
    const manifest = readManifest(outputPath);
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.status).toBe("passed");
    expect(manifest.strictIssues).toBeUndefined();
    expect(validateReleaseArtifacts(manifest.entries)).toEqual([]);
    expect(manifest.entries).toHaveLength(10);
    expect(manifest.entries.flatMap((entry: { artifacts: unknown[] }) => entry.artifacts)).toHaveLength(122);
    for (const artifact of manifest.entries.flatMap((entry: { artifacts: Array<{ name: string; bytes: number; sha256: string }> }) => entry.artifacts)) {
      expect(artifact.name).toMatch(/(?:^|\/)gate-b-artifacts\//u);
      expect(artifact.name).not.toContain(process.cwd());
      expect(artifact.bytes).toBeGreaterThan(0);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(readFileSync(resolve(process.cwd(), "test-results", artifact.name))).toHaveLength(artifact.bytes);
    }
    expect(JSON.stringify(manifest)).not.toContain("/private/worktree");
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails closed when a release artifact is path-backed or missing", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const entries = releaseCoverageEntries();
    const tests = entries.map((entry, index) => fakeTest(
      `release-invalid-${index}`,
      annotations({ persona: entry.persona, scenario: entry.scenario, viewport: entry.viewport, finalUrl: entry.finalUrl }),
      `/private/worktree/e2e/${entry.sourceFile}`,
    ));
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      releaseJourneys: "1,2",
      strict: true,
    });
    reporter.onBegin({ projects: [{ name: "local-release", use: { baseURL: runOrigin } }] }, suite(tests));
    tests.forEach((releaseTest, index) => {
      const attachments = releaseAttachments(entries[index]);
      if (index === 0) {
        attachments[0] = { ...attachments[0], body: undefined, path: "/tmp/unsafe.png" };
        attachments[1] = { ...attachments[1], body: Buffer.from("[unterminated", "utf8") };
      }
      reporter.onTestEnd(releaseTest, result("passed", 0, releaseTest.annotations, attachments));
    });

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    const manifest = readManifest(outputPath);
    expect(manifest.strictIssues).toContain("artifact_invalid");
    expect(manifest.strictIssues).toContain("artifact_missing");
    expect(manifest.entries.flatMap((entry: { artifacts: unknown[] }) => entry.artifacts)).toHaveLength(120);
    expect(JSON.stringify(manifest)).not.toContain("/tmp/unsafe.png");
    expect(JSON.stringify(manifest)).not.toContain("unterminated");
    rmSync(directory, { recursive: true, force: true });
  });

  it("writes a deterministic, sorted, secret-safe manifest for passing first attempts", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "nested", "manifest.json");
    const first = fakeTest("z-test", annotations(), "/private/worktree/e2e/z-test.spec.ts");
    const second = fakeTest("a-test", annotations({ scenario: "digest-delivery" }), "/private/worktree/e2e/a-test.spec.ts");
    const reporter = new GateBManifestReporter({ outputPath, candidateFingerprint: fingerprint, environment: "local", runOrigin, serverIdentity, strict: true });
    reporter.onBegin({}, suite([first, second]));
    reporter.onTestEnd(first, result("passed", 0, annotations()));
    reporter.onTestEnd(second, result("passed", 0, annotations({ scenario: "digest-delivery" })));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "passed" });
    const manifest = readManifest(outputPath);
    expect(manifest).toMatchObject({
      schemaVersion: 3,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      status: "passed",
      strict: true,
    });
    expect(manifest.entries.map((entry: { sourceFile: string }) => entry.sourceFile)).toEqual([
      "a-test.spec.ts",
      "z-test.spec.ts",
    ]);
    expect(manifest.entries[0]).toMatchObject({
      sourceFile: "a-test.spec.ts",
      browser: "chromium",
      project: "local-release",
      persona: "e2e-starter",
      scenario: "digest-delivery",
      viewport: "375x812",
      finalUrl: "/app/watchlists?watchlist=e2e-watchlist-starter-1",
      status: "passed",
      retry: 0,
      firstAttempt: { status: "passed", passed: true, retry: 0 },
    });
    expect(JSON.stringify(manifest)).not.toContain("/private/worktree");
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails strict release proof when React hydration errors cross stderr chunk boundaries", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const test = fakeTest("hydration-test", annotations(), "/private/worktree/e2e/hydration.spec.ts");
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      strict: true,
    });
    reporter.onBegin({}, suite([test]));
    reporter.onTestEnd(test, result("passed", 0, annotations()));
    reporter.onStdErr(Buffer.from("[WebServer] Error: Hydration failed because the server ren"));
    reporter.onStdErr(Buffer.from("[WebServer] dered text didn't match the client."));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    expect(readManifest(outputPath).strictIssues).toContain("server_hydration_error");
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails strict release proof on React production hydration error 418", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const test = fakeTest("production-hydration-test", annotations());
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      strict: true,
    });
    reporter.onBegin({}, suite([test]));
    reporter.onTestEnd(test, result("passed", 0, annotations()));
    reporter.onStdErr(Buffer.from(
      "Minified React error #418; visit https://react.dev/errors/418?args[]=HTML",
    ));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    expect(readManifest(outputPath).strictIssues).toContain("server_hydration_error");
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails strict release proof when a browser hydration annotation is present", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const releaseAnnotations = [
      ...annotations(),
      { type: "reactHydrationError", description: "console" },
    ];
    const test = fakeTest("browser-hydration-test", releaseAnnotations);
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      strict: true,
    });
    reporter.onBegin({}, suite([test]));
    reporter.onTestEnd(test, result("passed", 0, annotations()));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    const manifest = readManifest(outputPath);
    expect(manifest.strictIssues).toContain("browser_hydration_error:console");
    expect(JSON.stringify(manifest)).not.toContain("Hydration failed");
    rmSync(directory, { recursive: true, force: true });
  });

  it("ignores unrelated expected fixture stderr", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const test = fakeTest("fixture-stderr", annotations(), "/private/worktree/e2e/fixture.spec.ts");
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      strict: true,
    });
    reporter.onBegin({}, suite([test]));
    reporter.onTestEnd(test, result("passed", 0, annotations()));
    reporter.onStdErr(Buffer.from("[WebServer] Expected provider denial in retention fixture."));
    reporter.onStdErr(
      Buffer.from("Hydration failed because the server rendered text didn't match the client."),
      test,
    );

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "passed" });
    expect(readManifest(outputPath).strictIssues).toBeUndefined();
    rmSync(directory, { recursive: true, force: true });
  });

  it("records the configured browser and a safe nested relative signup return path", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const releaseAnnotations = annotations({
      scenario: "first visit → value → signup",
      finalUrl: "/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dnykaa.com%23setup-checklist",
    });
    const releaseTest = fakeTest("journey-1-release", releaseAnnotations);
    releaseTest.parent.project = () => ({
      name: "local-release",
      use: { defaultBrowserType: "chromium" },
    });
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      strict: true,
    });
    reporter.onBegin({}, suite([releaseTest]));
    reporter.onTestEnd(releaseTest, result("passed", 0, releaseAnnotations));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "passed" });
    expect(readManifest(outputPath).entries[0]).toMatchObject({
      browser: "chromium",
      scenario: "first visit → value → signup",
      finalUrl: "/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dnykaa.com%23setup-checklist",
    });
    rmSync(directory, { recursive: true, force: true });
  });

  it("records the bounded full search-state URL required by Journey 2", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const finalUrl =
      "/search?mode=advertiser&query=nykaa.com&country=all&platform=all&creativeType=all&status=all&website=nykaa.com&trackingRole=competitor&selected=e2e-nykaa-live-1";
    expect(finalUrl.length).toBeGreaterThan(128);
    const releaseAnnotations = annotations({
      scenario: "onboarding → search → credible proof",
      finalUrl,
    });
    const releaseTest = fakeTest("journey-2-release", releaseAnnotations);
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      strict: true,
    });
    reporter.onBegin({}, suite([releaseTest]));
    reporter.onTestEnd(releaseTest, result("passed", 0, releaseAnnotations));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "passed" });
    expect(readManifest(outputPath).entries[0].finalUrl).toBe(finalUrl);
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects an encoded external signup return path", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const unsafeAnnotations = annotations({
      finalUrl: "/auth/signup?redirectTo=https%3A%2F%2Fevil.example%2Fcollect",
    });
    const releaseTest = fakeTest("unsafe-return", unsafeAnnotations);
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      strict: true,
    });
    reporter.onBegin({}, suite([releaseTest]));
    reporter.onTestEnd(releaseTest, result("passed", 0, unsafeAnnotations));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    const manifestText = readFileSync(outputPath, "utf8");
    expect(JSON.parse(manifestText).strictIssues).toContain("annotation:finalUrl");
    expect(manifestText).not.toContain("evil.example");
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails closed for invalid fingerprint and missing required annotations without leaking values", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const secret = "sk_live_customer-secret-should-not-appear";
    const test = fakeTest("secret-test", annotations({ persona: secret, finalUrl: "https://evil.example/?token=secret" }));
    test.annotations = [{ type: "persona", description: secret }];
    const reporter = new GateBManifestReporter({ outputPath, candidateFingerprint: "not-a-fingerprint", environment: "local", runOrigin, serverIdentity, strict: true });
    reporter.onBegin({}, suite([test]));
    reporter.onTestEnd(test, result("passed"));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    const manifestText = readFileSync(outputPath, "utf8");
    const manifest = JSON.parse(manifestText);
    expect(manifest.status).toBe("failed");
    expect(manifest.candidateFingerprint).toBeNull();
    expect(manifest.strictIssues).toEqual(expect.arrayContaining(["candidate_fingerprint", "annotation:scenario", "annotation:viewport", "annotation:finalUrl"]));
    expect(manifestText).not.toContain(secret);
    expect(manifestText).not.toContain("evil.example");
    expect(manifestText).not.toContain(directory);
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails closed on retry, failed, skipped, and interrupted runs while recording first-attempt results", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const retried = fakeTest("retried", annotations());
    const skipped = fakeTest("skipped", annotations());
    const interrupted = fakeTest("interrupted", annotations());
    const reporter = new GateBManifestReporter({ outputPath, candidateFingerprint: fingerprint, environment: "ci", runOrigin, serverIdentity, strict: true });
    reporter.onBegin({}, suite([retried, skipped, interrupted]));
    reporter.onTestEnd(retried, result("passed", 0));
    reporter.onTestEnd(retried, result("failed", 1));
    reporter.onTestEnd(skipped, result("skipped", 0));
    reporter.onTestEnd(interrupted, result("interrupted", 0));

    expect(reporter.onEnd(fullResult("failed"))).toEqual({ status: "failed" });
    const manifest = readManifest(outputPath);
    expect(manifest.status).toBe("failed");
    expect(manifest.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceFile: "retried.spec.ts", retry: 1, status: "failed", firstAttempt: { status: "passed", passed: true, retry: 0 } }),
      expect.objectContaining({ sourceFile: "skipped.spec.ts", status: "skipped", firstAttempt: { status: "skipped", passed: false, retry: 0 } }),
      expect.objectContaining({ sourceFile: "interrupted.spec.ts", status: "interrupted" }),
    ]));
    expect(manifest.strictIssues).toEqual(expect.arrayContaining(["retry", "status:failed", "status:skipped", "status:interrupted", "run:failed"]));
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails closed when a passing test carries a blocked annotation or non-passing expected status", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const blocked = fakeTest("blocked", [...annotations(), { type: "blocked", description: "unresolved-subgate" }]);
    blocked.expectedStatus = "failed";
    const reporter = new GateBManifestReporter({ outputPath, candidateFingerprint: fingerprint, environment: "local", runOrigin, serverIdentity, strict: true });
    reporter.onBegin({}, suite([blocked]));
    reporter.onTestEnd(blocked, result("passed", 0, blocked.annotations));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    const manifest = readManifest(outputPath);
    expect(manifest.strictIssues).toEqual(expect.arrayContaining(["annotation:blocked", "expected_status:failed"]));
    expect(JSON.stringify(manifest)).not.toContain("unresolved-subgate");
    rmSync(directory, { recursive: true, force: true });
  });

  it("preserves blocking test annotations when result annotations contain only required evidence", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const blocked = fakeTest("blocked", [
      ...annotations(),
      { type: "blocked", description: "unresolved-subgate" },
    ]);
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      strict: true,
    });
    reporter.onBegin({}, suite([blocked]));
    reporter.onTestEnd(blocked, result("passed", 0, annotations()));

    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    const manifest = readManifest(outputPath);
    expect(manifest.strictIssues).toContain("annotation:blocked");
    expect(JSON.stringify(manifest)).not.toContain("unresolved-subgate");
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps deterministic schema ordering independent of test arrival order", () => {
    const entry = (sourceFile: string) => ({ sourceFile, browser: "chromium", project: "local-release", persona: "e2e", scenario: "scenario", viewport: "375x812", finalUrl: "/app", status: "passed", retry: 0, firstAttempt: { status: "passed", passed: true, retry: 0 } });
    const first = buildManifest({ candidateFingerprint: fingerprint, environment: "local", runOrigin, serverIdentity, entries: [entry("z.spec.ts"), entry("a.spec.ts")], status: "passed", strict: true });
    const second = buildManifest({ candidateFingerprint: fingerprint, environment: "local", runOrigin, serverIdentity, entries: [entry("a.spec.ts"), entry("z.spec.ts")], status: "passed", strict: true });
    expect(first).toEqual(second);
    expect(first.entries.map((item: { sourceFile: string }) => item.sourceFile)).toEqual(["a.spec.ts", "z.spec.ts"]);
  });

  it("binds strict evidence to one sanitized local origin and opaque server identity", () => {
    const invalid = buildManifest({
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin: "https://user@evil.example:43127/?token=secret",
      serverIdentity: "local-static",
      entries: [],
      status: "passed",
      strict: true,
    });
    expect(invalid).toMatchObject({
      runOrigin: null,
      serverIdentity: null,
      status: "failed",
    });
    expect(invalid.strictIssues).toEqual(expect.arrayContaining(["run_origin", "server_identity"]));
    expect(JSON.stringify(invalid)).not.toContain("evil.example");
    expect(JSON.stringify(invalid)).not.toContain("secret");

    const directory = makeTestDirectory();
    const outputPath = join(directory, "origin-mismatch.json");
    const reporter = new GateBManifestReporter({
      outputPath,
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      strict: true,
    });
    reporter.onBegin(
      { projects: [{ name: "local-release", use: { baseURL: "http://127.0.0.1:43128" } }] },
      suite([]),
    );
    expect(reporter.onEnd(fullResult("passed"))).toEqual({ status: "failed" });
    expect(readManifest(outputPath).strictIssues).toEqual(
      expect.arrayContaining(["no_tests", "project_origin_mismatch"]),
    );
    rmSync(directory, { recursive: true, force: true });
  });

  it("atomically invalidates a passing manifest after post-run fixture failure", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const passing = buildManifest({
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      entries: [{
        sourceFile: "journey-2-release.spec.ts",
        browser: "chromium",
        project: "local-release",
        persona: "e2e-activation",
        scenario: "onboarding",
        viewport: "375x812",
        finalUrl: "/app/watchlists",
        status: "passed",
        retry: 0,
        firstAttempt: { status: "passed", passed: true, retry: 0 },
      }],
      status: "passed",
      strict: true,
    });
    writeFileSync(outputPath, `${JSON.stringify(passing)}\n`, { mode: 0o600 });

    const failed = markManifestFailed(outputPath, "post_run_fixture_integrity");
    expect(failed.status).toBe("failed");
    expect(failed.entries).toEqual(passing.entries);
    expect(failed.strictIssues).toEqual(["post_run_fixture_integrity"]);
    expect(readManifest(outputPath)).toEqual(failed);
    markManifestFailed(outputPath, "post_run_fixture_integrity");
    expect(readManifest(outputPath).strictIssues).toEqual(["post_run_fixture_integrity"]);
    rmSync(directory, { recursive: true, force: true });
  });

  it("binds sanitized postflight counts, launch config, and isolated cleanup to a passing manifest", () => {
    const directory = makeTestDirectory();
    const outputPath = join(directory, "manifest.json");
    const passing = buildManifest({
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
      entries: [],
      status: "passed",
      strict: true,
    });
    writeFileSync(outputPath, `${JSON.stringify(passing)}\n`, { mode: 0o600 });
    const evidence = {
      journeys: [4],
      releaseState: { j4_replay_count: 12, j4_audit_count: 9 },
      fixtureState: { foreign_key_violation_count: 0 },
      launchConfig: {
        identity: "a".repeat(64),
        wranglerWorktreeSha256: "b".repeat(64),
        productionSearchRolloutMode: "v2",
        localProofSearchRolloutMode: "v2",
        providerNetworkDeny: true,
        authProvider: "better-auth",
        browserProject: "local-release",
        retries: 0,
        workers: 1,
      },
      scratchRestore: {
        sourceDumpSha256: "c".repeat(64),
        transformedSqlSha256: "d".repeat(64),
        sourceBytes: 1000,
        transformedBytes: 1000,
        transformedStatements: 0,
        maximumStatementBytes: 1000,
        tableCount: 3,
        totalRows: 10,
        migrations: 2,
        latestMigrationId: 2,
        planRows: 2,
        linkedPlanRows: 1,
        integrity: "ok",
        foreignKeyViolations: 0,
        exactRowCounts: true,
        dodoLinkagePreserved: true,
        scratchDatabaseRemoved: true,
      },
      isolatedPersistenceRemoved: true,
    };
    const recorded = recordManifestPostflight(outputPath, evidence);
    expect(recorded.status).toBe("passed");
    expect(recorded.postflight).toEqual(evidence);
    expect(readManifest(outputPath)).toEqual(recorded);
    expect(() => recordManifestPostflight(outputPath, {
      ...evidence,
      launchConfig: { ...evidence.launchConfig, productionSearchRolloutMode: "legacy" },
    })).toThrow("invalid_manifest_postflight");
    expect(() => recordManifestPostflight(outputPath, {
      ...evidence,
      scratchRestore: { ...evidence.scratchRestore, exactRowCounts: false },
    })).toThrow("invalid_manifest_postflight");
    rmSync(directory, { recursive: true, force: true });
  });

  it("writes durable preflight evidence and confines generated manifests to test-results", () => {
    expect(() => resolveOutputPath({ outputPath: "../outside.json" }, emptyProcessEnv)).toThrow(
      "release_manifest_path_outside_test_results",
    );
    expect(() => resolveOutputPath({ outputPath: "/tmp/outside.json" }, emptyProcessEnv)).toThrow(
      "release_manifest_path_outside_test_results",
    );

    const directory = makeTestDirectory();
    const outputPath = join(directory, "preflight.json");
    expect(resolveOutputPath({ outputPath }, emptyProcessEnv)).toBe(outputPath);
    const preflight = writePreflightManifest(outputPath, {
      candidateFingerprint: fingerprint,
      environment: "local",
      runOrigin,
      serverIdentity,
    });
    expect(preflight).toMatchObject({
      schemaVersion: 3,
      candidateFingerprint: fingerprint,
      runOrigin,
      serverIdentity,
      status: "failed",
      strictIssues: ["run_not_completed"],
      entries: [],
    });
    expect(readManifest(outputPath)).toEqual(preflight);
    const unboundPreflight = writePreflightManifest(outputPath, {
      candidateFingerprint: null,
      environment: "local",
      runOrigin: null,
      serverIdentity: null,
    });
    expect(unboundPreflight.status).toBe("failed");
    expect(unboundPreflight.strictIssues).toEqual(expect.arrayContaining([
      "candidate_fingerprint",
      "run_not_completed",
      "run_origin",
      "server_identity",
    ]));
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails closed instead of fabricating a manifest when post-run evidence is missing or malformed", () => {
    const directory = makeTestDirectory();
    const missing = join(directory, "missing.json");
    const malformed = join(directory, "malformed.json");
    writeFileSync(malformed, '{"status":"passed"}\n', { mode: 0o600 });

    expect(() => markManifestFailed(missing, "post_run_fixture_integrity")).toThrow(
      "release_manifest_unavailable",
    );
    expect(() => markManifestFailed(malformed, "post_run_fixture_integrity")).toThrow(
      "invalid_release_manifest",
    );
    rmSync(directory, { recursive: true, force: true });
  });
});
