import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DATABASE = "0509";
const REPOSITORY = "nish3451/0509";

const SIGNAL_SQL = `
SELECT
  (SELECT COUNT(*) FROM user) AS users_total,
  (SELECT COUNT(*) FROM user WHERE datetime(createdAt) >= datetime('now', '-1 day')) AS users_24h,
  (SELECT COUNT(*) FROM user WHERE datetime(createdAt) >= datetime('now', '-2 day') AND datetime(createdAt) < datetime('now', '-1 day')) AS users_previous_24h,
  (SELECT COUNT(*) FROM user WHERE datetime(createdAt) >= datetime('now', '-7 day')) AS users_7d,
  (SELECT COUNT(*) FROM user WHERE datetime(createdAt) >= datetime('now', '-14 day') AND datetime(createdAt) < datetime('now', '-7 day')) AS users_previous_7d,
  (SELECT COUNT(*) FROM watchlist WHERE is_active = 1) AS active_watchlists,
  (SELECT COUNT(*) FROM watchlist WHERE datetime(created_at) >= datetime('now', '-7 day')) AS watchlists_7d,
  (SELECT COUNT(*) FROM watchlist WHERE datetime(created_at) >= datetime('now', '-14 day') AND datetime(created_at) < datetime('now', '-7 day')) AS watchlists_previous_7d,
  (SELECT COUNT(*) FROM watchlist_run WHERE datetime(created_at) >= datetime('now', '-1 day')) AS runs_24h,
  (SELECT COUNT(*) FROM watchlist_run WHERE datetime(created_at) >= datetime('now', '-2 day') AND datetime(created_at) < datetime('now', '-1 day')) AS runs_previous_24h,
  (SELECT COUNT(*) FROM watchlist_run WHERE datetime(created_at) >= datetime('now', '-1 day') AND status = 'failed') AS failed_runs_24h,
  (SELECT COUNT(*) FROM watch_event WHERE datetime(created_at) >= datetime('now', '-1 day')) AS events_24h,
  (SELECT COUNT(*) FROM watch_event WHERE datetime(created_at) >= datetime('now', '-2 day') AND datetime(created_at) < datetime('now', '-1 day')) AS events_previous_24h,
  (SELECT COUNT(*) FROM digest_delivery WHERE datetime(created_at) >= datetime('now', '-1 day') AND status = 'sent') AS digests_sent_24h,
  (SELECT COUNT(*) FROM digest_delivery WHERE datetime(created_at) >= datetime('now', '-1 day') AND status = 'failed') AS digests_failed_24h,
  (SELECT COUNT(*) FROM support_case WHERE status = 'open') AS support_open,
  (SELECT COUNT(*) FROM support_case WHERE datetime(created_at) >= datetime('now', '-7 day')) AS support_7d,
  (SELECT COUNT(*) FROM support_case WHERE datetime(created_at) >= datetime('now', '-14 day') AND datetime(created_at) < datetime('now', '-7 day')) AS support_previous_7d,
  (SELECT COUNT(*) FROM dodo_webhook_event WHERE datetime(received_at) >= datetime('now', '-1 day')) AS billing_events_24h,
  (SELECT COUNT(*) FROM dodo_webhook_event WHERE datetime(received_at) >= datetime('now', '-1 day') AND outcome NOT IN ('processed', 'success', 'received')) AS billing_problem_events_24h,
  (SELECT COUNT(*) FROM user_plan WHERE plan != 'free' AND COALESCE(dodo_status, '') IN ('active', 'on_hold', 'trialing')) AS paid_accounts,
  COALESCE((SELECT json_group_object(plan, total) FROM (SELECT plan, COUNT(*) AS total FROM user_plan GROUP BY plan)), '{}') AS plan_mix_json,
  COALESCE((SELECT json_group_object(category, total) FROM (SELECT category, COUNT(*) AS total FROM support_case WHERE datetime(created_at) >= datetime('now', '-7 day') GROUP BY category)), '{}') AS support_categories_json,
  COALESCE((SELECT json_group_object(event_type, total) FROM (SELECT event_type, COUNT(*) AS total FROM dodo_webhook_event WHERE datetime(received_at) >= datetime('now', '-7 day') GROUP BY event_type)), '{}') AS billing_event_types_json;
`;

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {any}
 */
function runJson(command, args) {
  const output = execFileSync(command, args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

/** @param {any} payload */
export function parseD1Response(payload) {
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
        url: issue.url,
      })),
  };
}

/** @param {{d1: any; issues: Issue[]; generatedAt?: Date}} input */
export function buildSnapshot({ d1, issues, generatedAt = new Date() }) {
  /** @param {number} milliseconds */
  const iso = (milliseconds) => new Date(milliseconds).toISOString();
  const end = generatedAt.getTime();
  const day = 86_400_000;
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
    github: summarizeIssues(issues, generatedAt),
    sourceHealth: { cloudflareD1: "ok", githubIssues: "ok" },
    privacy: "Aggregate product metrics and repository issue metadata only; no customer identity or message body.",
  };
}

function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path.");

  const d1 = runJson("wrangler", ["d1", "execute", DATABASE, "--remote", "--command", SIGNAL_SQL, "--json"]);
  /** @type {Array<Array<any>>} */
  const issuePages = runJson("gh", [
    "api",
    "--paginate",
    "--slurp",
    `repos/${REPOSITORY}/issues?state=all&per_page=100`,
  ]);
  const issues = issuePages.flat().filter((issue) => !issue.pull_request).map((issue) => ({
    number: issue.number,
    title: issue.title,
    state: String(issue.state).toUpperCase(),
    labels: issue.labels,
    createdAt: issue.created_at,
    closedAt: issue.closed_at,
    url: issue.html_url,
  }));
  const rendered = `${JSON.stringify(buildSnapshot({ d1, issues }), null, 2)}\n`;
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
    process.stderr.write(`market_signal_snapshot_failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
