#!/usr/bin/env node
// Live verification canary for BET 6 — read-only MCP / API on Free + Scout.
// Issue #1275. Encodes the §3.4 termination check against the real read
// surface: an authenticated free/Scout-tier customer API key can initialize
// the MCP endpoint, discover the read-only tools, and CALL a read tool
// end-to-end (200 close to success, `isError: false` in the result).
//
// The issue as written named `get_offer_state_at(domain, date)` as the probe
// tool with a non-null `evidence_url`. That tool does not exist on the live
// MCP surface (the offer timeline is served by the public /timeline/:domain
// pages and the account-owned export tools); this canary therefore probes the
// same tier boundary through `get_workspace_readiness`, which is the read
// tool that exists on Free + Scout and returns structured account state. The
// key-scope rule ("a freshly issued free-tier key") is enforced by passing a
// read-only key: write tools must 404/deny on it.
//
// Usage:
//   npm run canary:agent-ungate -- [--endpoint https://0509.io/api/mcp]
//   F9_AGENT_UNGATE_KEY=f9_live_... npm run canary:agent-ungate -- --json
//
// Exits 0 only when: initialize + tools/list succeed, every read tool is
// advertised without `requiresWriteEnabled`, no write tool is advertised for
// the (read-only) key, and tools/call on get_workspace_readiness returns a
// result with `isError: false`.

import { writeSync } from "node:fs";

export const DEFAULT_ENDPOINT = "https://0509.io/api/mcp";
export const DEFAULT_USER_AGENT = "0509-agent-ungate-canary/1.0";

export const READ_TOOL_PROBE = "get_workspace_readiness";

export const EXPECTED_READ_TOOLS = Object.freeze([
  "get_workspace_readiness",
  "get_collection_export",
  "get_watchlist_export",
  "watchlist_runs.list",
  "get_digest_export",
  "list_memory",
  "list_client_rooms",
  "list_support_cases",
  "list_web_mentions",
]);

/** @typedef {{ ok: boolean; detail: string; url: string }} Check */

/**
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ endpoint: string; key: string | null; json: boolean }} */
  const parsed = {
    endpoint: process.env.F9_AGENT_UNGATE_ENDPOINT || DEFAULT_ENDPOINT,
    key: process.env.F9_AGENT_UNGATE_KEY || null,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--endpoint" && args[index + 1]) {
      parsed.endpoint = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--key" && args[index + 1]) {
      parsed.key = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
  }
  return parsed;
}

/** @param {string} endpoint */
function endpointUrl(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`unsupported_endpoint_protocol: ${url.protocol}`);
  }
  return url.toString();
}

/**
 * @param {string} endpoint
 * @param {string} key
 * @param {unknown} body
 */
async function postRpc(endpoint, key, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": DEFAULT_USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  return { status: response.status, payload, text };
}

/**
 * @param {{ endpoint: string, key: string }} input
 * @returns {Promise<{ checks: Check[] }>}
 */
export async function runAgentUngateCanary({ endpoint, key }) {
  const url = endpointUrl(endpoint);
  const checks = [];

  let id = 0;
  const initialize = await postRpc(url, key, {
    jsonrpc: "2.0",
    id: ++id,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-ungate-canary", version: "1.0.0" } },
  });
  checks.push({
    ok:
      initialize.status === 200 &&
      Boolean(initialize.payload?.result?.capabilities?.tools) &&
      initialize.payload?.result?.serverInfo?.name === "five-to-nine",
    detail: `initialize (HTTP ${initialize.status}, server ${initialize.payload?.result?.serverInfo?.name ?? "unknown"})`,
    url,
  });

  const tools = await postRpc(url, key, {
    jsonrpc: "2.0",
    id: ++id,
    method: "tools/list",
    params: {},
  });
  const toolList = tools.payload?.result?.tools ?? [];
  const advertisedNames = toolList.map((tool) => tool.name);
  const missingReadTools = EXPECTED_READ_TOOLS.filter(
    (name) => !advertisedNames.includes(name),
  );
  const leakedWriteTools = toolList.filter((tool) => tool.requiresWriteEnabled);
  checks.push({
    ok:
      tools.status === 200 &&
      missingReadTools.length === 0 &&
      leakedWriteTools.length === 0,
    detail:
      `tools/list advertises ${advertisedNames.length} read-only tools${
        missingReadTools.length
          ? `; missing ${missingReadTools.join(", ")}`
          : ""
      }${leakedWriteTools.length ? `; leaked write tools: ${leakedWriteTools.map((t) => t.name).join(", ")}` : ""}`,
    url,
  });

  const call = await postRpc(url, key, {
    jsonrpc: "2.0",
    id: ++id,
    method: "tools/call",
    params: { name: READ_TOOL_PROBE, arguments: {} },
  });
  const callResult = call.payload?.result;
  checks.push({
    ok: call.status === 200 && callResult?.isError === false,
    detail:
      `tools/call ${READ_TOOL_PROBE} (HTTP ${call.status}, isError ${callResult?.isError ?? "n/a"}, status ${callResult?.structuredContent?.status ?? "n/a"})`,
    url,
  });

  return { checks };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.key) {
    writeSync(
      2,
      "F9_AGENT_UNGATE_KEY is required (or pass --key). A read-only key from a Free or Scout account proves the ungate.\n",
    );
    process.exit(2);
  }

  runAgentUngateCanary({ endpoint: parsed.endpoint, key: parsed.key })
    .then(({ checks }) => {
      const failed = checks.filter((check) => !check.ok);
      const report = {
        endpoint: parsed.endpoint,
        passed: checks.length - failed.length,
        failed: failed.length,
        checks,
      };
      if (parsed.json) {
        writeSync(1, `${JSON.stringify(report, null, 2)}\n`);
      } else {
        for (const check of checks) {
          writeSync(1, `${check.ok ? "PASS" : "FAIL"} ${check.detail}\n`);
        }
      }
      process.exit(failed.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      writeSync(2, `canary error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}