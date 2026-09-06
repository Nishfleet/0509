#!/usr/bin/env node
// @ts-nocheck

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  isLocalReleaseServerIdentity,
  parseExactLoopbackOrigin,
} from "./local-release-server.mjs";

export const MANIFEST_SCHEMA_VERSION = 3;
export const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
export const REQUIRED_ANNOTATIONS = ["persona", "scenario", "viewport", "finalUrl"];
export const BLOCKING_ANNOTATIONS = ["blocked"];
export const RELEASE_COVERAGE_VIEWPORTS = Object.freeze(["375x812", "768x900", "1440x900"]);

export const RELEASE_ARTIFACT_STATE_MATRIX = Object.freeze({
  "first visit → value → signup": Object.freeze({
    prefix: "j1",
    states: Object.freeze([
      "docs",
      "status",
      "help",
      "trust",
      "privacy",
      "terms",
      "home",
      "invalid",
      "empty",
      "degraded",
      "proof",
      "timeline",
      "signup",
    ]),
  }),
  "onboarding → search → credible proof": Object.freeze({ prefix: "j2-proof", states: Object.freeze(["onboard", "invalid", "empty", "degraded", "proof"]) }),
  "onboarding → watchlist → first scan state": Object.freeze({ prefix: "j2-activation", states: Object.freeze(["onboard", "activation-paused"]) }),
  "first-run-beat-1-empty-free": Object.freeze({ prefix: "j2-first-run-beat-1", states: Object.freeze(["first-run-empty-free"]) }),
  "monitoring-proof-freshness-delivery": Object.freeze({ prefix: "j3-monitoring", states: Object.freeze(["monitoring"]) }),
  "digest-notifications-accessibility": Object.freeze({ prefix: "j3-digest", states: Object.freeze(["digest-notifications"]) }),
  "empty-gated-recovery-before-delivery": Object.freeze({ prefix: "j3-gated", states: Object.freeze(["empty-gated-recovery"]) }),
  "preseeded-empty-and-recovered-monitoring-states": Object.freeze({ prefix: "j3-preseeded", states: Object.freeze(["empty-recovered"]) }),
  "owner-member-delivery-privacy": Object.freeze({ prefix: "j3-privacy", states: Object.freeze(["owner-member-privacy"]) }),
  "first-run-wait-arc-and-free-capacity": Object.freeze({ prefix: "j3-first-run-wait", states: Object.freeze(["first-run-wait"]) }),
  "first-brief-front-page-and-cadence": Object.freeze({ prefix: "j3-first-brief", states: Object.freeze(["first-brief-front-page"]) }),
  "report-proof-freshness-client-readable": Object.freeze({ prefix: "j4-report", states: Object.freeze(["report-proof"]) }),
  "export-share-plan-truth": Object.freeze({ prefix: "j4-export", states: Object.freeze(["export-share-gate"]) }),
  "client-room-empty-gated-delivery": Object.freeze({ prefix: "j4-clients", states: Object.freeze(["empty-gated-room"]) }),
  "review-share-anonymous-open-revoke-re-review": Object.freeze({ prefix: "j4-share", states: Object.freeze(["share-revoke-rereview"]) }),
  "client-room-approval-recovery": Object.freeze({ prefix: "j4-room", states: Object.freeze(["approval-recovery"]) }),
  "missing-report-recovery": Object.freeze({ prefix: "j4-missing", states: Object.freeze(["missing-recovery"]) }),
  "journey-5-plan-boundary-entitlement": Object.freeze({ prefix: "j5-plan", states: Object.freeze(["plan-boundary-entitlement"]) }),
  "journey-5-signed-lifecycle-readback": Object.freeze({
    prefix: "j5-lifecycle",
    states: Object.freeze(["payment-recovered", "cancelled", "refunded"]),
  }),
  "journey-6-returning-dashboard-account": Object.freeze({ prefix: "j6-return", states: Object.freeze(["dashboard-account"]) }),
  "journey-6-account-validation-recovery": Object.freeze({ prefix: "j6-account", states: Object.freeze(["account-validation-recovery"]) }),
  "journey-6-support-persistence-failure-recovery": Object.freeze({ prefix: "j6-support", states: Object.freeze(["support-failure-recovery"]) }),
  "journey-6-retention-scratch-restore-integrity": Object.freeze({ prefix: "j6-retention", states: Object.freeze(["retention-restore-integrity"]) }),
  "journey-6-auth-backend-outage-recovery": Object.freeze({ prefix: "j6-auth", states: Object.freeze(["auth-outage-recovery"]) }),
  "journey-6-owner-member-invite-concurrency-stale-conflicts": Object.freeze({ prefix: "j6-team", states: Object.freeze(["invite-concurrency-recovery"]) }),
});
const ARTIFACT_SCREENSHOT_CONTENT_TYPE = "image/png";
const ARTIFACT_ARIA_CONTENT_TYPE = "application/json";
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const MAX_ARIA_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const RELEASE_COVERAGE_MATRIX = Object.freeze({
  1: RELEASE_COVERAGE_VIEWPORTS.map((viewport) => ({
    sourceFile: "journey-1-release.spec.ts",
    persona: "anonymous",
    scenario: "first visit → value → signup",
    viewport,
    finalUrl: { exact: "/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dnykaa.com%23setup-checklist" },
  })),
  2: [
    ...RELEASE_COVERAGE_VIEWPORTS.flatMap((viewport) => [
      {
        sourceFile: "journey-2-release.spec.ts",
        persona: "e2e-free",
        scenario: "onboarding → search → credible proof",
        viewport,
        finalUrl: {
          pathname: "/search",
          search: {
            mode: "advertiser",
            query: "nykaa.com",
            country: "all",
            platform: "all",
            creativeType: "all",
            status: "all",
            website: "nykaa.com",
            trackingRole: "competitor",
            selected: "e2e-nykaa-live-1",
          },
        },
      },
      {
        sourceFile: "journey-2-release.spec.ts",
        persona: `e2e-activation${viewport === "375x812" ? "" : viewport === "768x900" ? "-tablet" : "-desktop"}`,
        scenario: "onboarding → watchlist → first scan state",
        viewport,
        finalUrl: { pathname: "/app/watchlists", searchKeys: ["watchlist"] },
      },
    ]),
    // WP-C2 Beat 1 empty-free honesty runs once at the canonical desktop width.
    {
      sourceFile: "journey-2-release.spec.ts",
      persona: "e2e-free-onboarded",
      scenario: "first-run-beat-1-empty-free",
      viewport: "1440x900",
      finalUrl: { exact: "/app" },
    },
  ],
  3: RELEASE_COVERAGE_VIEWPORTS.flatMap((viewport) => [
    {
      sourceFile: "journey-3-release.spec.ts",
      persona: "e2e-starter",
      scenario: "monitoring-proof-freshness-delivery",
      viewport,
      finalUrl: { pathname: "/app/watchlists", searchKeys: ["watchlist"] },
    },
    {
      sourceFile: "journey-3-release.spec.ts",
      persona: "e2e-starter",
      scenario: "digest-notifications-accessibility",
      viewport,
      finalUrl: { exact: "/app/notifications" },
    },
    {
      sourceFile: "journey-3-release.spec.ts",
      persona: "e2e-free-onboarded,e2e-scout",
      scenario: "empty-gated-recovery-before-delivery",
      viewport,
      // #403 deploy unblock: BL-008 preserves these BL-007 delivery proofs on
      // the Delivery tab, so the strict registry must match the captured URL.
      finalUrl: {
        pathname: "/app/watchlists",
        search: {
          watchlist: "e2e-watchlist-scout-1",
          tab: "delivery",
        },
      },
    },
    {
      sourceFile: "journey-3-release.spec.ts",
      persona: "e2e-free-onboarded,e2e-starter",
      scenario: "preseeded-empty-and-recovered-monitoring-states",
      viewport,
      finalUrl: { pathname: "/app/watchlists", searchKeys: ["watchlist"] },
    },
    {
      sourceFile: "journey-3-release.spec.ts",
      persona: "e2e-agency,e2e-active-member",
      scenario: "owner-member-delivery-privacy",
      viewport,
      finalUrl: {
        pathname: "/app/watchlists",
        search: {
          watchlist: "e2e-watchlist-agency-1",
          tab: "delivery",
        },
      },
    },
    {
      sourceFile: "journey-3-release.spec.ts",
      persona: "e2e-free-firstscan",
      scenario: "first-run-wait-arc-and-free-capacity",
      viewport,
      finalUrl: { pathname: "/app/watchlists", searchKeys: ["watchlist"] },
    },
    {
      sourceFile: "journey-3-release.spec.ts",
      persona: "e2e-free-firstbrief,e2e-scout",
      scenario: "first-brief-front-page-and-cadence",
      viewport,
      finalUrl: { pathname: "/app/digests", search: { firstrun: "1" } },
    },
  ]),
  4: RELEASE_COVERAGE_VIEWPORTS.flatMap((viewport) => [
    {
      sourceFile: "journey-4-release.spec.ts",
      persona: "e2e-agency",
      scenario: "report-proof-freshness-client-readable",
      viewport,
      finalUrl: { exact: "/app/reports/watchlist:e2e-watchlist-agency-1" },
    },
    {
      sourceFile: "journey-4-release.spec.ts",
      persona: "e2e-agency;e2e-starter",
      scenario: "export-share-plan-truth",
      viewport,
      finalUrl: { exact: "/app/reports/watchlist:e2e-watchlist-agency-1" },
    },
    {
      sourceFile: "journey-4-release.spec.ts",
      persona: "e2e-agency;e2e-starter",
      scenario: "client-room-empty-gated-delivery",
      viewport,
      finalUrl: { exact: "/app/clients" },
    },
    {
      sourceFile: "journey-4-release.spec.ts",
      persona: "e2e-agency;anonymous-client",
      scenario: "review-share-anonymous-open-revoke-re-review",
      viewport,
      finalUrl: { exact: "/app/shares" },
    },
    {
      sourceFile: "journey-4-release.spec.ts",
      persona: "e2e-agency",
      scenario: "client-room-approval-recovery",
      viewport,
      finalUrl: { exact: "/app/clients" },
    },
    {
      sourceFile: "journey-4-release.spec.ts",
      persona: "e2e-agency",
      scenario: "missing-report-recovery",
      viewport,
      finalUrl: { exact: "/app/reports/watchlist:e2e-watchlist-agency-1" },
    },
  ]),
  5: RELEASE_COVERAGE_VIEWPORTS.flatMap((viewport) => [
    {
      sourceFile: "journey-5-release.spec.ts",
      persona: "e2e-free-onboarded,e2e-starter",
      scenario: "journey-5-plan-boundary-entitlement",
      viewport,
      finalUrl: { exact: "/app/billing" },
    },
    {
      sourceFile: "journey-5-release.spec.ts",
      persona: viewport === "768x900"
        ? "e2e-payment-issue-tablet,e2e-cancelled-tablet,e2e-refunded-tablet"
        : viewport === "1440x900"
          ? "e2e-payment-issue-desktop,e2e-cancelled-desktop,e2e-refunded-desktop"
          : "e2e-payment-issue,e2e-cancelled,e2e-refunded",
      scenario: "journey-5-signed-lifecycle-readback",
      viewport,
      finalUrl: { exact: "/app/billing" },
    },
  ]),
  6: RELEASE_COVERAGE_VIEWPORTS.flatMap((viewport) => [
    {
      sourceFile: "journey-6-release.spec.ts",
      persona: "e2e-starter",
      scenario: "journey-6-returning-dashboard-account",
      viewport,
      finalUrl: { exact: "/app" },
    },
    {
      sourceFile: "journey-6-release.spec.ts",
      persona: "e2e-starter",
      scenario: "journey-6-account-validation-recovery",
      viewport,
      finalUrl: { exact: "/app/account" },
    },
    {
      sourceFile: "journey-6-release.spec.ts",
      persona: "e2e-support-recovery",
      scenario: "journey-6-support-persistence-failure-recovery",
      viewport,
      finalUrl: { pathname: "/app/support", searchKeys: ["case"] },
    },
    {
      sourceFile: "journey-6-release.spec.ts",
      persona: "e2e-starter",
      scenario: "journey-6-retention-scratch-restore-integrity",
      viewport,
      finalUrl: { exact: "/app" },
    },
    {
      sourceFile: "journey-6-release.spec.ts",
      persona: "e2e-starter",
      scenario: "journey-6-auth-backend-outage-recovery",
      viewport,
      finalUrl: { exact: "/app" },
    },
    {
      sourceFile: "journey-6-release.spec.ts",
      persona: "e2e-agency",
      scenario: "journey-6-owner-member-invite-concurrency-stale-conflicts",
      viewport,
      finalUrl: { exact: "/app/team" },
    },
  ]),
});

