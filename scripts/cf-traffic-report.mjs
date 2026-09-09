#!/usr/bin/env node
/**
 * cf-traffic-report.mjs — operator-run, read-only traffic report for 0509.io.
 *
 * Prints daily unique visitors, pageviews, and top paths for the 0509.io
 * Cloudflare zone, read from the Cloudflare GraphQL analytics API.
 *
 * Credentials come from ~/.config/cloudflare/analytics.env (one KEY=VALUE per
 * line). The token never enters this repo and is never printed. This script
 * makes read-only API calls only: no writes, no dashboard changes, no cron —
 * an operator runs it by hand (`npm run metrics:traffic`).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ZONE_NAME = "0509.io";
const ENV_FILE = join(homedir(), ".config", "cloudflare", "analytics.env");
const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const ZONES_ENDPOINT = "https://api.cloudflare.com/client/v4/zones";
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const TOP_PATHS_LIMIT = 10;

const HELP = `Usage: node scripts/cf-traffic-report.mjs [--days N]

Read-only traffic report for the ${ZONE_NAME} Cloudflare zone: daily unique
visitors, pageviews, and top paths, from the Cloudflare GraphQL analytics API.

Options:
  --days N    Number of UTC days to report, 1-${MAX_DAYS} (default: ${DEFAULT_DAYS})
  -h, --help  Show this help and exit

Credentials:
  Reads CF_ANALYTICS_API_TOKEN from ~/.config/cloudflare/analytics.env
  (one KEY=VALUE per line). The token needs Zone Analytics:Read on ${ZONE_NAME}.
  Optional: CF_ZONE_ID in the same file skips the automatic zone-ID lookup.

Operator-run only: read-only API calls, writes nothing, never prints the token.
`;

const MINT_INSTRUCTIONS = `Cloudflare Analytics token not found.

Mint one (one time, about 2 minutes):
  1. Open https://dash.cloudflare.com/profile/api-tokens
  2. Click "Create Token" -> "Create Custom Token" -> "Get started".
  3. Token name: 0509-traffic-report
  4. Permissions: Zone | Analytics | Read
  5. Zone Resources: Include | Specific zone | ${ZONE_NAME}
  6. Click "Continue to summary" -> "Create Token" and copy the token value.
  7. Store it on this machine (NOT in the repo):
       mkdir -p ~/.config/cloudflare
       printf 'CF_ANALYTICS_API_TOKEN=<paste-token-here>\\n' > ~/.config/cloudflare/analytics.env
       chmod 600 ~/.config/cloudflare/analytics.env
  8. Re-run: npm run metrics:traffic
`;

/** @param {string} message */
function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Parse a simple KEY=VALUE env file. Blank lines and `#` comments are
 * ignored; an optional `export ` prefix and surrounding quotes are stripped.
 *
 * @param {string} path
 * @returns {Record<string, string>}
 */
function parseEnvFile(path) {
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

/**
 * Resolve the zone ID for ${ZONE_NAME}. An Analytics:Read-only token cannot
 * list zones, so prefer CF_ZONE_ID from the env file; fall back to the REST
 * zones lookup for tokens that also have Zone:Read.
 *
 * @param {string} token
 * @param {Record<string, string>} envFile
 * @returns {Promise<string>}
 */
async function resolveZoneId(token, envFile) {
  if (envFile.CF_ZONE_ID && envFile.CF_ZONE_ID.trim()) {
    return envFile.CF_ZONE_ID.trim();
  }
  const url = `${ZONES_ENDPOINT}?name=${encodeURIComponent(ZONE_NAME)}&status=active`;
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    fail(`Could not reach the Cloudflare API to look up the zone ID: ${error.message}`);
  }
  if (response.ok) {
    const body = await response.json();
    const zone = Array.isArray(body.result) ? body.result[0] : undefined;
    if (zone && zone.id) return zone.id;
  }
  fail(
    `Could not resolve the zone ID for ${ZONE_NAME} with this token.\n` +
      `An Analytics:Read-only token cannot list zones, so add the zone ID to the env file:\n` +
      `  1. Open https://dash.cloudflare.com and pick ${ZONE_NAME}.\n` +
      `  2. On the Overview page, copy the "Zone ID" from the right-hand column.\n` +
      `  3. Append this line to ~/.config/cloudflare/analytics.env:\n` +
      `       CF_ZONE_ID=<paste-zone-id-here>\n` +
      `  4. Re-run: npm run metrics:traffic`
  );
}

/**
 * Run one read-only GraphQL query against the Cloudflare analytics API.
 *
 * @param {string} token
 * @param {string} query
 * @param {Record<string, string>} variables
 * @returns {Promise<object>}
 */
