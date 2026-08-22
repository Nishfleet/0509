import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DATABASE = "0509";
const REPOSITORY = "Nishfleet/0509";

/** @param {Date} generatedAt */
export function buildSignalSql(generatedAt) {
  const end = generatedAt.toISOString();
  return `
WITH bounds AS (
  SELECT
    datetime('${end}') AS end_at,
    datetime('${end}', '-1 day') AS recent_24h,
    datetime('${end}', '-2 day') AS previous_24h,
    datetime('${end}', '-7 day') AS recent_7d,
    datetime('${end}', '-14 day') AS previous_7d
)
SELECT
  (SELECT COUNT(*) FROM user) AS users_total,
  (SELECT COUNT(*) FROM user WHERE datetime(createdAt) >= (SELECT recent_24h FROM bounds) AND datetime(createdAt) < (SELECT end_at FROM bounds)) AS users_24h,
  (SELECT COUNT(*) FROM user WHERE datetime(createdAt) >= (SELECT previous_24h FROM bounds) AND datetime(createdAt) < (SELECT recent_24h FROM bounds)) AS users_previous_24h,
  (SELECT COUNT(*) FROM user WHERE datetime(createdAt) >= (SELECT recent_7d FROM bounds) AND datetime(createdAt) < (SELECT end_at FROM bounds)) AS users_7d,
  (SELECT COUNT(*) FROM user WHERE datetime(createdAt) >= (SELECT previous_7d FROM bounds) AND datetime(createdAt) < (SELECT recent_7d FROM bounds)) AS users_previous_7d,
  (SELECT COUNT(*) FROM watchlist WHERE is_active = 1) AS active_watchlists,
  (SELECT COUNT(*) FROM watchlist WHERE datetime(created_at) >= (SELECT recent_7d FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds)) AS watchlists_7d,
  (SELECT COUNT(*) FROM watchlist WHERE datetime(created_at) >= (SELECT previous_7d FROM bounds) AND datetime(created_at) < (SELECT recent_7d FROM bounds)) AS watchlists_previous_7d,
  (SELECT COUNT(*) FROM watchlist_run WHERE datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds)) AS runs_24h,
  (SELECT COUNT(*) FROM watchlist_run WHERE datetime(created_at) >= (SELECT previous_24h FROM bounds) AND datetime(created_at) < (SELECT recent_24h FROM bounds)) AS runs_previous_24h,
  (SELECT COUNT(*) FROM watchlist_run WHERE datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds) AND status = 'failed') AS failed_runs_24h,
  (SELECT COUNT(*) FROM watch_event WHERE datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds)) AS events_24h,
  (SELECT COUNT(*) FROM watch_event WHERE datetime(created_at) >= (SELECT previous_24h FROM bounds) AND datetime(created_at) < (SELECT recent_24h FROM bounds)) AS events_previous_24h,
  (SELECT COUNT(*) FROM digest_delivery WHERE datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds) AND status = 'sent') AS digests_sent_24h,
  (SELECT COUNT(*) FROM digest_delivery WHERE datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds) AND status = 'failed') AS digests_failed_24h,
  (SELECT COUNT(*) FROM support_case WHERE status = 'open') AS support_open,
  (SELECT COUNT(*) FROM support_case WHERE datetime(created_at) >= (SELECT recent_7d FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds)) AS support_7d,
  (SELECT COUNT(*) FROM support_case WHERE datetime(created_at) >= (SELECT previous_7d FROM bounds) AND datetime(created_at) < (SELECT recent_7d FROM bounds)) AS support_previous_7d,
  (SELECT COUNT(*) FROM dodo_webhook_event WHERE datetime(received_at) >= (SELECT recent_24h FROM bounds) AND datetime(received_at) < (SELECT end_at FROM bounds)) AS billing_events_24h,
  (SELECT COUNT(*) FROM dodo_webhook_event WHERE datetime(received_at) >= (SELECT recent_24h FROM bounds) AND datetime(received_at) < (SELECT end_at FROM bounds) AND outcome NOT IN ('processed', 'success', 'received')) AS billing_problem_events_24h,
  (SELECT COUNT(*) FROM user_plan WHERE plan != 'free' AND COALESCE(dodo_status, '') IN ('active', 'on_hold', 'trialing')) AS paid_accounts,
  COALESCE((SELECT json_group_object(plan, total) FROM (SELECT plan, COUNT(*) AS total FROM user_plan GROUP BY plan)), '{}') AS plan_mix_json,
  COALESCE((SELECT json_group_object(category, total) FROM (SELECT category, COUNT(*) AS total FROM support_case WHERE datetime(created_at) >= (SELECT recent_7d FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds) GROUP BY category)), '{}') AS support_categories_json,
  COALESCE((SELECT json_group_object(event_type, total) FROM (SELECT event_type, COUNT(*) AS total FROM dodo_webhook_event WHERE datetime(received_at) >= (SELECT recent_7d FROM bounds) AND datetime(received_at) < (SELECT end_at FROM bounds) GROUP BY event_type)), '{}') AS billing_event_types_json;
`;
}