const DEFAULT_OUTPUT_PATH = "test-results/gate-b-manifest.json";
const DEFAULT_ENVIRONMENT = "local";
const RELEASE_PROOF_PROJECT_PATTERN = /^local-release(?:-(?:firefox|webkit|mobile-safari|mobile-chrome))?$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const ANNOTATION_PATTERN = /^[\p{L}\p{N}._:;,+@%#?&=~!$'()*;\-/→× ]{1,128}$/u;
const URL_TOKEN_PATTERN = /^[A-Za-z0-9._~!?$&'()*+,;=:@%\-/]+$/u;
const SENSITIVE_QUERY_KEY = /(?:token|secret|password|cookie|authorization|auth|email|key)/iu;
const SECRET_LIKE_VALUE = /(?:sk_(?:live|test)_|bearer\s+|api[_-]?key|password\s*=|secret\s*=|token\s*=)/iu;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const WEB_SERVER_PREFIX_PATTERN = /\[WebServer(?:[^\]]*)\]\s?/gu;
const HYDRATION_ERROR_PATTERN = /(?:hydration failed because (?:the server rendered|the initial ui does not match)|text content did not match|a tree hydrated but some attributes of the server rendered|this will cause a hydration error|minified react error #418\b)/iu;
const STDERR_TAIL_LENGTH = 512;

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

export function resolveCandidateFingerprint(options = {}, env = process.env) {
  return firstDefined(
    options.candidateFingerprint,
    options.fingerprint,
    env.PLAYWRIGHT_RELEASE_CANDIDATE_FINGERPRINT,
    env.CUSTOMER_READINESS_CANDIDATE_FINGERPRINT,
    env.CANDIDATE_FINGERPRINT,
  );
}

export function resolveOutputPath(options = {}, env = process.env) {
  const outputRoot = resolve(process.cwd(), "test-results");
  const outputPath = resolve(
    process.cwd(),
    firstDefined(options.outputPath, options.manifestPath, env.PLAYWRIGHT_RELEASE_MANIFEST_PATH, env.GATE_B_MANIFEST_PATH, DEFAULT_OUTPUT_PATH),
  );
  const relativePath = relative(outputRoot, outputPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("release_manifest_path_outside_test_results");
  }
  return outputPath;
}

export function resolveEnvironment(options = {}, env = process.env) {
  return firstDefined(
    options.environment,
    options.environmentToken,
    env.PLAYWRIGHT_RELEASE_ENV,
    env.GATE_B_ENVIRONMENT,
    env.E2E_ENVIRONMENT,
    env.NODE_ENV,
    DEFAULT_ENVIRONMENT,
  );
}

export function resolveRunOrigin(options = {}, env = process.env) {
  return firstDefined(options.runOrigin, options.actualOrigin, env.PLAYWRIGHT_RELEASE_ORIGIN);
}

export function resolveServerIdentity(options = {}, env = process.env) {
  return firstDefined(options.serverIdentity, options.serverId, env.PLAYWRIGHT_RELEASE_SERVER_ID);
}

function safeRunOrigin(value) {
  try {
    return parseExactLoopbackOrigin(value).origin;
  } catch {
    return null;
  }
}

function safeToken(value, max = 64) {
  return typeof value === "string" && value.length > 0 && value.length <= max && TOKEN_PATTERN.test(value) && !SECRET_LIKE_VALUE.test(value)
    ? value
    : null;
}

function safeAnnotationValue(value, type) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return null;
  }
  if (type === "finalUrl") return safeRelativeUrl(value);
  if (value.length > 128) return null;
  if (!ANNOTATION_PATTERN.test(value) || SECRET_LIKE_VALUE.test(value) || /:\/\//u.test(value) || /[\u0000-\u001f\u007f<>`]/u.test(value)) {
    return null;
  }
  return value;
}

