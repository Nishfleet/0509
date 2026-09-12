#!/usr/bin/env node
/**
 * Advertised-URL coverage canary (issue #3166).
 *
 * Every URL the live https://0509.io/sitemap.xml and https://0509.io/llms.txt
 * advertise must serve HTTP 200 with a non-empty body and no `noindex` robots
 * directive. The 2026-09-12 incident this guards: sitemap + llms.txt handed
 * Google and answer engines three /guides/* URLs and /switch/adspy that all
 * returned 404 while the deploy chain was red — the source-side agreement
 * tests (#3122) stayed green because they never touch production.
 *
 * This is the observe-to-close guard on top: it extends the
 * sitemap-coverage guard pattern of PR #3163 (the /timeline:/ads cohort
 * coverage probe) from cohort counting to the universal invariant —
 * fetch the advertised set, probe every entry, fail loud on any
 * 404/noindex/redirect/empty divergence, and auto-file one deduped incident
 * per divergence window.
 *
 * Divergence classes per URL:
 *   http-<status>  — any non-200 response (redirects are NOT followed: an
 *                    advertised URL must be the canonical 200, matching the
 *                    issue's `curl -fsS` verify shape)
 *   empty-body     — 200 with a body that carries no markup/text
 *   noindex        — 200 HTML carrying <meta name="robots" content="noindex">
 *                    or an X-Robots-Tag: noindex header
 *   fetch-error    — network/timeout failure after one retry
 *
 * Exit codes:
 *   0 — every advertised URL served 200 + non-empty + indexable.
 *   1 — at least one advertised URL diverged.
 *   2 — the sitemap itself could not be fetched or parsed (probe failure,
 *       not a coverage verdict).
 *
 * Usage:
 *   node scripts/canary-sitemap-coverage.mjs                      # live probe
 *   node scripts/canary-sitemap-coverage.mjs --json               # machine report
 *   node scripts/canary-sitemap-coverage.mjs --base http://127.0.0.1:8787
 *   node scripts/canary-sitemap-coverage.mjs --input sitemap.xml  # fixture set,
 *       still probed live against --base (the drill path)
 *   node scripts/canary-sitemap-coverage.mjs --file-issue --dry-run
 *
 * Issue auto-filing (--file-issue) never fires on fixture input and always
 * dedupes against an open incident carrying ISSUE_BODY_MARKER (same pattern
 * as scripts/canary-timeline-coverage.mjs / canary-demo-brand-timeline.mjs).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export const DEFAULT_BASE_URL = "https://0509.io";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_DELAY_MS = 150;
export const RETRY_BACKOFF_MS = 1_000;

/** Marker used for open-incident dedupe on --file-issue. */
export const ISSUE_BODY_MARKER = "sitemap-coverage-guard incident";
export const GUARD_ISSUE = 3166;

/**
 * The /ads + /timeline cohort shares one 120/10min per-IP public-brand-page
 * budget, and a full-sitemap probe (~134 brand URLs) exceeds it — so when
 * CANARY_BYPASS_TOKEN is configured the probe presents x-0509-canary-token,
 * which the limiter exempts on public-brand-page scope exactly like a
 * verified crawler. Absent the token the run still works; it just risks
 * 429s on the brand tail (fail-open, real divergences still reported).
 */
function canaryHeaders() {
  const token = process.env.CANARY_BYPASS_TOKEN?.trim();
  return {
    "user-agent": "0509-sitemap-coverage-canary/1.0",
    ...(token ? { "x-0509-canary-token": token } : {}),
  };
}

/**
 * @typedef {{url: string, ok: boolean, status: number | null, reason: string, detail: string}} ProbeResult
 * @typedef {{url: string, status: number | null, reason: string, detail: string}} Divergence
 * @typedef {{advertised: number, okCount: number, divergences: Divergence[], verdict: "pass" | "fail"}} CoverageVerdict
 */

