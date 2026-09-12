#!/usr/bin/env node
/**
 * Offer Timeline public-surface coverage canary (issue #3095).
 *
 * BET 3's moat — the /timeline/:domain proof archive — is only indexable for
 * the domains where it ships. The issue's metric: every /ads/:domain with
 * >=1 stored landing-page snapshot also serves an indexed /timeline/:domain,
 * i.e. sitemap /timeline/-URL count rises from the 7-domain seeded baseline
 * toward the /ads/ count, and never below it.
 *
 * The COVER set itself is already fully data-driven (issue #2961 + #2881):
 * app/lib/sitemap.server.ts lists a /timeline/:domain the moment its first
 * proof-complete, non-ad-destination landing_page_snapshot row lands, and
 * the route renders the honest collecting (noindex) 200 for every tracked
 * /ads/:domain without one — so newly captured brands publish automatically
 * and no empty page can ship. THIS script is the observable detector on top:
 * it fetches the live sitemap.xml, counts both cohorts, and applies the
 * issue's termination rule —
 *
 *     covered >  INITIAL_COVERED (7)
 *   AND
 *     covered >= COVERAGE_FLOOR (0.8) * adsCount
 *
 * A fail verdict is EXPECTED until the landing_page_snapshot pipeline lands
 * (issue #3018 owns that persistence side — this issue only owns the
 * observable coverage gate over the public surface). The canary exists so
 * the day proof-complete captures land for the tracked cohort the metric
 * climbs autonomously and the guard goes green — observe-to-close — without
 * another code change. NOT armed on a systemd rail in this diff: while the
 * verdict is expected-red (until #3018 lands) a pinned red timer adds noise,
 * not signal; arming the runner/timer pair (ops/<guard>/ — sibling pattern
 * ops/demo-brand-timeline-guard/) becomes a one-command follow-up once the
 * capture pipeline is live.
 *
 * Exit codes:
 *   0 — coverage at/above the floor (>=80% of the /ads/ set, above baseline).
 *   1 — coverage below the floor (a data-side gap while #3018 is pending;
 *       never a shipping-empty regression — unlisted domains render noindex).
 *   2 — the sitemap could not be fetched or parsed (probe failure, not a
 *       coverage verdict).
 *
 * Usage:
 *   node scripts/canary-timeline-coverage.mjs                       # live probe
 *   node scripts/canary-timeline-coverage.mjs --json                # machine report
 *   node scripts/canary-timeline-coverage.mjs --base http://127.0.0.1:8787
 *   node scripts/canary-timeline-coverage.mjs --input sitemap.xml   # fixture (dry path)
 *   node scripts/canary-timeline-coverage.mjs --file-issue --dry-run
 *
 * Issue auto-filing (--file-issue) never fires on fixture input and always
 * dedupes against an open incident carrying ISSUE_BODY_MARKER (same pattern
 * as scripts/canary-demo-brand-timeline.mjs).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export const DEFAULT_BASE_URL = "https://0509.io";

/** The coverage floor from the issue's termination check (§ metric). */
export const COVERAGE_FLOOR = 0.8;
/** The observed 2026-09-12 seeded baseline (issue #3095 evidence): 7 live */
/** /timeline/ URLs. The guard requires the count to have RISEN past this. */
export const INITIAL_COVERED = 7;

/** Marker used for open-incident dedupe on --file-issue. */
export const ISSUE_BODY_MARKER = "timeline-coverage-guard incident";
export const RELATES_ISSUE = 3018;
export const GUARD_ISSUE = 3095;

/**
 * Parse a rendered sitemap.xml body (either the raw loc list emitted by
 * buildSitemapXml or absolute URLs from the live <loc> tags) into the
 * /ads/ and /timeline/ finalist sets. Pure: no network, no filesystem.
 *
 * An /ads/ URL counts only the bare /ads/:domain brand pages (the issue's
 * cohort is the tracked brand surface, not /ads/* children like receipts).
 * A /timeline/ URL counts only /timeline/:domain (not the /timeline/ index).
 */