function safeRelativeUrl(value) {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /:\/\//u.test(value) ||
    SECRET_LIKE_VALUE.test(value) ||
    /[\u0000-\u001f\u007f<>`\\]/u.test(value)
  ) return null;
  let parsed;
  try {
    parsed = new URL(value, "http://gate-b.local");
  } catch {
    return null;
  }
  if (parsed.origin !== "http://gate-b.local" || parsed.pathname.length > 160 || value.length > 256) return null;
  if (!parsed.pathname.split("/").every((segment) => segment === "" || URL_TOKEN_PATTERN.test(segment))) return null;
  if (parsed.hash && (!URL_TOKEN_PATTERN.test(parsed.hash.slice(1)) || SECRET_LIKE_VALUE.test(parsed.hash))) return null;
  for (const [key, queryValue] of parsed.searchParams) {
    if (key === "redirectTo") {
      if (safeRelativeUrl(queryValue) === null) return null;
      continue;
    }
    if (
      SENSITIVE_QUERY_KEY.test(key) ||
      !URL_TOKEN_PATTERN.test(key) ||
      !URL_TOKEN_PATTERN.test(queryValue) ||
      /:\/\//u.test(queryValue) ||
      queryValue.startsWith("//")
    ) return null;
  }
  return value;
}

function releaseArtifactDefinition(entry) {
  const definition = RELEASE_ARTIFACT_STATE_MATRIX[entry?.scenario];
  return definition && RELEASE_COVERAGE_VIEWPORTS.includes(entry?.viewport) ? definition : null;
}

export function expectedReleaseArtifacts(entry) {
  const definition = releaseArtifactDefinition(entry);
  if (!definition) return [];
  return definition.states.flatMap((state) => [
    {
      kind: "screenshot",
      state,
      attachmentName: `${definition.prefix}-${entry.viewport}-${state}.png`,
      contentType: ARTIFACT_SCREENSHOT_CONTENT_TYPE,
    },
    {
      kind: "aria",
      state,
      attachmentName: `${definition.prefix}-${entry.viewport}-${state}.aria.json`,
      contentType: ARTIFACT_ARIA_CONTENT_TYPE,
    },
  ]);
}

function isReleaseArtifactAttachment(name) {
  return typeof name === "string" && /^(?:j1|j2-[a-z0-9-]+|j3-[a-z0-9-]+|j4-[a-z0-9-]+|j5-[a-z0-9-]+|j6-[a-z0-9-]+)-/u.test(name);
}

function validArtifactBody(expected, attachment) {
  if (!attachment || attachment.path || !Buffer.isBuffer(attachment.body) || attachment.contentType !== expected.contentType) {
    return false;
  }
  const body = attachment.body;
  if (expected.kind === "screenshot") {
    return body.length >= PNG_SIGNATURE.length && body.length <= MAX_SCREENSHOT_BYTES && body.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  }
  if (body.length === 0 || body.length > MAX_ARIA_BYTES) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (text.trim().length === 0 || /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) return false;
    // Issue #1727: aria evidence is captured via ariaSnapshotJSON() — a JSON
    // value of ARIA nodes — so validation is a strict JSON parse, not a YAML
    // document parse.
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function safeArtifactRelativeName(value) {
  return typeof value === "string" &&
    (value.startsWith("gate-b-artifacts/") || value.includes("/gate-b-artifacts/")) &&
    !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !value.includes("://") &&
    !SECRET_LIKE_VALUE.test(value) &&
    !/[\u0000-\u001f\u007f<>`]/u.test(value)
    ? value
    : null;
}