/**
 * Extract the advertised URL set from a rendered sitemap.xml body. Accepts
 * both absolute <loc> URLs (the live shape) and relative paths (the raw loc
 * list emitted by buildSitemapXml). Returns absolute URLs resolved against
 * baseUrl so fixtures and live fetches produce the same set.
 *
 * @param {string} xml
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function urlsFromSitemapXml(xml, baseUrl = DEFAULT_BASE_URL) {
  const urls = new Set();
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1].trim();
    try {
      const url = new URL(loc, baseUrl);
      // Dedupe on the exact advertised href minus any fragment. Trailing
      // slashes are significant: if /foo/ is advertised, probing /foo could
      // legitimately 301 — a real divergence, not a duplicate.
      url.hash = "";
      urls.add(url.toString());
    } catch {
      // A malformed <loc> is a sitemap defect, not a probe target — skipped
      // here and caught by the source-side sitemap tests instead.
    }
  }
  return [...urls].sort();
}

/**
 * Extract same-origin advertised URLs from an llms.txt body: markdown links
 * [label](https://host/path) plus any bare https://host/path mentions.
 * Off-origin links are llms.txt's business (docs, external citations) and
 * are not probed.
 *
 * @param {string} text
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function urlsFromLlmsTxt(text, baseUrl = DEFAULT_BASE_URL) {
  const origin = new URL(baseUrl).origin;
  const urls = new Set();
  /** @type {string[]} */
  const candidates = [];
  // Markdown link targets first: [label](https://host/path).
  const mdRe = /\]\(\s*(https?:\/\/[^\s)]+)/g;
  let m;
  while ((m = mdRe.exec(text)) !== null) {
    candidates.push(m[1]);
  }
  // Bare https URLs. Delimiters that never belong to this site's paths
  // (parens, brackets, quotes, angle brackets, whitespace) end the match,
  // then a trailing-punctuation strip drops sentence-ender dots/commas.
  const bareRe =
    /https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>()\[\]]*)?/g;
  while ((m = bareRe.exec(text)) !== null) {
    candidates.push(m[0]);
  }
  for (const raw of candidates) {
    const cleaned = raw.replace(/[.,;:!?'")\]\\]+$/u, "");
    try {
      const url = new URL(cleaned);
      if (url.origin !== origin) continue;
      url.hash = "";
      urls.add(url.toString());
    } catch {
      // skip malformed URL-like substrings
    }
  }
  return [...urls].sort();
}

/**
 * Detect a robots noindex directive on an HTML page: the actual
 * <meta name="robots" content="...noindex..."> tag (attribute order may
 * vary) or an X-Robots-Tag response header. Matches the tag, never the bare
 * word — "noindex" appears inside loader-data JSON on healthy pages
 * (issue #1283's false-positive lesson, carried in
 * tests/seo/sitemap-noindex-parity.test.sh).
 *
 * @param {string} body
 * @param {{get: (name: string) => string | null}} headers
 * @returns {boolean}
 */
export function servesNoindex(body, headers) {
  const header = headers?.get?.("x-robots-tag") ?? "";
  if (/noindex/i.test(header)) return true;
  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(body)) !== null) {
    const tag = m[0];
    if (!/name\s*=\s*["']robots["']/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    if (/noindex/i.test(content)) return true;
  }
  return false;
}

/**
 * Classify one fetched response into ok / a divergence reason.
 *
 * @param {{status: number, headers: {get: (name: string) => string | null}, body: string}} response
 * @returns {{ok: boolean, reason: string, detail: string}}
 */
export function classifyProbeResponse(response) {
  const { status, headers, body } = response;
  if (status !== 200) {
    return {
      ok: false,
      reason: `http-${status}`,
      detail: `HTTP ${status}`,
    };
  }
  const contentType = headers?.get?.("content-type") ?? "";
  const isHtml = /text\/html/i.test(contentType);
  const trimmed = body.trim();
  if (trimmed.length === 0 || (isHtml && !trimmed.includes("<"))) {
    return {
      ok: false,
      reason: "empty-body",
      detail: `HTTP 200 with ${body.length} bytes of unusable body`,
    };
  }
  if (isHtml && servesNoindex(body, headers)) {
    return { ok: false, reason: "noindex", detail: "robots noindex" };
  }
  return { ok: true, reason: "ok", detail: `HTTP 200 (${body.length} bytes)` };
}

const sleep = /** @param {number} ms */ (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Probe one URL: GET with redirect:"manual" (an advertised URL must be the
 * final 200, per the issue's curl -fsS verify), one retry on network error,
 * 5xx, or 429 (transient-tolerant; a persistent 429 is itself the #3156
 * crawl-budget divergence and still reported).
 *
 * @param {string} url
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} options
 * @returns {Promise<ProbeResult>}
 */
export async function probeUrl(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS);
    try {
      const res = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: canaryHeaders(),
      });
      const body = await res.text();
      const verdict = classifyProbeResponse({
        status: res.status,
        headers: res.headers,
        body,
      });
      const retriable =
        !verdict.ok && (res.status === 429 || res.status >= 500);
      if (retriable && attempt === 0) continue;
      return { url, status: res.status, ...verdict };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    url,
    ok: false,
    status: null,
    reason: "fetch-error",
    detail: lastError ?? "fetch failed",
  };
}