export function entriesFromSitemapXml(xml) {
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1].trim());
  }
  const ads = new Set();
  const timeline = new Set();
  for (const loc of locs) {
    // Accept both relative (".../ads/nike.com") entries written by the
    // renderer and absolute URLs on the fetched body.
    const path = loc.startsWith("http") ? new URL(loc).pathname : loc;
    if (/^\/ads\/[^/]+$/.test(path)) {
      ads.add(`/ads/${path.slice(5)}`);
    } else if (/^\/timeline\/[^/]+$/.test(path)) {
      timeline.add(path);
    }
  }
  return { ads: [...ads].sort(), timeline: [...timeline].sort() };
}

/**
 * The issue's termination rule, pure so it is unit-testable from fixtures:
 *
 *     pass  <=>  covered > INITIAL_COVERED
 *            AND covered >= ceil(COVERAGE_FLOOR * ads)
 *
 * (The live-probe form in the issue uses `tl >= floor*ads and tl > 7`;
 * ceil is the honest reading — 0.8 * 91 = 72.8 requires >= 73 URLs.)
 */
export function coverageVerdict({ ads, timeline }) {
  const adsCount = ads.length;
  const covered = timeline.length;
  const floorCount = Math.ceil(COVERAGE_FLOOR * adsCount);
  return {
    adsCount,
    covered,
    floorCount,
    ratio: adsCount === 0 ? 1 : covered / adsCount,
    verdict:
      covered > INITIAL_COVERED && covered >= floorCount ? "pass" : "fail",
  };
}

/**
 * Open-incident dedupe for --file-issue (same shape as
 * canary-demo-brand-timeline.mjs's findExistingOpenIncident).
 */