export function validateReleaseArtifacts(entries) {
  const issues = [];
  const seenNames = new Set();
  for (const entry of entries) {
    const expected = expectedReleaseArtifacts(entry);
    const artifacts = Array.isArray(entry?.artifacts) ? entry.artifacts : [];
    if (expected.length === 0) {
      issues.push("artifact_scope_unsupported");
      continue;
    }
    if (artifacts.length !== expected.length) issues.push("artifact_count");
    for (const requirement of expected) {
      const matches = artifacts.filter((artifact) =>
        artifact?.kind === requirement.kind &&
        artifact?.state === requirement.state &&
        artifact?.contentType === requirement.contentType &&
        typeof artifact?.name === "string" &&
        artifact.name.endsWith(`/${requirement.attachmentName}`),
      );
      if (matches.length !== 1) {
        issues.push(matches.length > 1 ? "artifact_duplicate" : "artifact_missing");
        continue;
      }
      const artifact = matches[0];
      if (
        safeArtifactRelativeName(artifact.name) === null ||
        !Number.isInteger(artifact.bytes) ||
        artifact.bytes <= 0 ||
        !FINGERPRINT_PATTERN.test(artifact.sha256 ?? "") ||
        seenNames.has(artifact.name)
      ) {
        issues.push(seenNames.has(artifact.name) ? "artifact_duplicate" : "artifact_metadata");
      }
      seenNames.add(artifact.name);
    }
    if (artifacts.some((artifact) => !expected.some((requirement) => artifact?.name?.endsWith(`/${requirement.attachmentName}`)))) {
      issues.push("artifact_extra");
    }
  }
  return [...new Set(issues)].sort();
}

function parseReleaseCoverageScope(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const tokens = value.split(",").map((token) => token.trim());
  if (tokens.length === 0 || tokens.some((token) => !/^[1-6]$/u.test(token))) {
    return { issues: ["coverage_scope_invalid"] };
  }
  const journeys = tokens.map(Number);
  if (new Set(journeys).size !== journeys.length) {
    return { issues: ["coverage_scope_duplicate"] };
  }
  return { journeys };
}

function finalUrlMatches(actual, expected) {
  if (expected.exact) return actual === expected.exact;
  if (typeof actual !== "string" || !actual.startsWith(`${expected.pathname}?`)) return false;
  let parsed;
  try {
    parsed = new URL(actual, "http://gate-b.local");
  } catch {
    return false;
  }
  if (parsed.pathname !== expected.pathname || parsed.hash) return false;
  if (expected.search) {
    const expectedKeys = Object.keys(expected.search);
    if (parsed.searchParams.size !== expectedKeys.length) return false;
    if (expectedKeys.some((key) => parsed.searchParams.get(key) !== expected.search[key])) return false;
  }
  if (expected.searchKeys) {
    if (parsed.searchParams.size !== expected.searchKeys.length) return false;
    if (expected.searchKeys.some((key) => !parsed.searchParams.has(key))) return false;
    if (expected.searchKeys.some((key) => parsed.searchParams.get(key)?.trim() === "")) return false;
  }
  return true;
}

function coverageEntryMatches(actual, expected) {
  return (
    actual?.sourceFile === expected.sourceFile &&
    actual?.persona === expected.persona &&
    actual?.scenario === expected.scenario &&
    actual?.viewport === expected.viewport &&
    finalUrlMatches(actual?.finalUrl, expected.finalUrl)
  );
}

