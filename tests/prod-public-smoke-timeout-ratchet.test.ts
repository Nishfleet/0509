import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// prod-public deploy-smoke timeout ratchet (0509#1529).
//
// 2026-09-01: the prod-public smoke (the final gate in Deploy production)
// inherited the global 10s actionTimeout and used an explicit 5s request
// timeout. A freshly deployed Worker can take >10s to serve its first
// request during deploy propagation, so run 33531233486 (main 7fc115b9)
// false-failed the smoke at GET /llms.txt (10s) and GET / (5s), auto-rolled
// back a successful deploy, and left main red for over an hour
// (FleetMainRed from 2026-09-01T17:10Z) — no automatic recovery landed
// because the parent commit's deploy also failed in the same window.
// Fix 0ccf42da widened the budgets (actionTimeout 30s, request 15s); a
// healthy 0509.io answers in 1-3s, so those stay tight bounds on a hard
// hang.
//
// This test is the mechanism that prevents the failure class from
// regressing: any change that tightens the prod-public smoke below the
// proven floor fails CI on the PR that introduces it, instead of rolling
// back the next deploy.

const PROD_PUBLIC_ACTION_TIMEOUT_FLOOR_MS = 30_000;
const PUBLIC_PROBE_REQUEST_TIMEOUT_FLOOR_MS = 15_000;

function numberLiteral(source: string, pattern: RegExp): number | undefined {
  const match = source.match(pattern);
  return match ? Number(match[1].replace(/_/g, "")) : undefined;
}

describe("prod-public deploy-smoke timeout ratchet", () => {
  it("keeps the prod-public project actionTimeout at the proven deploy-propagation floor", () => {
    const config = readFileSync("playwright.config.ts", "utf8");
    const projectStart = config.indexOf('name: "prod-public"');
    expect(
      projectStart,
      "playwright.config.ts must still define the prod-public project",
    ).toBeGreaterThanOrEqual(0);
    const blockEnd = config.indexOf("},", projectStart);
    const block = config.slice(projectStart, blockEnd === -1 ? projectStart + 2_000 : blockEnd);
    const actionTimeout = numberLiteral(block, /actionTimeout:\s*(\d[\d_]*)/);
    expect(
      actionTimeout,
      "prod-public actionTimeout fell below the proven floor; the deploy smoke will false-fail on the propagation tail again (0509#1529)",
    ).toBeGreaterThanOrEqual(PROD_PUBLIC_ACTION_TIMEOUT_FLOOR_MS);
  });

  it("keeps the live public probe request timeout at the proven deploy-propagation floor", () => {
    const spec = readFileSync("e2e/prod-public.spec.ts", "utf8");
    const requestStart = spec.indexOf("request.get(");
    expect(
      requestStart,
      "expectPublicGetTargetReachable must still probe with request.get",
    ).toBeGreaterThanOrEqual(0);
    const call = spec.slice(requestStart, requestStart + 300);
    const timeout = numberLiteral(call, /timeout:\s*(\d[\d_]*)/);
    expect(
      timeout,
      "prod-public public-probe request timeout fell below the proven floor; the deploy smoke will false-fail on the propagation tail again (0509#1529)",
    ).toBeGreaterThanOrEqual(PUBLIC_PROBE_REQUEST_TIMEOUT_FLOOR_MS);
  });
});