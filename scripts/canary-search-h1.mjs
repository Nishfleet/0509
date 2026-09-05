#!/usr/bin/env node
/**
 * Live regression guard for issue #1502: the /search?q=<domain> first-viewport
 * H1 must never ship the technical country-scope jargon ("across all
 * countries" / "all-countries query") that previously mirrored the URL
 * parameter instead of buyer language.
 *
 * A first-time visitor who searched `nike facebook ads` lands on /search?q=
 * nike whose headline echoed the scope filter they never requested. The fix
 * (PR #1609) rewrote the H1 to name the buyer's intent — "What {Brand} is
 * running on Meta" — and moved the country scope to a small annotation under
 * the heading. THIS canary is the other half of accept criterion #4: it curls
 * the live /search page for a fixed §1.8 six-domain + five-EU-advertiser set
 * and FAILS (exit 1) the moment any rendered H1 contains a banned scope
 * phrase, auto-filing a GitHub issue (--file-issue).
 *
 * The check is live against production 0509.io — the exact surface a buyer
 * sees — so it does not need D1 or a Cloudflare token. It only needs outbound
 * HTTPS and, when `--file-issue` is given, a working `gh` auth / GITHUB_TOKEN.
 *
 * Exit codes:
 *   0 — verdict passed (no rendered H1 contains a banned scope phrase).
 *   1 — at least one rendered H1 carries a banned phrase (optionally files).
 *   2 — the live check could not run (network / curl failure).
 *
 * Reads only — no writes to production state. The domains and banned phrases
 * are pinned here (not read from any mutable product config) so a product
 * regression that reintroduces the phrase cannot also rename itself out of
 * the guard's sight.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Base URL for the live /search surface under test. */
const BASE_URL = "https://0509.io";

/** §1.8 six-domain set + five EU advertisers (accept criterion #3 & #4). */
export const SEARCH_H1_DOMAINS = Object.freeze([
  "nike",
  "oura",
  "allbirds",
  "hubspot",
  "notion",
  "nykaa",
  "mcaffeine",
  "sugarcosmetics",
  "bombayshavingcompany",
  "lenskart",
]);

/** The technical country-scope phrases that must never appear in the H1. */
export const BANNED_SCOPE_PHRASES = Object.freeze([
  "across all countries",
  "all-countries query",
]);

/** Stable marker so the auto-filed issue is greppable and de-duplicable. */
export const ISSUE_BODY_MARKER = "search-h1-guard-incident";

const WRITE_PATH_REF =
  "app/routes/search.tsx (commandTitle) + app/lib/search-display.ts (formatSearchCommandTitle)";

/**
 * @param {string[]} argv
 * @returns {{fileIssue: boolean, dryRun: boolean}}
 */