export function validateReleaseCoverage(entries, releaseJourneys) {
  if (!Array.isArray(releaseJourneys) || releaseJourneys.length === 0) {
    return ["coverage_scope_missing"];
  }
  const expected = [];
  for (const journey of releaseJourneys) {
    const matrix = RELEASE_COVERAGE_MATRIX[journey];
    if (!matrix) return ["coverage_scope_unsupported"];
    expected.push(...matrix);
  }
  if (!Array.isArray(entries) || entries.length !== expected.length) {
    return [`coverage_count:${String(entries?.length ?? 0)}:${expected.length}`];
  }
  const used = new Set();
  const issues = [];
  for (const expectation of expected) {
    const matchIndex = entries.findIndex((entry, entryIndex) => !used.has(entryIndex) && coverageEntryMatches(entry, expectation));
    if (matchIndex === -1) {
      issues.push(`coverage_missing:${expectation.sourceFile}:${expectation.scenario}:${expectation.viewport}`);
    } else {
      used.add(matchIndex);
    }
  }
  if (used.size !== entries.length) issues.push("coverage_unexpected_entry");
  return issues;
}

export function supportsReleaseCoverage(releaseJourneys) {
  return Array.isArray(releaseJourneys) && releaseJourneys.length > 0 && releaseJourneys.every((journey) => Boolean(RELEASE_COVERAGE_MATRIX[journey]));
}