/**
 * Probe every advertised URL under a bounded concurrency pool with a small
 * inter-request delay — the sitemap is ~180 URLs and the public surface is
 * crawl-facing, so the probe behaves like a polite crawler, not a burst.
 *
 * @param {string[]} urls
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, concurrency?: number, delayMs?: number, sleepImpl?: (ms: number) => Promise<void>}} options
 * @returns {Promise<ProbeResult[]>}
 */
export async function probeAdvertisedUrls(urls, options = {}) {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const delayMs = Math.max(0, options.delayMs ?? DEFAULT_DELAY_MS);
  const sleepImpl = options.sleepImpl ?? sleep;
  /** @type {ProbeResult[]} */
  const results = new Array(urls.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, urls.length) },
    async () => {
      while (next < urls.length) {
        const index = next;
        next += 1;
        if (index > 0 && delayMs > 0) await sleepImpl(delayMs);
        results[index] = await probeUrl(urls[index], {
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
        });
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * The issue's invariant, pure so it is unit-testable from fixtures:
 * pass iff every advertised URL probed ok.
 *
 * @param {ProbeResult[]} results
 * @returns {CoverageVerdict}
 */
export function coverageVerdict(results) {
  const divergences = results
    .filter((r) => !r.ok)
    .map((r) => ({
      url: r.url,
      status: r.status,
      reason: r.reason,
      detail: r.detail,
    }));
  return {
    advertised: results.length,
    okCount: results.length - divergences.length,
    divergences,
    verdict: divergences.length === 0 ? "pass" : "fail",
  };
}

/**
 * Open-incident dedupe for --file-issue (same shape as
 * canary-timeline-coverage.mjs's findExistingOpenIncident).
 *
 * @param {{repo: string, marker?: string}} input
 * @returns {{existing: boolean}}
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

/**
 * @param {{baseUrl: string, checkedAt: string, verdict: CoverageVerdict}} report
 * @returns {string}
 */
function buildIssueBody(report) {
  const { baseUrl, checkedAt, verdict } = report;
  const lines = [
    ISSUE_BODY_MARKER,
    "",
    `The advertised-URL coverage gate from issue #${GUARD_ISSUE} fired: ` +
      `${verdict.divergences.length} of ${verdict.advertised} URLs advertised ` +
      `by the live sitemap.xml / llms.txt did not serve an indexable 200.`,
    "",
    `- measured at: ${checkedAt}`,
    `- base: ${baseUrl}`,
    `- advertised: ${verdict.advertised}`,
    `- ok: ${verdict.okCount}`,
    "",
    "Divergences:",
    ...verdict.divergences.map(
      (d) => `- ${d.url} — ${d.reason} (${d.detail})`,
    ),
    "",
    "An advertised URL that 404s, redirects, or serves noindex is a soft-404",
    "signal to crawlers and a dead AEO link — either restore the page or drop",
    "it from sitemap.xml + llms.txt in the same change.",
    "",
    `Relates to #${GUARD_ISSUE}`,
  ];
  return lines.join("\n");
}

/**
 * @param {{baseUrl: string, checkedAt: string, verdict: CoverageVerdict}} report
 * @returns {string}
 */
function renderHumanReport({ baseUrl, checkedAt, verdict }) {
  const lines = [];
  lines.push(`sitemap-coverage canary (${baseUrl} at ${checkedAt})`);
  lines.push(`- advertised: ${verdict.advertised}`);
  lines.push(`- ok: ${verdict.okCount}`);
  if (verdict.verdict === "pass") {
    lines.push(
      "verdict: ok — every advertised URL serves an indexable 200.",
    );
  } else {
    lines.push(
      `verdict: FAILED — ${verdict.divergences.length} advertised URL(s) diverged:`,
    );
    for (const d of verdict.divergences) {
      lines.push(`  - ${d.url} — ${d.reason} (${d.detail})`);
    }
  }
  return lines.join("\n");
}

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {{fetchImpl?: typeof fetch}} options
 * @returns {Promise<string>}
 */
async function fetchAdvertisedDocument(baseUrl, path, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    headers: canaryHeaders(),
  });
  if (!res.ok) {
    throw new Error(`${path} fetch failed: HTTP ${res.status}`);
  }
  return res.text();
}

/**
 * @param {string} path
 * @returns {string}
 */
