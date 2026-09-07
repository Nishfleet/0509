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
 *
 * ## --http mode (issue #1899)
 *
 * The D1 row count is a necessary-but-not-sufficient signal: a brand can
 * have stored rows (the migration 0079 seed, or a real capture) and STILL
 * 410 on `/timeline/:domain` because the proof gate (issue #1284) filters
 * out any snapshot missing both a screenshot and a page-text artifact. The
 * seed rows have neither, so a brand whose nightly real capture
 * (`runDemoBrandBackfill`) keeps failing shows a non-zero D1 count while
 * the public timeline stays dark. That is exactly the gap that left
 * /timeline/nike.com, /timeline/nykaa.com, and /timeline/mamaearth.com
 * returning 410 for days without anyone noticing (issue #1899).
 *
 * `--http` probes the real public surface: for each demo brand it fetches
 * `https://0509.io/timeline/<domain>` and asserts HTTP 200 AND the page
 * body contains the "As of" retrieval affordance (issue #1899 acceptance:
 * "Add 'as of <date>' retrieval" + "Visit the timeline URL for a tracked
 * competitor and see non-empty ledger"). A 410, a 5xx, or a 200 that
 * renders the empty "not stored yet" shell all fail. `--http` needs no
 * Cloudflare token — it is a plain public curl — so it can run in CI
 * without the `production` environment. Combine with `--file-issue` to
 * auto-file when the public surface regresses.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
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

/** Default origin for --http mode. The production public surface. */
export const DEFAULT_TIMELINE_ORIGIN = "https://0509.io";

/** The "As of" affordance string the timeline route renders when the ledger
 * is non-empty (issue #1899 acceptance: "Add 'as of <date>' retrieval"). A
 * 200 without this string is the empty "not stored yet" shell, which is a
 * regression for a watched demo brand. */
export const TIMELINE_AS_OF_MARKER = "As of";

/** Server-rendered per-entry marker of the dated ledger (one per state). The
 * route renders it ONLY when `loadOfferTimeline` returned entries — the
 * loadFailed no-index shell (a D1 read failure) and the empty shell carry
 * the "As of" label but no `f9-timeline-entry`, so requiring both markers
 * keeps a degraded shell from passing as a populated timeline. */
export const TIMELINE_LEDGER_ENTRY_MARKER = "f9-timeline-entry";

/** HTTP probe timeout per brand (seconds). Matches the meta-discovery canary. */
export const TIMELINE_HTTP_TIMEOUT_SECONDS = 20;

/**
 * @param {string[]} argv
 * @returns {{local: boolean, json: boolean, fileIssue: boolean, dryRun: boolean, http: boolean, origin: string}}
 */
export function parseArgs(argv) {
  const parsed = {
    local: false,
    json: false,
    fileIssue: false,
    dryRun: false,
    http: false,
    origin: DEFAULT_TIMELINE_ORIGIN,
  };
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
    if (arg === "--http") {
      parsed.http = true;
      continue;
    }
    if (arg === "--origin") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--origin requires a value (e.g. http://127.0.0.1:4179)");
      }
      parsed.origin = next.replace(/\/+$/, "");
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Supported: --local, --json, --file-issue, --dry-run, --http, --origin <url>.`,
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
 * Build the public timeline URL for a demo brand.
 * @param {string} origin
 * @param {string} domain
 * @returns {string}
 */
export function buildTimelineUrl(origin, domain) {
  return `${origin.replace(/\/+$/, "")}/timeline/${encodeURIComponent(domain)}`;
}

/**
 * Classify one brand's HTTP probe result into a verdict + failure reason.
 *
 * A pass requires HTTP 200 AND the body carries the "As of" retrieval
 * affordance AND at least one rendered ledger entry (issue #1899
 * acceptance). A 410 is the proof-gate dark state (seed rows exist but no
 * real capture has landed). A 5xx is a server fault. A 200 without the
 * ledger marker is the empty "not stored yet" shell or the D1 read-failure
 * no-index shell, which is a regression for a watched demo brand that
 * should have a populated ledger by now.
 *
 * @param {{domain: string, status: number, body: string}} input
 * @returns {{verdict: "pass" | "fail", reason: string | null}}
 */
export function validateTimelineProbe(input) {
  const { domain, status, body } = input;
  if (status === 410) {
    return {
      verdict: "fail",
      reason: `/timeline/${domain} returned 410 — no proof-bearing snapshot (nightly capture failing or proof gate filtering all rows).`,
    };
  }
  if (status < 200 || status >= 300) {
    return {
      verdict: "fail",
      reason: `/timeline/${domain} returned HTTP ${status}, expected 200.`,
    };
  }
  if (!body.includes(TIMELINE_AS_OF_MARKER)) {
    return {
      verdict: "fail",
      reason: `/timeline/${domain} returned 200 but the ledger is empty (no "As of" affordance) — the public timeline is dark for a watched demo brand.`,
    };
  }
  if (!body.includes(TIMELINE_LEDGER_ENTRY_MARKER)) {
    return {
      verdict: "fail",
      reason: `/timeline/${domain} returned 200 with the "As of" label but no rendered dated state (f9-timeline-entry) — the page is the empty or D1-failure shell, not a populated ledger.`,
    };
  }
  return { verdict: "pass", reason: null };
}

/**
 * Run the HTTP probe for every demo brand using curl (same convention as
 * the meta-discovery canary: a plain public fetch, no Cloudflare token).
 *
 * @param {{origin: string, timeoutSeconds?: number, env?: NodeJS.ProcessEnv}} input
 * @returns {{results: Array<{domain: string, status: number, body: string, error: string | null}>, validation: {verdict: "pass" | "fail", failures: string[]}}}
 */
export function probeTimelineUrls(input) {
  const origin = input.origin || DEFAULT_TIMELINE_ORIGIN;
  const timeoutSeconds = input.timeoutSeconds ?? TIMELINE_HTTP_TIMEOUT_SECONDS;
  const env = input.env ?? process.env;
  const results = [];
  const failures = [];
  for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
    const url = buildTimelineUrl(origin, domain);
    const curlResult = spawnSync(
      "curl",
      [
        "--silent",
        "--show-error",
        "--max-time",
        String(timeoutSeconds),
        "--retry",
        "2",
        "--retry-delay",
        "5",
        "--write-out",
        "\n%{http_code}",
        url,
      ],
      { cwd: root, env, encoding: "utf8", maxBuffer: 1024 * 1024 * 4 },
    );
    if (curlResult.error) {
      const message =
        curlResult.error instanceof Error
          ? curlResult.error.message
          : String(curlResult.error);
      results.push({ domain, status: 0, body: "", error: message });
      failures.push(`/timeline/${domain} probe failed: ${message}`);
      continue;
    }
    const out = curlResult.stdout ?? "";
    const lastNewline = out.lastIndexOf("\n");
    const body = lastNewline >= 0 ? out.slice(0, lastNewline) : "";
    const statusToken = lastNewline >= 0 ? out.slice(lastNewline + 1).trim() : "";
    const status = Number(statusToken) || 0;
    results.push({ domain, status, body, error: null });
    const probe = validateTimelineProbe({ domain, status, body });
    if (probe.verdict === "fail" && probe.reason) {
      failures.push(probe.reason);
    }
  }
  return {
    results,
    validation: {
      verdict: failures.length > 0 ? "fail" : "pass",
      failures,
    },
  };
}

/**
 * @param {{results: Array<{domain: string, status: number}>, checkedAt: string, failures: string[]}} input
 * @returns {string}
 */
export function buildHttpIssueBody(input) {
  const lines = [];
  lines.push("## Demo-brand Offer Timeline public-surface regression (issue #1899 guard)");
  lines.push("");
  lines.push(
    "A watched demo brand's `/timeline/:domain` page is not rendering a non-empty dated ledger. The D1 row count can be non-zero while the public timeline stays dark, because the proof gate (issue #1284) filters out seed rows that lack a screenshot and page-text artifact. This guard probes the real public surface so that gap cannot hide.",
  );
  lines.push("");
  lines.push(`- **checked at:** ${input.checkedAt}`);
  lines.push("- **HTTP statuses:**");
  for (const result of input.results) {
    lines.push(`  - \`${result.domain}\`: HTTP ${result.status}`);
  }
  lines.push("");
  lines.push("### Failures");
  for (const failure of input.failures) {
    lines.push(`- ${failure}`);
  }
  lines.push("");
  lines.push("### Write path");
  lines.push(
    `The nightly cron (\`runDemoBrandBackfill\`) writes one real capture row per brand per day through the existing capture pipeline; the proof gate then admits it to the public ledger. A persistent 410 means the nightly capture is failing for that brand. Code: \`${WRITE_PATH_REF}\`.`,
  );
  lines.push("");
  lines.push(`> run by \`scripts/canary-demo-brand-timeline.mjs --http\` (scheduled by \`.github/workflows/demo-brand-timeline-canary.yml\`).`);
  lines.push("");
  const statusSummary = input.results
    .map((r) => `${r.domain}:${r.status}`)
    .join(" ");
  lines.push(`${ISSUE_BODY_MARKER}: true, http: ${statusSummary}`);
  return lines.join("\n");
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

/**
 * @param {{results: Array<{domain: string, status: number}>, origin: string, checkedAt: string, validation: {verdict: "pass" | "fail", failures: string[]}}} input
 * @returns {string}
 */
function renderHttpReport(input) {
  const lines = [];
  lines.push(
    `demo-brand-timeline canary (mode=http, origin=${input.origin} at ${input.checkedAt})`,
  );
  for (const result of input.results) {
    lines.push(`- ${result.domain}: HTTP ${result.status}`);
  }
  if (input.validation.verdict === "pass") {
    lines.push(
      `verdict: ok — every watched demo brand's /timeline/:domain returns 200 with a non-empty dated ledger.`,
    );
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

  if (args.http) {
    const { results, validation } = probeTimelineUrls({ origin: args.origin });
    const jsonPayload = {
      ok: validation.verdict !== "fail",
      verdict: validation.verdict,
      mode: "http",
      origin: args.origin,
      results: results.map((r) => ({
        domain: r.domain,
        status: r.status,
        error: r.error,
      })),
      failures: validation.failures,
      checkedAt,
    };
    if (args.json) {
      console.log(JSON.stringify(jsonPayload, null, 2));
    } else {
      console.log(
        renderHttpReport({ results, origin: args.origin, checkedAt, validation }),
      );
    }
    // Always write a JSON evidence file so the CI workflow can upload it
    // alongside the run (and the VPS timer can keep it out of the repo
    // checkout). The filename is stable per run so the upload step's glob
    // (`demo-brand-timeline-canary-*.txt`) matches it. Override the target
    // directory with CANARY_EVIDENCE_DIR; the default is the repo root.
    try {
      const { writeFileSync, mkdirSync } = require("node:fs");
      const evidenceDir = process.env.CANARY_EVIDENCE_DIR || root;
      mkdirSync(evidenceDir, { recursive: true });
      const stamp = checkedAt.replace(/[:.]/g, "");
      writeFileSync(
        `${evidenceDir}/demo-brand-timeline-canary-${stamp}.txt`,
        JSON.stringify(jsonPayload, null, 2) + "\n",
      );
    } catch {
      // Evidence-file write is best-effort; the verdict + stdout report are
      // the load-bearing signals. Never let a file-write failure mask the
      // probe verdict.
    }

    if (validation.verdict === "fail" && args.fileIssue && !args.local) {
      const repo = "Nishfleet/0509";
      const darkDomains = results
        .filter((r) => validateTimelineProbe(r).verdict === "fail")
        .map((r) => r.domain)
        .join(",");
      const title = `Demo-brand offer timeline public surface dark (${darkDomains})`;
      const body = buildHttpIssueBody({ results, checkedAt, failures: validation.failures });
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

  if (validation.verdict === "fail" && args.fileIssue && !args.local) {
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