async function runGraphql(token, query, variables) {
  let response;
  try {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    fail(`Could not reach the Cloudflare GraphQL API: ${error.message}`);
  }
  if (response.status === 401 || response.status === 403) {
    fail(
      `Cloudflare rejected the token (HTTP ${response.status}).\n` +
        `Check that CF_ANALYTICS_API_TOKEN in ~/.config/cloudflare/analytics.env is valid\n` +
        `and was minted with Zone Analytics:Read on ${ZONE_NAME}.`
    );
  }
  if (!response.ok) {
    fail(`Cloudflare GraphQL API returned HTTP ${response.status}.`);
  }
  const body = await response.json();
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const detail = body.errors.map((entry) => entry.message).join("; ");
    fail(`Cloudflare GraphQL API returned errors: ${detail}`);
  }
  const zones = body?.data?.viewer?.zones;
  if (!Array.isArray(zones) || zones.length === 0) {
    fail(
      `The token cannot see analytics for zone ${ZONE_NAME}.\n` +
        `Check that it was minted with Zone Analytics:Read on ${ZONE_NAME} (not "All zones" excluded, not another zone).`
    );
  }
  return zones[0];
}

/** @param {number} days */
function dateRange(days) {
  const today = new Date();
  const until = today.toISOString().slice(0, 10);
  const sinceDate = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const since = sinceDate.toISOString().slice(0, 10);
  const untilExclusive = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { since, until, sinceDateTime: `${since}T00:00:00Z`, untilDateTime: `${untilExclusive}T00:00:00Z` };
}

/** @param {number} value */
function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

async function main() {
  const args = process.argv.slice(2);
  let days = DEFAULT_DAYS;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (arg === "--days") {
      const raw = args[i + 1];
      const parsed = Number.parseInt(raw ?? "", 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DAYS) {
        fail(`--days must be an integer between 1 and ${MAX_DAYS}.`);
      }
      days = parsed;
      i += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}\nRun with --help for usage.`);
  }

  if (!existsSync(ENV_FILE)) {
    fail(MINT_INSTRUCTIONS);
  }
  let envFile;
  try {
    envFile = parseEnvFile(ENV_FILE);
  } catch (error) {
    fail(`Could not read ${ENV_FILE}: ${error.message}\n\n${MINT_INSTRUCTIONS}`);
  }
  const token = (envFile.CF_ANALYTICS_API_TOKEN ?? "").trim();
  if (!token) {
    fail(
      `CF_ANALYTICS_API_TOKEN is missing or empty in ${ENV_FILE}.\n\n${MINT_INSTRUCTIONS}`
    );
  }

  const zoneId = await resolveZoneId(token, envFile);
  const range = dateRange(days);

  const dailyZone = await runGraphql(
    token,
    `query DailyTraffic($zoneTag: String!, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1dGroups(
        limit: ${MAX_DAYS + 2}
        filter: { date_geq: $since, date_leq: $until }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        uniq { uniques }
        sum { pageViews requests }
      }
    }
  }
}`,
    { zoneTag: zoneId, since: range.since, until: range.until }
  );

  const topPathsZone = await runGraphql(
    token,
    `query TopPaths($zoneTag: String!, $since: DateTime!, $until: DateTime!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: ${TOP_PATHS_LIMIT}
        filter: { datetime_geq: $since, datetime_lt: $until }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { clientRequestPath }
      }
    }
  }
}`,
    { zoneTag: zoneId, since: range.sinceDateTime, until: range.untilDateTime }
  );

  const daily = dailyZone.httpRequests1dGroups ?? [];
  const topPaths = topPathsZone.httpRequestsAdaptiveGroups ?? [];

  console.log(
    `${ZONE_NAME} traffic — last ${days} day${days === 1 ? "" : "s"} (UTC, Cloudflare zone analytics)`
  );
  console.log("");
  console.log(
    `${"Date".padEnd(12)}${"Uniques".padStart(10)}${"Pageviews".padStart(12)}${"Requests".padStart(12)}`
  );
  let totalPageviews = 0;
  let totalRequests = 0;
  for (const group of daily) {
    const uniques = group.uniq?.uniques ?? 0;
    const pageviews = group.sum?.pageViews ?? 0;
    const requests = group.sum?.requests ?? 0;
    totalPageviews += pageviews;
    totalRequests += requests;
    console.log(
      `${String(group.dimensions?.date ?? "?").padEnd(12)}${formatNumber(uniques).padStart(10)}${formatNumber(pageviews).padStart(12)}${formatNumber(requests).padStart(12)}`
    );
  }
  if (daily.length === 0) {
    console.log("(no traffic rows returned for this window)");
  }
  console.log("");
  console.log(
    `Totals: ${formatNumber(totalPageviews)} pageviews, ${formatNumber(totalRequests)} requests (uniques are per-day and do not sum)`
  );
  console.log("");
  console.log(`Top paths (last ${days}d, by requests):`);
  if (topPaths.length === 0) {
    console.log("  (none)");
  }
  for (const group of topPaths) {
    const path = group.dimensions?.clientRequestPath || "/";
    console.log(`  ${formatNumber(group.count).padStart(8)}  ${path}`);
  }
}

main().catch((error) => {
  fail(`Unexpected error: ${error.message}`);
});