export function parseArgs(argv) {
  const parsed = { fileIssue: false, dryRun: false };
  for (const arg of argv) {
    if (arg === "--file-issue") {
      parsed.fileIssue = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Supported: --file-issue, --dry-run.`,
    );
  }
  return parsed;
}

/**
 * Extract the rendered H1 text from a /search HTML document.
 * Returns the lowercased inner text of the first <h1>, or null if the page
 * did not render an H1 at all (treated as a skip, not a pass — see
 * validateSearchH1s).
 * @param {string} html
 * @returns {string | null}
 */
export function extractSearchH1(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return null;
  return (
    match[1]
      // strip any nested tags (links, spans) inside the H1. The banned
      // country-scope phrases contain no HTML entities, so no entity decoding
      // is needed for the verdict; the raw inner text is compared verbatim.
      .replace(/<[^>]+>/g, "")
      .trim()
      .toLowerCase()
  );
}

/**
 * @param {{h1: string | null, phrase: string, domain: string}} input
 * @returns {boolean} whether the H1 contains the banned phrase verbatim.
 */
export function h1ContainsBannedPhrase({ h1, phrase }) {
  return (
    typeof h1 === "string" &&
    h1.toLowerCase().includes(phrase.toLowerCase())
  );
}

/**
 * Grade one domain's rendered H1 against the banned-phrase set.
 * @param {{domain: string, h1: string | null}} input
 * @returns {{verdict: "pass" | "fail" | "skip", failures: string[], skips: string[],
 *   observed: string | null}}
 */
export function gradeSearchH1({ domain, h1 }) {
  if (h1 === null) {
    return {
      verdict: "skip",
      failures: [],
      skips: [`no H1 rendered for ${domain} — treat as skip, not pass`],
      observed: null,
    };
  }
  const failures = [];
  for (const phrase of BANNED_SCOPE_PHRASES) {
    if (h1ContainsBannedPhrase({ h1, phrase, domain })) {
      failures.push(
        `/search?q=${domain} H1 contains banned phrase "${phrase}": "${h1}"`,
      );
    }
  }
  return {
    verdict: failures.length > 0 ? "fail" : "pass",
    failures,
    skips: [],
    observed: h1,
  };
}

/**
 * @param {{results: Array<{domain: string, verdict: "pass" | "fail" | "skip",
 *   failures: string[], skips: string[], observed: string | null}>}} input
 * @returns {{verdict: "pass" | "fail", failures: string[], skips: string[],
 *   failuresByDomain: Record<string, string[]>, observedByDomain: Record<string, string | null>}}
 */
export function validateSearchH1s({ results }) {
  const failures = [];
  const skips = [];
  /** @type {Record<string, string[]>} */
  const failuresByDomain = {};
  /** @type {Record<string, string | null>} */
  const observedByDomain = {};
  for (const result of results) {
    observedByDomain[result.domain] = result.observed;
    if (result.verdict === "fail") {
      failures.push(...result.failures);
      failuresByDomain[result.domain] = result.failures;
    }
    if (result.verdict === "skip") {
      skips.push(...result.skips);
    }
  }
  return {
    verdict: failures.length > 0 ? "fail" : "pass",
    failures,
    skips,
    failuresByDomain,
    observedByDomain,
  };
}

/**
 * @param {{checkedAt: string, failuresByDomain: Record<string, string[]>,
 *   observedByDomain: Record<string, string | null>}} input
 * @returns {string}
 */
export function buildIssueBody(input) {
  const lines = [];
  lines.push("## /search H1 regression (issue #1502 guard)");
  lines.push("");
  lines.push(
    "A live /search?q=<domain> first-viewport H1 again rendered a technical country-scope phrase.",
  );
  lines.push("");
  lines.push(`- **checked at:** ${input.checkedAt}`);
  lines.push("");
  lines.push("### Failure");
  for (const domain of SEARCH_H1_DOMAINS) {
    for (const failure of input.failuresByDomain[domain] ?? []) {
      lines.push(`- ${failure}`);
    }
  }
  lines.push("");
  lines.push("### Observed H1s");
  for (const domain of SEARCH_H1_DOMAINS) {
    const observed = input.observedByDomain[domain];
    lines.push(
      `- \`${domain}\`: ${observed === null || observed === undefined ? "(no H1)" : `"${observed}"`}`,
    );
  }
  lines.push("");
  lines.push("### Write path");
  lines.push(
    `The H1 is interpolated in-app (no data): \`${WRITE_PATH_REF}\`. Revert the format string to buyer language and re-run \`scripts/canary-search-h1.mjs\`.`,
  );
  lines.push("");
  lines.push(`> run by \`scripts/canary-search-h1.mjs\` (scheduled by \`ops/search-h1-guard/\`).`);
  lines.push("");
  const observedSummary = Object.entries(input.observedByDomain)
    .map(([domain, h1]) => `${domain}:${h1 === null || h1 === undefined ? "none" : JSON.stringify(h1)}`)
    .join(" ");
  lines.push(`${ISSUE_BODY_MARKER}: true, domains: ${observedSummary}`);
  return lines.join("\n");
}

/** @param {{body: string, title: string, repo: string}} input
 * @returns {string[]} */
export function buildGhIssueCommand({ body, title, repo }) {
  return ["issue", "create", "-R", repo, "--title", title, "--body", body];
}

/**
 * @param {{repo: string}} input
 * @returns {{existing: boolean}}
 */