function readFileSyncChecked(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unreadable --input ${path}: ${message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opts = {
    json: false,
    dryRun: false,
    fileIssue: false,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  let baseUrl = DEFAULT_BASE_URL;
  let fixture = null;
  let llmsFixture = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") opts.json = true;
    else if (args[i] === "--dry-run") opts.dryRun = true;
    else if (args[i] === "--file-issue") opts.fileIssue = true;
    else if (args[i] === "--base") baseUrl = args[++i] ?? baseUrl;
    else if (args[i] === "--input") fixture = args[++i];
    else if (args[i] === "--llms-input") llmsFixture = args[++i];
    else if (args[i] === "--concurrency") {
      opts.concurrency = Number(args[++i]);
    } else if (args[i] === "--delay-ms") opts.delayMs = Number(args[++i]);
    else if (args[i] === "--timeout-ms") opts.timeoutMs = Number(args[++i]);
    else {
      console.error(
        `Unknown argument: ${args[i]}. Supported: --base <url>, --input <sitemap.xml>, --llms-input <llms.txt>, --json, --file-issue, --dry-run, --concurrency <n>, --delay-ms <n>, --timeout-ms <n>.`,
      );
      process.exit(2);
    }
  }
  if (
    !Number.isInteger(opts.concurrency) ||
    opts.concurrency < 1 ||
    !Number.isFinite(opts.delayMs) ||
    opts.delayMs < 0 ||
    !Number.isFinite(opts.timeoutMs) ||
    opts.timeoutMs < 1000
  ) {
    console.error(
      "sitemap-coverage canary: --concurrency must be a positive integer, --delay-ms >= 0, --timeout-ms >= 1000",
    );
    process.exit(2);
  }

  const checkedAt = new Date().toISOString();
  let xml;
  try {
    xml =
      fixture !== null
        ? readFileSyncChecked(fixture)
        : await fetchAdvertisedDocument(baseUrl, "/sitemap.xml");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`sitemap-coverage canary: ${message}`);
    }
    process.exit(2);
  }

  let urls;
  /** @type {ProbeResult[]} */
  const llmsDivergence = [];
  try {
    urls = urlsFromSitemapXml(xml, baseUrl);
    if (urls.length === 0) {
      throw new Error("sitemap.xml parsed with zero <loc> entries");
    }
    // llms.txt advertises the same canonical surface (the issue's metric
    // names both). Fixture mode probes llms only when --llms-input is given;
    // live mode always fetches it — an unreachable llms.txt is itself an
    // advertised-surface failure, recorded directly as a divergence.
    /** @type {string[]} */
    let llmsUrls = [];
    try {
      const llms =
        llmsFixture !== null
          ? readFileSyncChecked(llmsFixture)
          : fixture === null
            ? await fetchAdvertisedDocument(baseUrl, "/llms.txt")
            : null;
      if (llms !== null) llmsUrls = urlsFromLlmsTxt(llms, baseUrl);
    } catch (error) {
      llmsDivergence.push({
        url: `${baseUrl}/llms.txt`,
        ok: false,
        status: null,
        reason: "fetch-error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    urls = [...new Set([...urls, ...llmsUrls])].sort();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, error: `sitemap parse failed: ${message}` },
          null,
          2,
        ),
      );
    } else {
      console.error(`sitemap-coverage canary: sitemap parse failed: ${message}`);
    }
    process.exit(2);
  }

  const probeTargets = urls;

  const results = await probeAdvertisedUrls(probeTargets, {
    concurrency: opts.concurrency,
    delayMs: opts.delayMs,
    timeoutMs: opts.timeoutMs,
  });
  const verdict = coverageVerdict([...results, ...llmsDivergence]);
  const report = { baseUrl, checkedAt, verdict };

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: verdict.verdict === "pass",
          baseUrl,
          checkedAt,
          ...verdict,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderHumanReport(report));
  }

  if (verdict.verdict === "fail" && opts.fileIssue && fixture === null) {
    const repo = "Nishfleet/0509";
    const title = `Sitemap coverage divergence (${verdict.divergences.length}/${verdict.advertised} advertised URLs not 200+indexable)`;
    const body = buildIssueBody(report);
    if (opts.dryRun) {
      console.log("[dry-run] would run: gh issue create");
    } else {
      const existing = findExistingOpenIncident({ repo });
      if (existing.existing) {
        console.log(
          "auto-file skipped: an open sitemap-coverage-guard incident already exists (dedupe).",
        );
        process.exit(1);
      }
      const createResult = spawnSync(
        "gh",
        ["issue", "create", "-R", repo, "--title", title, "--body", body],
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

// ESM entrypoint: only run main when executed directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
