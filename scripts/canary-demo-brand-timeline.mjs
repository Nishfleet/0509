#!/usr/bin/env node
// d1-budget: reads=200 writes=0 runs_per_day=4
/**
 * Live regression guard for issue #1449: the demo-brand Offer Timeline corpus.
 *
 * The five flagship demo brands (nike, nykaa, allbirds, lenskart, mamaearth)
 * are indexed in sitemap.xml and market the "landing-page change history"
 * promise, but their `/timeline/:domain` page used to 410 because the only
 * stored rows were proof-gated seeds. A nightly Worker cron
 * (`runDemoBrandBackfill`, app/lib/demo-brand-backfill.server.ts) now writes
 * one REAL capture row per brand per day. THIS canary is the other half of
 * accept criterion #5: it checks that `landing_page_snapshot` still holds at
 * least one row per watched brand, and FAILS (exit 1) the moment any watched
 * brand drops to 0, auto-filing a GitHub issue (--file-issue).
 *
 * The count is the stored-corpus count regardless of capture method
 * (including the migration 0079 seeds) — exactly what accept #5 asks for:
 * the guard's job is to catch a total-loss regression (table wiped, row
 * purge, migration reverted), which a scheduled check would otherwise miss
 * until a buyer hit the 410 shell. Stalls short of zero (the nightly job
 * dying while old rows remain) are surfaced as diagnostics every run so
 * they cannot silently drift, without inventing a second verdict signal
 * the issue did not ask for.
 *
 * Exit codes:
 *   0 — verdict passed (every watched brand has >= 1 stored row).
 *   1 — at least one watched brand has 0 stored rows (optionally files).
 *   2 — wrangler/d1 query could not run.
 *
 * Reads only — no DDL, no DML. Runs against `--remote` (production D1) by
 * default; use `--local` to dry-run against the `wrangler dev` D1 fixture.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATABASE_NAME = "0509";

/** The five BET 3 flagship demo brands. Kept in sync with
 * app/lib/demo-brand-pages.ts, but copied here so the script runs in plain
 * Node without a TS build step (same convention as bet3-live-verification). */
export const DEMO_BRAND_PAGE_DOMAINS = Object.freeze([
  "nike.com",
  "nykaa.com",
  "allbirds.com",
  "lenskart.com",
  "mamaearth.com",
]);

/** The capture-path + write-path code the guard protects. */
const WRITE_PATH_REF =
  "app/lib/demo-brand-backfill.server.ts (runDemoBrandBackfill) + app/lib/monitoring.server.ts (capture write path, issue #952)";

/** Stable marker so the auto-filed issue is greppable and de-duplicable. */
export const ISSUE_BODY_MARKER = "demo-brand-timeline-guard-incident";

/**
 * @param {string[]} argv
 * @returns {{local: boolean, json: boolean, fileIssue: boolean, dryRun: boolean}}
 */
