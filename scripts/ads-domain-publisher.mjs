#!/usr/bin/env node
/**
 * Programmatic /ads/:domain publisher — local dry-run preflight (BET 5a,
 * issue #1549).
 *
 * This is the operator-visible twin of the worker-side nightly publisher
 * (`app/lib/ads-domain-publisher.server.ts`): both ask the SAME question for
 * every domain in a curated `data/seed-lists/*.json` list — "does the live
 * search-v2 pipeline return at least one verified or likely ad for this
 * domain?" — and both apply the SAME publish floor (verified + likely >= 1).
 *
 * The worker server runs the pipeline in-process against the real provider
 * binding and persists the public_search discovery-cache row that backs the
 * /ads/:domain page and the dynamic sitemap. This script cannot run the
 * provider in-process (the Browser Run binding and Meta API token live in the
 * deployed Worker), so it probes the production /search surface — the exact
 * path a buyer and Google take — parses the rendered three-tier rows (the
 * proven `parseSearchResponseHtml` from scripts/bet2-live-verification.mjs),
 * and reports per-domain verdict + a summary.
 *
 * NOTE ON DRY-RUN: probing /search for a cache-miss domain hands the cold
 * capture to production (the resolver primes the cache in the background).
 * That is the same effect a real nightly run has, which is what makes the
 * preflight an honest predictor; nothing else is mutated by this script.
 *
 * Usage:
 *   npm run seed:publisher -- --list=sneaker-resale --dry-run
 *   node scripts/ads-domain-publisher.mjs --list=sneaker-resale --dry-run --min-publish=15
 *
 * Exit code 0 when the number of publishable domains >= --min-publish,
 * 1 otherwise (the issue's verify gate: "≥15 domains would publish").
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPacedFetch,
  parseRetryAfterMs,
  parseSearchResponseHtml,
  SEARCH_429_RETRY_LIMIT,
} from "./bet2-live-verification.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = new URL("..", import.meta.url).pathname;

const DEFAULT_BASE_URL = "https://0509.io";
const DEFAULT_MIN_PUBLISH = 15;
const WARMING_POLL_INTERVAL_MS = 35_000;
const WARMING_POLL_LIMIT = 2;

function parseArgs(argv) {
  const args = new Map();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    args.set(match[1], match[2] ?? true);
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mirror of the server-side validateSeedList rules for the file this script reads. */
function loadSeedList(name) {
  const listName = String(name ?? "").trim();
  if (!listName || /[^a-z0-9-]/.test(listName)) {
    throw new Error(`Invalid seed-list name "${listName}" (expected data/seed-lists/<name>.json)`);
  }
  const path = `${repoRoot}data/seed-lists/${listName}.json`.replace(/\/+/g, "/");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read seed list at data/seed-lists/${listName}.json: ${error.message}`);
  }
  const list = JSON.parse(raw);
  if (!Array.isArray(list.domains) || list.domains.length === 0) {
    throw new Error(`Seed list ${listName} has no domains`);
  }
  const seen = new Set();
  for (const entry of list.domains) {
    const domain = String(entry.domain ?? "").trim();
    if (!domain) {
      throw new Error(`Seed list ${listName} has an entry with no domain`);
    }
    if (seen.has(domain.toLowerCase())) {
      throw new Error(`Seed list ${listName} has a duplicate domain "${domain}"`);
    }
    seen.add(domain.toLowerCase());
  }
  return { listName, list };
}

/**
 * Probe one domain against production /search and decide whether the pipeline
 * would publish it. Follows the bet2 verification contract: a settled page
 * with verified+likely >= 1 → publish; a demo-sourced page is never
 * publishable; a zero-tier warming page polls up to WARMING_POLL_LIMIT times
 * before the final call. 429s wait out the Retry-After, capped at the search
 * window, so the anonymous budget (20 req / 10 min / IP) is never violated.
 */
async function probeDomain({ domain, baseUrl, pacedFetch }) {
  const url = `${baseUrl}/search?website=${encodeURIComponent(domain)}&country=all`;
  let lastParsed = null;

  for (let attempt = 0; attempt <= SEARCH_429_RETRY_LIMIT; attempt += 1) {
    let response;
    try {
      response = await pacedFetch(url, {
        headers: { "user-agent": "0509-ads-domain-publisher/1.0" },
      });
    } catch (error) {
      return {
        domain,
        verdict: "failed",
        reason: `request error: ${error.message}`,
        rowCount: null,
      };
    }

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      await sleep(retryAfterMs);
      continue;
    }

    const html = await response.text();
    const parsed = parseSearchResponseHtml(html);

    const verifiedLikely = parsed.tierCounts.verified + parsed.tierCounts.likely;
    // A warming page that already shows verified/likely rows is a proven
    // publish (partial but positive). Only a zero-tier warming page needs to
    // settle before the verdict.
    if (!parsed.isWarming || verifiedLikely >= 1) {
      lastParsed = parsed;
      break;
    }

    // Zero-tier warming: give the background capture up to two settle polls.
    for (let poll = 0; poll < WARMING_POLL_LIMIT; poll += 1) {
      await sleep(WARMING_POLL_INTERVAL_MS);
      const pollResponse = await pacedFetch(url, {
        headers: { "user-agent": "0509-ads-domain-publisher/1.0" },
      });
      if (pollResponse.status === 429) {
        await sleep(parseRetryAfterMs(pollResponse.headers.get("retry-after")));
        continue;
      }
      const pollHtml = await pollResponse.text();
      const pollParsed = parseSearchResponseHtml(pollHtml);
      lastParsed = pollParsed;
      if (!pollParsed.isWarming || pollParsed.tierCounts.verified + pollParsed.tierCounts.likely >= 1) {
        break;
      }
    }
    break;
  }

  if (!lastParsed) {
    return { domain, verdict: "failed", reason: "no settled response after retries" };
  }

  const verifiedLikely = lastParsed.tierCounts.verified + lastParsed.tierCounts.likely;
  const published =
    lastParsed.resultSource !== "demo" && verifiedLikely >= 1;

  const reason = published
    ? `verified ${lastParsed.tierCounts.verified} + likely ${lastParsed.tierCounts.likely}`
    : lastParsed.resultSource === "demo"
      ? "demo-sourced results are never published"
      : `no verified/likely coverage (verified ${lastParsed.tierCounts.verified}, likely ${lastParsed.tierCounts.likely}, unmatched ${lastParsed.tierCounts.unmatched})`;

  return {
    domain,
    verdict: published ? "publish" : "skip",
    reason,
    rowCount: lastParsed.rowCount,
    cacheStatus: lastParsed.cacheStatus,
    resultSource: lastParsed.resultSource,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const listName = String(args.get("list") ?? "").trim();
  const dryRun = args.get("dry-run") !== false;
  const baseUrl = String(args.get("base-url") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const minPublish = Number(args.get("min-publish") ?? DEFAULT_MIN_PUBLISH);

  if (!listName) {
    console.error("usage: node scripts/ads-domain-publisher.mjs --list=<name> --dry-run [--min-publish=N] [--base-url=URL]");
    process.exit(1);
  }
  if (!dryRun) {
    console.error(
      "The nightly publish happens in the deployed Worker (04:00 UTC daily cron). " +
        "This script is the operator preflight and always runs in dry-run; pass --dry-run explicitly.",
    );
    process.exit(1);
  }

  const { listName: name, list } = loadSeedList(listName);
  const pacedFetch = createPacedFetch();

  console.log(`seed:publisher dry-run — list=${name} domains=${list.domains.length} base=${baseUrl}`);
  console.log(`publish floor: verified + likely >= 1 per domain; gate: >= ${minPublish} publishable\n`);

  const outcomes = [];
  for (const entry of list.domains) {
    const outcome = await probeDomain({ domain: entry.domain, baseUrl, pacedFetch });
    outcomes.push(outcome);
    const mark = outcome.verdict === "publish" ? "PUBLISH" : outcome.verdict === "skip" ? "SKIP" : "FAILED";
    console.log(`  ${mark.padEnd(7)} ${outcome.domain.padEnd(18)} ${outcome.reason}`);
  }

  const published = outcomes.filter((o) => o.verdict === "publish").length;
  const skipped = outcomes.filter((o) => o.verdict === "skip").length;
  const failed = outcomes.filter((o) => o.verdict === "failed").length;
  console.log(`\nsummary: ${published} publishable / ${outcomes.length} domains ${published >= minPublish ? "(PASS)" : "(BELOW GATE)"}`);
  console.log(`  publish=${published} skip=${skipped} failed=${failed} gate=${minPublish}`);

  process.exit(published >= minPublish ? 0 : 1);
}

main().catch((error) => {
  console.error(`seed:publisher failed: ${error.message}`);
  process.exit(1);
});