/**
 * Cloudflare auth failure signatures in wrangler output. The two shapes seen
 * in the wild: the JSON form wrangler prints under `--json` and the plain
 * text form it prints otherwise, both when the host's OAuth session expired
 * (as it did 2026-08-04) and no CLOUDFLARE_API_TOKEN is available.
 */
const AUTH_FAILURE_RE = /In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN|Not logged in\. Your auth token has expired and could not be refreshed|Could not authenticate because no credentials were found and the environment is non-interactive/i;

/**
 * Build a single-line, machine-greppable failure message for the market
 * signal snapshot, classifying the known Cloudflare auth failure so a blocked
 * morning run explains itself instead of dumping a raw command trace.
 *
 * @param {string} [detail]
 * @returns {string}
 */
export function marketSignalFailureMessage(detail) {
  const text = String(detail ?? "").trim();
  if (text.startsWith("market_signal_auth_required") || text.startsWith("market_signal_snapshot_failed")) {
    return text;
  }
  if (AUTH_FAILURE_RE.test(text)) {
    return (
      "market_signal_auth_required: wrangler cannot authenticate to Cloudflare D1 in this " +
      "environment (missing CLOUDFLARE_API_TOKEN, or the host OAuth session expired and could " +
      "not refresh). Recovery: run `wrangler login` once interactively as the owning account on " +
      "this host, or set CLOUDFLARE_API_TOKEN in the cron environment, then rerun this command."
    );
  }
  return `market_signal_snapshot_failed: ${text}`;
}

/**
 * @template T
 * @param {string} command
 * @param {string[]} args
 * @returns {T}
 */
function runJson(command, args) {
  let output;
  try {
    output = execFileSync(command, args, {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failure = /** @type {{ message?: unknown; stderr?: unknown; stdout?: unknown }} */ (error);
    const detail = [
      failure.message,
      failure.stderr,
      failure.stdout,
    ]
      .filter((part) => String(part).trim())
      .join("\n");
    process.stderr.write(`market_signal_command_raw:\n${detail}\n`);
    throw new Error(marketSignalFailureMessage(detail.trim()));
  }
  return JSON.parse(output);
}

/** @param {any} payload */
export function parseD1Response(payload) {
  if (payload?.error?.text) throw new Error(marketSignalFailureMessage(payload.error.text));
  const result = payload?.[0];
  const row = result?.results?.[0];
  if (!result?.success || !row) throw new Error("D1 signal query returned no successful result.");

  const parsed = { ...row };
  for (const [source, target] of [
    ["plan_mix_json", "planMix"],
    ["support_categories_json", "supportCategories7d"],
    ["billing_event_types_json", "billingEventTypes7d"],
  ]) {
    parsed[target] = JSON.parse(String(parsed[source] || "{}"));
    delete parsed[source];
  }
  return parsed;
}

/**
 * @typedef {{ number: number; title: string; state: string; labels?: Array<{name?: string}>; createdAt: string; closedAt?: string | null; url: string }} Issue
 */

/**
 * @param {Issue[]} issues
 * @param {Date} now
 */
export function summarizeIssues(issues, now = new Date()) {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);
  const opened7d = issues.filter((issue) => new Date(issue.createdAt) >= sevenDaysAgo);
  const openedPrevious7d = issues.filter((issue) => {
    const created = new Date(issue.createdAt);
    return created >= fourteenDaysAgo && created < sevenDaysAgo;
  });
  const closed7d = issues.filter((issue) => issue.closedAt && new Date(issue.closedAt) >= sevenDaysAgo);

  return {
    openTotal: issues.filter((issue) => issue.state === "OPEN").length,
    opened7d: opened7d.length,
    openedPrevious7d: openedPrevious7d.length,
    closed7d: closed7d.length,
    recent: [...issues]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 10)
      .map((issue) => ({
        number: issue.number,
        state: issue.state,
        labels: (issue.labels || []).map((label) => label.name).filter(Boolean),
        createdAt: issue.createdAt,
        closedAt: issue.closedAt,
      })),
  };
}