export function parseArgs(argv) {
  const parsed = { local: false, json: false, fileIssue: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--local") {
      parsed.local = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--file-issue") {
      parsed.fileIssue = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Supported: --local, --json, --file-issue, --dry-run.`,
    );
  }
  return parsed;
}

/** Read-only corpus query: every stored landing-page snapshot URL. */
export function buildCorpusQuery() {
  return "SELECT canonical_url FROM landing_page_snapshot;";
}

/**
 * @param {string} output
 * @returns {Array<Record<string, unknown>>}
 */
export function rowsFromWranglerJson(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  return statements.flatMap((statement) => {
    if (Array.isArray(statement?.results)) return statement.results;
    if (Array.isArray(statement?.result?.results)) return statement.result.results;
    if (Array.isArray(statement?.result?.[0]?.results)) return statement.result[0].results;
    return [];
  });
}

/**
 * Same ownership rule as the product's `canonicalUrlBelongsToDomain`
 * (app/lib/offer-timeline.ts): host === domain, www.domain, or any
 * subdomain of domain.
 * @param {string} canonicalUrl
 * @param {string} domain
 * @returns {boolean}
 */
export function canonicalUrlBelongsToDomain(canonicalUrl, domain) {
  let hostname;
  try {
    hostname = new URL(canonicalUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const needle = domain.toLowerCase();
  return (
    hostname === needle ||
    hostname === `www.${needle}` ||
    hostname.endsWith(`.${needle}`)
  );
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Record<string, number>} per-demo-brand stored-row counts
 */
export function countRowsPerBrand(rows) {
  const counts = Object.fromEntries(
    DEMO_BRAND_PAGE_DOMAINS.map((domain) => [domain, 0]),
  );
  for (const row of rows) {
    const url = typeof row.canonical_url === "string" ? row.canonical_url : "";
    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      if (canonicalUrlBelongsToDomain(url, domain)) {
        counts[domain] += 1;
      }
    }
  }
  return counts;
}

/**
 * @param {Record<string, number>} counts
 * @returns {{verdict: "pass" | "fail", failures: string[]}}
 */
export function validateBrandCounts(counts) {
  const failures = [];
  for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
    const n = Number(counts[domain] ?? 0);
    if (n <= 0) {
      failures.push(
        `landing_page_snapshot count for watched demo brand ${domain} dropped to 0.`,
      );
    }
  }
  return {
    verdict: failures.length > 0 ? "fail" : "pass",
    failures,
  };
}

/**
 * @param {{counts: Record<string, number>, checkedAt: string, failures: string[]}} input
 * @returns {string}
 */
export function buildIssueBody(input) {
  const lines = [];
  lines.push("## Demo-brand Offer Timeline corpus regression (issue #1449 guard)");
  lines.push("");
  lines.push("A watched demo brand's stored `landing_page_snapshot` corpus dropped to 0 rows.");
  lines.push("");
  lines.push(`- **checked at:** ${input.checkedAt}`);
  lines.push("- **counts:**");
  for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
    lines.push(`  - \`${domain}\`: ${Number(input.counts[domain] ?? 0)}`);
  }
  lines.push("");
  lines.push("### Failure");
  for (const failure of input.failures) {
    lines.push(`- ${failure}`);
  }
  lines.push("");
  lines.push("### Write path");
  lines.push(
    `The nightly cron (\`runDemoBrandBackfill\`) writes one real capture row per brand per day; migration 0079 seeds the first dated state. This guard protects both from total loss. Code: \`${WRITE_PATH_REF}\`.`,
  );
  lines.push("");
  lines.push(`> run by \`scripts/canary-demo-brand-timeline.mjs\` (scheduled by \`ops/demo-brand-timeline-guard/\`).`);
  lines.push("");
  const countsSummary = Object.entries(input.counts)
    .map(([domain, n]) => `${domain}:${n}`)
    .join(" ");
  lines.push(`${ISSUE_BODY_MARKER}: true, counts: ${countsSummary}`);
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
 * @param {{counts: Record<string, number>, local: boolean, checkedAt: string, validation: {verdict: "pass" | "fail", failures: string[]}}} input
 * @returns {string}
 */
function renderHumanReport(input) {
  const lines = [];
  lines.push(
    `demo-brand-timeline canary (mode=${input.local ? "local" : "remote"} at ${input.checkedAt})`,
  );
  for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
    lines.push(`- ${domain}: ${Number(input.counts[domain] ?? 0)} stored rows`);
  }
  if (input.validation.verdict === "pass") {
    lines.push(`verdict: ok — every watched demo brand has >= 1 stored row.`);
  } else {
    lines.push(`verdict: FAILED —`);
    for (const failure of input.validation.failures) {
      lines.push(`- ${failure}`);
    }
  }
  lines.push(`write path: ${WRITE_PATH_REF}`);
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkedAt = new Date().toISOString();
  const wranglerArgs = [
    "wrangler",
    "d1",
    "execute",
    DATABASE_NAME,
    args.local ? "--local" : "--remote",
    "--json",
    "--command",
    buildCorpusQuery(),
  ];
  const result = spawnSync("npx", wranglerArgs, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });
  if (result.error) {
    const message =
      result.error instanceof Error ? result.error.message : String(result.error);
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: message, mode: args.local ? "local" : "remote" }, null, 2));
    } else {
      console.error(`demo-brand-timeline canary: ${message}`);
    }
    process.exit(2);
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: message, mode: args.local ? "local" : "remote" }, null, 2));
    } else {
      console.error(
        `demo-brand-timeline canary: wrangler d1 execute failed${message ? `: ${message}` : ""}`,
      );
    }
    process.exit(2);
  }

  const rows = rowsFromWranglerJson(result.stdout ?? "");
  const counts = countRowsPerBrand(rows);
  const validation = validateBrandCounts(counts);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: validation.verdict !== "fail",
          verdict: validation.verdict,
          local: args.local,
          counts,
          failures: validation.failures,
          checkedAt,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderHumanReport({ counts, local: args.local, checkedAt, validation }));
  }

  if (validation.verdict === "fail" && args.fileIssue) {
    const repo = "Nishfleet/0509";
    const zeroDomains = Object.entries(counts)
      .filter(([, n]) => Number(n) <= 0)
      .map(([domain]) => domain)
      .join(",");
    const title = `Demo-brand offer timeline corpus empty (${zeroDomains})`;
    const body = buildIssueBody({ counts, checkedAt, failures: validation.failures });
    const command = buildGhIssueCommand({ body, title, repo });
    if (args.dryRun) {
      console.log(`[dry-run] would run: gh ${command.map((c) => JSON.stringify(c)).join(" ")}`);
    } else {
      const existing = findExistingOpenIncident({ repo });
      if (existing.existing) {
        console.log(
          "auto-file skipped: an open demo-brand-timeline-guard incident already exists (dedupe).",
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
  main();
}