export function findExistingOpenIncident({ repo, marker = ISSUE_BODY_MARKER }) {
  try {
    const result = spawnSync(
      "gh",
      [
        "issue",
        "list",
        "-R",
        repo,
        "--search",
        `${marker} in:body`,
        "--state",
        "open",
        "--json",
        "number",
        "--limit",
        "5",
      ],
      { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (result.status !== 0) return { existing: false };
    const parsed = JSON.parse(result.stdout || "[]");
    return { existing: Array.isArray(parsed) && parsed.length > 0 };
  } catch {
    return { existing: false };
  }
}

function buildIssueBody(report) {
  const { baseUrl, checkedAt, verdict } = report;
  return [
    "timeline-coverage-guard incident",
    "",
    "The /timeline/ coverage gate from issue #" +
      GUARD_ISSUE +
      " fired: the Offer Timeline's indexed share of the /ads/ brand surface is below the 80% floor.",
    "",
    "- measured at: " + checkedAt,
    "- base: " + baseUrl,
    "- /ads/ count: " + verdict.adsCount,
    "- /timeline/ count: " + verdict.covered,
    "- floor (" + COVERAGE_FLOOR + "): " + verdict.floorCount,
    "- ratio: " + verdict.ratio.toFixed(3),
    "",
    "The cover set is data-driven (app/lib/sitemap.server.ts); snapshot",
    "population is issue #" + RELATES_ISSUE + "'s scope — this guard observes",
    "the public-surface metric and goes green the day the captures land.",
    "",
    "Relates to #" + RELATES_ISSUE + ", #" + GUARD_ISSUE,
  ].join("\n");
}

function renderHumanReport({ baseUrl, checkedAt, verdict }) {
  const lines = [];
  lines.push(`timeline-coverage canary (${baseUrl} at ${checkedAt})`);
  lines.push(`- /ads/ cohort: ${verdict.adsCount}`);
  lines.push(`- /timeline/ covered: ${verdict.covered}`);
  lines.push(`- floor: ${verdict.floorCount} (0.8 * ${verdict.adsCount})`);
  lines.push(
    `ratio: ${(verdict.ratio * 100).toFixed(1)}% (baseline ${INITIAL_COVERED})`,
  );
  if (verdict.verdict === "pass") {
    lines.push(
      "verdict: ok — timeline coverage at/above the 80% floor and above the seeded baseline.",
    );
  } else {
    lines.push(
      `verdict: FAILED — covered=${verdict.covered} needs >${INITIAL_COVERED} and >=${verdict.floorCount}. Expected while landing_page_snapshot population (#${RELATES_ISSUE}) is pending; publishing empty pages instead is forbidden (no-empty-page rule).`,
    );
  }
  return lines.join("\n");
}

async function fetchSitemap(baseUrl) {
  const res = await fetch(`${baseUrl}/sitemap.xml`);
  if (!res.ok) {
    throw new Error(`sitemap fetch failed: HTTP ${res.status}`);
  }
  return res.text();
}

async function main() {
  const args = process.argv.slice(2);
  const opts = { json: false, dryRun: false, fileIssue: false };
  let baseUrl = DEFAULT_BASE_URL;
  let fixture = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") opts.json = true;
    else if (args[i] === "--dry-run") opts.dryRun = true;
    else if (args[i] === "--file-issue") opts.fileIssue = true;
    else if (args[i] === "--base") baseUrl = args[++i] ?? baseUrl;
    else if (args[i] === "--input") fixture = args[++i];
    else {
      console.error(
        `Unknown argument: ${args[i]}. Supported: --base <url>, --input <sitemap.xml>, --json, --file-issue, --dry-run.`,
      );
      process.exit(2);
    }
  }

  const checkedAt = new Date().toISOString();
  let xml;
  try {
    xml = fixture !== null ? readFileSyncChecked(fixture) : await fetchSitemap(baseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`timeline-coverage canary: ${message}`);
    }
    process.exit(2);
  }

  let entries;
  try {
    entries = entriesFromSitemapXml(xml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: `sitemap parse failed: ${message}` }, null, 2));
    } else {
      console.error(`timeline-coverage canary: sitemap parse failed: ${message}`);
    }
    process.exit(2);
  }
  const verdict = coverageVerdict(entries);
  const report = { baseUrl, checkedAt, verdict, ...entries };

  if (opts.json) {
    console.log(
      JSON.stringify(
        { ok: verdict.verdict === "pass", baseUrl, checkedAt, ...entries, ...verdict },
        null,
        2,
      ),
    );
  } else {
    console.log(renderHumanReport({ baseUrl, checkedAt, verdict }));
  }

  if (verdict.verdict === "fail" && opts.fileIssue && fixture === null) {
    const repo = "Nishfleet/0509";
    const title = `Offer Timeline coverage below floor (${verdict.covered}/${verdict.adsCount})`;
    const body = buildIssueBody(report);
    if (opts.dryRun) {
      console.log("[dry-run] would run: gh issue create");
    } else {
      const existing = findExistingOpenIncident({ repo });
      if (existing.existing) {
        console.log(
          "auto-file skipped: an open timeline-coverage-guard incident already exists (dedupe).",
        );
        process.exit(1);
      }
      const createResult = spawnSync(
        "gh",
        [
          "issue",
          "create",
          "-R",
          repo,
          "--title",
          title,
          "--body",
          body,
        ],
        { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 1024 * 1024 },
      );
      if (createResult.status !== 0) {
        const message = (createResult.stderr || createResult.stdout || "").trim();
        console.log(`auto-file failed${message ? `: ${message}` : ""}`);
        process.exit(1);
      }
      console.log(`auto-filed: ${(createResult.stdout ?? "").trim()}`);
    }
  }

  process.exit(verdict.verdict === "pass" ? 0 : 1);
}

function readFileSyncChecked(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unreadable --input ${path}: ${message}`);
  }
}

// ESM entrypoint: only run main when executed directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