/**
 * Fetch the repository issue list with the GitHub CLI. Fails loudly only for
 * genuinely unexpected outcomes; a read failure on the issues API (most
 * commonly HTTP 403 "Resource not accessible by integration" when the token
 * lacks issues:read) degrades to a clearly-labeled unavailable section instead
 * of failing the whole snapshot. D1 is the primary signal; issue metadata is
 * secondary and the workflow's failure surface must not depend on it.
 *
 * @returns {Issue[] | { unavailable: true }}
 */
export function fetchIssues() {
  /** @type {any[]} */
  let issuePages;
  try {
    issuePages = runJson("gh", [
      "api",
      "--paginate",
      "--slurp",
      `repos/${REPOSITORY}/issues?state=all&per_page=100`,
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes("HTTP 403") || detail.includes("Resource not accessible")) {
      process.stderr.write(`market_signal_github_issues_unavailable: ${detail}\n`);
      return { unavailable: true };
    }
    throw error;
  }
  return /** @type {Issue[]} */ (issuePages.flat().filter((issue) => !issue.pull_request).map((issue) => ({
    number: issue.number,
    title: issue.title,
    state: String(issue.state).toUpperCase(),
    labels: issue.labels,
    createdAt: issue.created_at,
    closedAt: issue.closed_at,
    url: issue.html_url,
  })));
}

/**
 * @param {{d1: any; issues: Issue[] | { unavailable: true }; generatedAt?: Date}} input
 */
export function buildSnapshot({ d1, issues, generatedAt = new Date() }) {
  /** @param {number} milliseconds */
  const iso = (milliseconds) => new Date(milliseconds).toISOString();
  const end = generatedAt.getTime();
  const day = 86_400_000;
  const githubUnavailable = "unavailable" in issues && issues.unavailable === true;
  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    windows: {
      timezone: "UTC",
      recent24h: { start: iso(end - day), end: iso(end) },
      previous24h: { start: iso(end - 2 * day), end: iso(end - day) },
      recent7d: { start: iso(end - 7 * day), end: iso(end) },
      previous7d: { start: iso(end - 14 * day), end: iso(end - 7 * day) },
    },
    product: parseD1Response(d1),
    github: githubUnavailable
      ? { unavailable: true }
      : summarizeIssues(/** @type {Issue[]} */ (issues), generatedAt),
    sourceHealth: {
      cloudflareD1: "ok",
      githubIssues: githubUnavailable ? "unavailable" : "ok",
    },
    privacy: "Aggregate product metrics and repository issue metadata only; no customer identity or message body.",
  };
}

function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path.");

  const generatedAt = new Date();
  const d1 = runJson("wrangler", ["d1", "execute", DATABASE, "--remote", "--command", buildSignalSql(generatedAt), "--json"]);
  const issues = fetchIssues();
  const rendered = `${JSON.stringify(buildSnapshot({ d1, issues, generatedAt }), null, 2)}\n`;
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
    writeFileSync(outputPath, rendered, { encoding: "utf8", mode: 0o600 });
    chmodSync(outputPath, 0o600);
  } else process.stdout.write(rendered);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${marketSignalFailureMessage(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  }
}