export function readAnnotations(test, result) {
  const annotations = [];
  const seen = new Set();
  for (const annotation of [...(test?.annotations ?? []), ...(result?.annotations ?? [])]) {
    const key = `${String(annotation?.type ?? "")}\u0000${String(annotation?.description ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    annotations.push(annotation);
  }
  const values = {};
  const issues = [];
  for (const type of REQUIRED_ANNOTATIONS) {
    const matches = annotations.filter((annotation) => annotation?.type === type);
    const value = safeAnnotationValue(matches[0]?.description, type);
    if (matches.length !== 1 || value === null) issues.push(`annotation:${type}`);
    values[type] = value;
  }
  for (const type of BLOCKING_ANNOTATIONS) {
    if (annotations.some((annotation) => annotation?.type === type)) issues.push(`annotation:${type}`);
  }
  let hydrationError = null;
  for (const annotation of annotations.filter((value) => value?.type === "reactHydrationError")) {
    const source = annotation?.description;
    issues.push(
      source === "console" || source === "pageerror"
        ? `browser_hydration_error:${source}`
        : "browser_hydration_error",
    );
  }
  // The detail annotation (written by the release hydration bridge) carries
  // the first occurrence's message text, page URL and test title so a red
  // run names the surface in the manifest and the job log. Only the first
  // parseable detail is attached; the source annotation already classifies
  // the issue.
  for (const annotation of annotations.filter((value) => value?.type === "reactHydrationErrorDetail")) {
    const parsed = parseHydrationErrorDetail(annotation?.description);
    if (parsed) {
      hydrationError = parsed;
      break;
    }
  }
  return { values, issues, hydrationError };
}

const HYDRATION_DETAIL_MAX_MESSAGE = 300;
const HYDRATION_DETAIL_MAX_URL = 256;
const HYDRATION_DETAIL_MAX_TITLE = 200;
// Global variant of SECRET_LIKE_VALUE so every secret-like substring in a
// captured hydration message is redacted, not just the first. The module-level
// SECRET_LIKE_VALUE is intentionally non-global (single-shot validation use);
// redaction must sweep the whole string.
const SECRET_LIKE_VALUE_GLOBAL =
  /(?:sk_(?:live|test)_[A-Za-z0-9_-]*|rk_(?:live|test)_[A-Za-z0-9_-]*|bearer\s+[A-Za-z0-9.\-_~$]+|(?:api[_-]?key|password|secret|token)\s*[:=]\s*[A-Za-z0-9.\-_~$]*)/giu;

function parseHydrationErrorDetail(description) {
  if (typeof description !== "string" || description.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(description);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const source = parsed.source === "console" || parsed.source === "pageerror" ? parsed.source : null;
  const message = typeof parsed.message === "string" ? parsed.message.slice(0, HYDRATION_DETAIL_MAX_MESSAGE) : null;
  const url = typeof parsed.url === "string" ? parsed.url.slice(0, HYDRATION_DETAIL_MAX_URL) : null;
  const title = typeof parsed.title === "string" ? parsed.title.slice(0, HYDRATION_DETAIL_MAX_TITLE) : null;
  if (!source || message === null || url === null || title === null) return null;
  // Never trust the captured text to have scrubbed secrets — re-redact the
  // message AND the URL (a credential-bearing query string must never reach
  // the manifest or job log) so a malformed bridge cannot leak a token.
  const safeMessage = String(message).replace(SECRET_LIKE_VALUE_GLOBAL, "[redacted]");
  const safeUrl = String(url).replace(SECRET_LIKE_VALUE_GLOBAL, "[redacted]");
  const safeTitle = String(title).replace(SECRET_LIKE_VALUE_GLOBAL, "[redacted]");
  return { source, message: safeMessage, url: safeUrl, title: safeTitle };
}

function projectIdentity(test) {
  const project = typeof test?.parent?.project === "function" ? test.parent.project() : test?.project;
  const projectName = safeToken(project?.name, 96) ?? "unknown";
  const browser = safeToken(
    project?.use?.browserName ?? project?.use?.defaultBrowserType,
    32,
  ) ?? "unknown";
  return { browser, project: projectName };
}

function testSource(test) {
  const source = test?.location?.file;
  const sourceFile = typeof source === "string" && source.length > 0 ? basename(source) : null;
  return sourceFile && sourceFile.length <= 128 && !SECRET_LIKE_VALUE.test(sourceFile) ? sourceFile : null;
}

function runStatus(result) {
  return ["passed", "failed", "timedOut", "skipped", "interrupted"].includes(result?.status)
    ? result.status
    : "failed";
}

export function createManifestEntry(test, result, firstResult = result) {
  const annotations = readAnnotations(test, result);
  const first = runStatus(firstResult);
  const status = runStatus(result);
  const identity = projectIdentity(test);
  const retry = Number.isInteger(result?.retry) && result.retry >= 0 ? result.retry : 0;
  const issues = [...annotations.issues];
  if (testSource(test) === null) issues.push("source_file");
  if (identity.browser === "unknown") issues.push("browser");
  if (identity.project === "unknown") issues.push("project");
  if (typeof test?.expectedStatus === "string" && test.expectedStatus !== "passed") issues.push(`expected_status:${test.expectedStatus}`);
  if (status !== "passed") issues.push(`status:${status}`);
  if (retry > 0) issues.push("retry");
  return {
    entry: {
      sourceFile: testSource(test),
      browser: identity.browser,
      project: identity.project,
      persona: annotations.values.persona,
      scenario: annotations.values.scenario,
      viewport: annotations.values.viewport,
      finalUrl: annotations.values.finalUrl,
      status,
      retry,
      firstAttempt: {
        status: first,
        passed: first === "passed",
        retry: Number.isInteger(firstResult?.retry) && firstResult.retry >= 0 ? firstResult.retry : 0,
      },
      ...(annotations.hydrationError ? { hydrationError: annotations.hydrationError } : {}),
    },
    issues,
  };
}

export function buildManifest({
  candidateFingerprint,
  environment,
  runOrigin,
  serverIdentity,
  entries,
  status = "passed",
  strict = true,
  issues = [],
}) {
  const fingerprint = typeof candidateFingerprint === "string" ? candidateFingerprint : null;
  const environmentToken = safeToken(environment, 64);
  const exactRunOrigin = safeRunOrigin(runOrigin);
  const exactServerIdentity = isLocalReleaseServerIdentity(serverIdentity) ? serverIdentity : null;
  const manifestIssues = [...issues];
  if (!FINGERPRINT_PATTERN.test(fingerprint ?? "")) manifestIssues.push("candidate_fingerprint");
  if (environmentToken === null) manifestIssues.push("environment");
  if (exactRunOrigin === null) manifestIssues.push("run_origin");
  if (exactServerIdentity === null) manifestIssues.push("server_identity");
  const sortKey = (entry) =>
    [entry.sourceFile, entry.project, entry.browser, entry.persona, entry.scenario, entry.viewport, entry.finalUrl, entry.retry]
      .map((value) => String(value ?? ""))
      .join("\u0000");
  const sortedEntries = [...entries].sort((left, right) => {
    const leftKey = sortKey(left);
    const rightKey = sortKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    candidateFingerprint: FINGERPRINT_PATTERN.test(fingerprint ?? "") ? fingerprint : null,
    environment: environmentToken,
    runOrigin: exactRunOrigin,
    serverIdentity: exactServerIdentity,
    status: strict && manifestIssues.length > 0 ? "failed" : status,
    strict,
    entries: sortedEntries,
    ...(manifestIssues.length > 0 ? { strictIssues: [...new Set(manifestIssues)].sort() } : {}),
  };
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Preserve the original write failure without exposing filesystem details.
    }
    throw error;
  }
}

export function writePreflightManifest(path, {
  candidateFingerprint,
  environment,
  runOrigin,
  serverIdentity,
}) {
  const manifest = buildManifest({
    candidateFingerprint,
    environment,
    runOrigin,
    serverIdentity,
    entries: [],
    status: "failed",
    strict: true,
    issues: ["run_not_completed"],
  });
  atomicWrite(path, manifest);
  return manifest;
}

export function markManifestFailed(path, issue) {
  const safeIssue = safeToken(issue, 96);
  if (!safeIssue) throw new Error("invalid_manifest_failure_issue");

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("release_manifest_unavailable");
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !FINGERPRINT_PATTERN.test(manifest.candidateFingerprint ?? "") ||
    safeToken(manifest.environment, 64) === null ||
    safeRunOrigin(manifest.runOrigin) === null ||
    !isLocalReleaseServerIdentity(manifest.serverIdentity) ||
    typeof manifest.strict !== "boolean" ||
    !Array.isArray(manifest.entries) ||
    (manifest.strictIssues !== undefined && !Array.isArray(manifest.strictIssues))
  ) {
    throw new Error("invalid_release_manifest");
  }

  const currentIssues = (manifest.strictIssues ?? []).filter(
    (value) => typeof value === "string" && safeToken(value, 96),
  );
  const failedManifest = {
    ...manifest,
    status: "failed",
    strictIssues: [...new Set([...currentIssues, safeIssue])].sort(),
  };
  atomicWrite(path, failedManifest);
  return failedManifest;
}

function safeCountRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_postflight_counts");
  }
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{0,95}$/u.test(key) || !Number.isInteger(Number(raw)) || Number(raw) < 0) {
      throw new Error("invalid_postflight_counts");
    }
    output[key] = Number(raw);
  }
  return output;
}

export function recordManifestPostflight(path, evidence) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("release_manifest_unavailable");
  }
  const journeys = Array.isArray(evidence?.journeys) ? evidence.journeys : [];
  const config = evidence?.launchConfig;
  const restore = evidence?.scratchRestore;
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !FINGERPRINT_PATTERN.test(manifest.candidateFingerprint ?? "") ||
    manifest.status !== "passed" ||
    !Array.isArray(manifest.entries) ||
    journeys.length === 0 ||
    journeys.some((journey, index) => !Number.isInteger(journey) || journey < 1 || journey > 6 || journeys.indexOf(journey) !== index) ||
    !config ||
    typeof config !== "object" ||
    !FINGERPRINT_PATTERN.test(config.identity ?? "") ||
    !FINGERPRINT_PATTERN.test(config.wranglerWorktreeSha256 ?? "") ||
    config.productionSearchRolloutMode !== "v2" ||
    config.localProofSearchRolloutMode !== "v2" ||
    config.providerNetworkDeny !== true ||
    config.authProvider !== "better-auth" ||
    !RELEASE_PROOF_PROJECT_PATTERN.test(config.browserProject ?? "") ||
    config.retries !== 0 ||
    config.workers !== 1 ||
    !restore ||
    typeof restore !== "object" ||
    !FINGERPRINT_PATTERN.test(restore.sourceDumpSha256 ?? "") ||
    !FINGERPRINT_PATTERN.test(restore.transformedSqlSha256 ?? "") ||
    !["sourceBytes", "transformedBytes", "transformedStatements", "maximumStatementBytes", "tableCount", "totalRows", "migrations", "latestMigrationId", "planRows", "linkedPlanRows", "foreignKeyViolations"].every((key) => Number.isInteger(restore[key]) && restore[key] >= 0) ||
    restore.maximumStatementBytes > 90_000 ||
    restore.integrity !== "ok" ||
    restore.foreignKeyViolations !== 0 ||
    restore.exactRowCounts !== true ||
    restore.dodoLinkagePreserved !== true ||
    restore.scratchDatabaseRemoved !== true ||
    evidence?.isolatedPersistenceRemoved !== true
  ) {
    throw new Error("invalid_manifest_postflight");
  }
  const postflight = {
    journeys: [...journeys],
    releaseState: safeCountRecord(evidence.releaseState),
    fixtureState: safeCountRecord(evidence.fixtureState),
    launchConfig: {
      identity: config.identity,
      wranglerWorktreeSha256: config.wranglerWorktreeSha256,
      productionSearchRolloutMode: config.productionSearchRolloutMode,
      localProofSearchRolloutMode: config.localProofSearchRolloutMode,
      providerNetworkDeny: true,
      authProvider: "better-auth",
      browserProject: config.browserProject,
      retries: 0,
      workers: 1,
    },
    scratchRestore: {
      sourceDumpSha256: restore.sourceDumpSha256,
      transformedSqlSha256: restore.transformedSqlSha256,
      sourceBytes: restore.sourceBytes,
      transformedBytes: restore.transformedBytes,
      transformedStatements: restore.transformedStatements,
      maximumStatementBytes: restore.maximumStatementBytes,
      tableCount: restore.tableCount,
      totalRows: restore.totalRows,
      migrations: restore.migrations,
      latestMigrationId: restore.latestMigrationId,
      planRows: restore.planRows,
      linkedPlanRows: restore.linkedPlanRows,
      integrity: "ok",
      foreignKeyViolations: 0,
      exactRowCounts: true,
      dodoLinkagePreserved: true,
      scratchDatabaseRemoved: true,
    },
    isolatedPersistenceRemoved: true,
  };
  const nextManifest = { ...manifest, postflight };
  atomicWrite(path, nextManifest);
  return nextManifest;
}

function prepareArtifactRoot(outputPath, candidateFingerprint, serverIdentity) {
  if (!FINGERPRINT_PATTERN.test(candidateFingerprint ?? "") || !isLocalReleaseServerIdentity(serverIdentity)) {
    return { path: null, issues: ["artifact_root_identity"] };
  }
  const testResultsRoot = resolve(process.cwd(), "test-results");
  const artifactRoot = resolve(dirname(outputPath), "gate-b-artifacts", candidateFingerprint, serverIdentity);
  const relativeRoot = relative(testResultsRoot, artifactRoot).split(sep).join("/");
  if (safeArtifactRelativeName(`${relativeRoot}/artifact`) === null) {
    return { path: null, issues: ["artifact_root_unsafe"] };
  }
  if (existsSync(artifactRoot)) return { path: null, issues: ["artifact_root_stale"] };
  try {
    mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  } catch {
    return { path: null, issues: ["artifact_root_unavailable"] };
  }
  return { path: artifactRoot, issues: [] };
}

function persistReleaseArtifacts(entry, result, artifactRoot) {
  const expected = expectedReleaseArtifacts(entry);
  const attachments = Array.isArray(result?.attachments) ? result.attachments : [];
  const releaseAttachments = attachments.filter((attachment) => isReleaseArtifactAttachment(attachment?.name));
  const issues = [];
  const artifacts = [];
  if (!artifactRoot) return { artifacts, issues: ["artifact_root_unavailable"] };
  if (expected.length === 0) return { artifacts, issues: ["artifact_scope_unsupported"] };
  if (releaseAttachments.length !== expected.length) issues.push("artifact_count");
  for (const requirement of expected) {
    const matches = releaseAttachments.filter((attachment) => attachment?.name === requirement.attachmentName);
    if (matches.length !== 1) {
      issues.push(matches.length > 1 ? "artifact_duplicate" : "artifact_missing");
      continue;
    }
    const attachment = matches[0];
    if (!validArtifactBody(requirement, attachment)) {
      issues.push("artifact_invalid");
      continue;
    }
    const filePath = resolve(artifactRoot, requirement.attachmentName);
    if (dirname(filePath) !== artifactRoot) {
      issues.push("artifact_unsafe_name");
      continue;
    }
    try {
      writeFileSync(filePath, attachment.body, { flag: "wx", mode: 0o600 });
      const stored = readFileSync(filePath);
      if (!stored.equals(attachment.body)) {
        issues.push("artifact_hash");
        continue;
      }
      const relativeName = relative(resolve(process.cwd(), "test-results"), filePath).split(sep).join("/");
      if (safeArtifactRelativeName(relativeName) === null) {
        issues.push("artifact_unsafe_name");
        continue;
      }
      artifacts.push({
        kind: requirement.kind,
        state: requirement.state,
        name: relativeName,
        contentType: requirement.contentType,
        bytes: stored.length,
        sha256: sha256(stored),
      });
    } catch {
      issues.push("artifact_write");
    }
  }
  if (releaseAttachments.some((attachment) => !expected.some((requirement) => requirement.attachmentName === attachment?.name))) {
    issues.push("artifact_extra");
  }
  artifacts.sort((left, right) => left.name.localeCompare(right.name));
  return { artifacts, issues };
}

function validateArtifactRootFiles(artifactRoot, entries) {
  if (!artifactRoot) return ["artifact_root_unavailable"];
  const expected = new Set(entries.flatMap((entry) => (entry.artifacts ?? []).map((artifact) => basename(artifact.name))));
  let actual;
  try {
    actual = readdirSync(artifactRoot);
  } catch {
    return ["artifact_root_unavailable"];
  }
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) return ["artifact_root_stale"];
  return [];
}

export class GateBManifestReporter {
  constructor(options = {}) {
    this.options = options;
    this.strict = options.strict !== false;
    this.candidateFingerprint = resolveCandidateFingerprint(options);
    this.environment = resolveEnvironment(options);
    this.runOrigin = resolveRunOrigin(options);
    this.serverIdentity = resolveServerIdentity(options);
    this.outputPath = resolveOutputPath(options);
    const configuredCoverageScope = firstDefined(options.releaseJourneys, process.env.E2E_RELEASE_JOURNEYS);
    this.releaseJourneys = configuredCoverageScope === null
      ? null
      : parseReleaseCoverageScope(configuredCoverageScope);
    this.tests = [];
    this.results = new Map();
    this.globalIssues = [];
    this.stderrTail = "";
    this.hydrationErrorDetected = false;
    this.artifactRootPath = null;
    this.artifactsRequired = Boolean(
      this.strict &&
      this.releaseJourneys?.journeys &&
      supportsReleaseCoverage(this.releaseJourneys.journeys),
    );
  }

  printsToStdio() {
    return false;
  }

  onBegin(config, suite) {
    this.tests = typeof suite?.allTests === "function" ? suite.allTests() : [];
    if (this.strict && Array.isArray(config?.projects)) {
      const releaseProject = config.projects.find((project) => project?.name === "local-release");
      const projectOrigin = safeRunOrigin(releaseProject?.use?.baseURL);
      const manifestOrigin = safeRunOrigin(this.runOrigin);
      if (projectOrigin === null) this.globalIssues.push("project_base_url");
      else if (manifestOrigin !== null && projectOrigin !== manifestOrigin) this.globalIssues.push("project_origin_mismatch");
    }
    if (this.artifactsRequired) {
      const prepared = prepareArtifactRoot(this.outputPath, this.candidateFingerprint, this.serverIdentity);
      this.artifactRootPath = prepared.path;
      this.globalIssues.push(...prepared.issues);
    }
  }

  onTestEnd(test, result) {
    const existing = this.results.get(test.id) ?? [];
    existing.push(result);
    this.results.set(test.id, existing);
  }

  onStdErr(chunk, test) {
    if (!this.strict || this.hydrationErrorDetected || test !== undefined) return;
    const rawText = `${this.stderrTail}${String(chunk ?? "")}`;
    const text = rawText
      .replace(ANSI_ESCAPE_PATTERN, "")
      .replace(WEB_SERVER_PREFIX_PATTERN, "");
    if (HYDRATION_ERROR_PATTERN.test(text)) {
      this.hydrationErrorDetected = true;
      return;
    }
    this.stderrTail = rawText.slice(-STDERR_TAIL_LENGTH);
  }

  onEnd(fullResult = { status: "failed" }) {
    const entries = [];
    if (this.hydrationErrorDetected) this.globalIssues.push("server_hydration_error");
    if (this.tests.length === 0) this.globalIssues.push("no_tests");
    for (const test of this.tests) {
      const results = this.results.get(test.id) ?? [];
      if (results.length === 0) {
        const synthetic = { status: test.expectedStatus === "skipped" ? "skipped" : "interrupted", retry: 0, annotations: [] };
        const built = createManifestEntry(test, synthetic, synthetic);
        if (this.artifactsRequired) built.entry.artifacts = [];
        entries.push(built.entry);
        this.globalIssues.push("missing_result");
        if (this.artifactsRequired) this.globalIssues.push("artifact_missing");
        continue;
      }
      const first = results[0];
      for (const result of results) {
        const built = createManifestEntry(test, result, first);
        if (this.artifactsRequired) {
          const persisted = persistReleaseArtifacts(built.entry, result, this.artifactRootPath);
          built.entry.artifacts = persisted.artifacts;
          this.globalIssues.push(...persisted.issues);
        }
        entries.push(built.entry);
        this.globalIssues.push(...built.issues);
      }
    }
    if (this.artifactsRequired) {
      this.globalIssues.push(...validateReleaseArtifacts(entries));
      this.globalIssues.push(...validateArtifactRootFiles(this.artifactRootPath, entries));
    }
    // Surface the first captured hydration error to the job log so a red run
    // names the failing page, test title and message text without requiring
    // a reader to open the manifest artifact.
    for (const entry of entries) {
      if (entry?.hydrationError) {
        process.stderr.write(
          `release hydration error: source=${entry.hydrationError.source} url=${entry.hydrationError.url} title=${entry.hydrationError.title} message=${entry.hydrationError.message}\n`,
        );
        break;
      }
    }
    if (fullResult.status !== "passed") this.globalIssues.push(`run:${fullResult.status}`);
    const manifest = buildManifest({
      candidateFingerprint: this.candidateFingerprint,
      environment: this.environment,
      runOrigin: this.runOrigin,
      serverIdentity: this.serverIdentity,
      entries,
      status: fullResult.status,
      strict: this.strict,
      issues: this.globalIssues,
    });
    if (this.strict && this.releaseJourneys !== null) {
      const coverageIssues = this.releaseJourneys.issues ?? validateReleaseCoverage(entries, this.releaseJourneys.journeys);
      if (coverageIssues.length > 0) {
        manifest.status = "failed";
        manifest.strictIssues = [...new Set([...(manifest.strictIssues ?? []), ...coverageIssues])].sort();
      }
    }
    atomicWrite(this.outputPath, manifest);
    if (this.strict && manifest.status === "failed") return { status: "failed" };
    return { status: fullResult.status };
  }
}

export default GateBManifestReporter;