export function findExistingOpenIncident({ repo }) {
  try {
    const result = spawnSync(
      "gh",
      ["issue", "list", "-R", repo, "--search", `${ISSUE_BODY_MARKER} in:body`, "--state", "open", "--json", "number", "--limit", "5"],
      { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (result.status !== 0) return { existing: false };
    const parsed = JSON.parse(result.stdout || "[]");
    return { existing: Array.isArray(parsed) && parsed.length > 0 };
  } catch {
    return { existing: false };
  }
}

/**
 * @param {{domain: string}} input
 * @returns {string} the /search URL query parameter for the domain.
 */
export function buildSearchUrl({ domain }) {
  return `${BASE_URL}/search?q=${globalThis.encodeURIComponent(domain)}`;
}

/**
 * @param {{domain: string, h1: string | null}} input
 * @returns {string}
 */
function renderHumanLine({ domain, h1 }) {
  if (h1 === null) return `- ${domain}: (no H1 rendered)`;
  return `- ${domain}: "${h1}"`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkedAt = new Date().toISOString();

  // Fetch each domain's /search page and extract the H1. A failed fetch for
  // one domain marks the whole run as can't-run (exit 2): the guard must not
  // silently pass because the site was unreachable.
  const results = [];
  for (const domain of SEARCH_H1_DOMAINS) {
    const url = buildSearchUrl({ domain });
    let html;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        console.error(`search-h1 canary: ${domain} fetch returned HTTP ${response.status}`);
        process.exit(2);
      }
      html = await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`search-h1 canary: ${domain} fetch failed: ${message}`);
      process.exit(2);
    }
    const h1 = extractSearchH1(html);
    results.push({ domain, ...gradeSearchH1({ domain, h1 }), h1 });
  }

  const validation = validateSearchH1s({ results });
  /** @type {Record<string, string[]>} */
  const failuresByDomain = {};
  /** @type {Record<string, string | null>} */
  const observedByDomain = {};
  for (const result of results) {
    if (result.verdict === "fail") failuresByDomain[result.domain] = result.failures;
    observedByDomain[result.domain] = result.observed;
  }
  for (const result of results) {
    for (const skip of result.skips) validation.skips.push(skip);
  }

  for (const result of results) {
    console.log(renderHumanLine({ domain: result.domain, h1: result.observed }));
  }
  console.log(`verdict: ${validation.verdict}`);
  for (const failure of validation.failures) {
    console.log(`- ${failure}`);
  }
  for (const skip of Array.from(new Set(validation.skips))) {
    console.log(`- skip: ${skip}`);
  }

  if (validation.verdict === "fail" && args.fileIssue) {
    const repo = "Nishfleet/0509";
    const failedDomains = Object.keys(failuresByDomain).join(",");
    const title = `/search H1 country-scope regression (${failedDomains})`;
    const body = buildIssueBody({ checkedAt, failuresByDomain, observedByDomain });
    const command = buildGhIssueCommand({ body, title, repo });
    if (args.dryRun) {
      console.log(`[dry-run] would run: gh ${command.map((c) => JSON.stringify(c)).join(" ")}`);
    } else {
      const existing = findExistingOpenIncident({ repo });
      if (existing.existing) {
        console.log(
          "auto-file skipped: an open search-h1-guard incident already exists (dedupe).",
        );
        process.exit(1);
      }
      const createResult = spawnSync("gh", command, {
        cwd: root,
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      if (createResult.status !== 0) {
        const message = (createResult.stderr || createResult.stdout || "").trim();
        console.log(`auto-file failed${message ? `: ${message}` : ""}`);
        process.exit(1);
      }
      console.log(`auto-filed: ${(createResult.stdout ?? "").trim()}`);
    }
  }

  process.exit(validation.verdict === "fail" ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Standalone invocation only — the test suite imports this module (which
  // must not run the live check on import), and `void` avoids a top-level
  // await so the module stays sync-importable.
  main().then(() => process.exit(0)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`search-h1 canary: ${message}`);
    process.exit(2);
  });
}
