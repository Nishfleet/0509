#!/usr/bin/env node
// Free-preview recall audit over the BET 2 25 well-known-advertiser domains
// (issue #3014).
//
// The issue's metric: over the 25 well-known advertiser domains (mixed
// US/EU/IN, DTC + B2B), 0 dead-end "No verified ads found" empty states and
// >=80% of domains returning at least one verified row. The 25-domain set IS
// `BET2_DOMAINS` in bet2-live-verification.mjs (the §1.8 six-domain rerun with
// the observed allbirds/notion/oura dead-ends rides along, as it does in
// `canary:bet2`), so this audit measures exactly that cohort rather than
// inventing a drifted parallel list (fleet-ops#517: do not hand-build a
// second copy of an existing gate's domain set).
//
// The gap this script closes: `node scripts/bet2-live-verification.mjs
// --cohort=25` already evaluates those gates, but only by hand (its
// termination command in the 1851/3014 verify runs) — nothing on the VPS
// ran it on a schedule, and a recall/precision regression dead-ending a
// real brand surfaced only when a scout happened to look (ops/
// search-recall-audit/ installs the systemd user timer that closes that).
//
// Reuses runLiveVerification + evaluateTermination + evaluateSection18Rerun
// from bet2-live-verification.mjs so the probe/retry/pace logic and the
// verdict thresholds stay in one place; this wrapper keeps the verdict
// composition testable offline.
//
// Usage:  node scripts/search-recall-audit.mjs
// Exit 0 pass, exit 1 fail, exit 2 on an internal error.

import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BET2_DOMAINS,
  DEFAULT_BASE_URL,
  createRateLimiter,
  evaluateSection18Rerun,
  evaluateTermination,
  runLiveVerification,
  SECTION_1_8_RERUN,
} from "./bet2-live-verification.mjs";

/**
 * The audit measures the VISITOR first-card experience: entry.server.tsx
 * waits for `renderToReadableStream(...).allReady` when isbot(ua) matches
 * (correct for crawlers — full HTML including streamed boundaries), so a
 * bare `name/1.0` UA (bot-classed by isbot's naive pattern, along with
 * `curl/8.5.0`) would time the crawler path and block the first card on the
 * landing capture forever. A browser-shaped UA with the probe tag appended
 * measures the streaming path the funnel's front door actually serves, while
 * still identifying the probe in access logs. `audit`/`check` tokens are
 * isbot patterns; `0509-recall-probe` is not (pinned by the unit test).
 */
export const RECALL_AUDIT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 0509-recall-probe/1.0";

/**
 * Compose the issue-#3014 metric verdict from the BET 2 machinery:
 *  - gate 1: 0 dead-end empty states over the 25-domain cohort (+ no 429 /
 *    errored probes — "cannot confirm" is never a pass);
 *  - gate 2: >=80% of domains return at least one verified row;
 *  - gate 3: the §1.8 observed brands (allbirds / notion / oura) each render
 *    at least one row — the funnel's front door must not dead-end.
 * @param {{ results: import("./bet2-live-verification.mjs").ProbeResult[], summary: import("./bet2-live-verification.mjs").Summary }} run
 * @param {{ results: import("./bet2-live-verification.mjs").ProbeResult[] }} rerun
 * @param {{ verifiedShareFloor?: number }} [options] test seam for the floor
 * @returns {{ pass: boolean, checks: { ok: boolean, name: string, detail: string }[] }}
 */
export function evaluateRecallAudit(run, rerun, options = {}) {
  const termination = evaluateTermination(run.summary, options);
  const rerunVerdict = evaluateSection18Rerun(rerun.results);
  return {
    pass: termination.pass && rerunVerdict.pass,
    checks: [...termination.checks, ...rerunVerdict.checks],
  };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

/**
 * @param {string} line
 */
function emitLine(line) {
  writeSync(1, `${line}\n`);
}

async function main() {
  for (const domain of BET2_DOMAINS) {
    if (!domain) throw new Error("audit domain list must not include empty entries");
  }
  emitLine(
    `search recall audit starting @ ${DEFAULT_BASE_URL} (n=${BET2_DOMAINS.length} + ${SECTION_1_8_RERUN.length} rerun)`,
  );
  const limiter = createRateLimiter();
  const acquire = () => limiter.acquire();
  // Probe ONLY the 25-domain cohort: every §1.8 rerun domain is already a
  // member of BET2_DOMAINS, and runLiveVerification does NOT dedupe its
  // domain list — concatenating both sets would double-probe 7 domains,
  // spend 32 of the 20-per-10-min anonymous budget and 429 the cohort tail.
  for (const domain of SECTION_1_8_RERUN) {
    if (!BET2_DOMAINS.includes(domain)) {
      throw new Error(
        `rerun domain ${domain} is not in the BET2 cohort — it would never be probed`,
      );
    }
  }
  const run = await runLiveVerification({
    domains: [...BET2_DOMAINS],
    userAgent: RECALL_AUDIT_USER_AGENT,
    beforeRequest: acquire,
    onResult: (probe, index, total) => {
      emitLine(
        `${String(index).padStart(2)}/${total} ${probe.domain.padEnd(18)} status=${String(probe.status ?? "ERR")} rows=${probe.rowCount} ${probe.tierCounts.verified} verified / ${probe.tierCounts.likely} likely / ${probe.tierCounts.unmatched} unmatched`,
      );
    },
  });
  // The §1.8 rerun domains are probed ONCE — slice them back out of the same
  // result array for the rerun verdict instead of re-probing (the anonymous
  // /search budget is 20 req / 10 min and the tail of the cohort 429s on a
  // second pass).
  const rerunResults = SECTION_1_8_RERUN.flatMap((domain) => {
    const found = run.results.find((probe) => probe.domain === domain);
    return found ? [found] : [];
  });
  const verdict = evaluateRecallAudit(run, { results: rerunResults.filter(Boolean) });
  emitLine("");
  emitLine("Recall gates (issue #3014 metric over the BET 2 25-domain set):");
  for (const check of verdict.checks) {
    emitLine(`  ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }
  if (verdict.pass) {
    emitLine(`PASS: 0 dead-end empty states; verified share ${(run.summary.verifiedShare * 100).toFixed(1)}% >= 80%; §1.8 brands non-empty`);
    return 0;
  }
  emitLine("FAIL: the free-preview recall gates above are red — see the per-domain lines for the leaking brands");
  return 1;
}

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exit(2);
    });
}
