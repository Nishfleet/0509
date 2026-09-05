#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  evaluateFanoutLadderStep,
  formatFanoutLadderReport,
  parseWatchlistRunStatusCounts,
} from "./monitoring-fanout-canary.lib.mjs";

// The canary must evaluate the real committed prod posture, not the bare
// local shell: wrangler.jsonc vars are the source of truth for mode/global/
// max-inflight, and the internal-workspace ID lives in Worker secret storage
// (checked by name only — values are never read). Env vars always override.
const wranglerConfigText = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

/**
 * @param {string} name
 */
function wranglerVar(name) {
  const match = wranglerConfigText.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`));
  return match ? match[1] : null;
}

/**
 * @param {string} name
 * @returns {boolean | null} true/false when wrangler answered, null when unavailable
 */
function prodSecretExists(name) {
  try {
    const raw = execFileSync("npx", ["wrangler", "secret", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return raw.includes(`"${name}"`);
  } catch {
    return null;
  }
}

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  const envGlobal = process.env.MONITORING_FANOUT_GLOBAL;
  const envMaxInflight =
    process.env.MONITORING_FANOUT_MAX_INFLIGHT ?? wranglerVar("MONITORING_FANOUT_MAX_INFLIGHT");
  /** @type {"env" | "wrangler_secret_list" | "unavailable"} */
  let internalWorkspaceSource = "env";
  let internalWorkspaceConfigured = Boolean(
    process.env.MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID?.trim(),
  );
  if (!internalWorkspaceConfigured) {
    const secretPresent = prodSecretExists("MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID");
    internalWorkspaceSource = secretPresent === null ? "unavailable" : "wrangler_secret_list";
    internalWorkspaceConfigured = secretPresent === true;
  }

  /** @type {{
   *   step: string,
   *   json: boolean,
   *   remote: boolean,
   *   metricsFile: string | null,
   *   mode: string | null,
   *   allowlist: string | null,
   *   maxInflight: number | null,
   *   globalEnabled: boolean,
   *   internalWorkspaceConfigured: boolean,
   *   internalWorkspaceSource: "env" | "wrangler_secret_list" | "unavailable",
   *   workflowBindingConfigured: boolean,
   *   shadowOnly: number | null,
   * }} */
  const parsed = {
    step: "config",
    json: false,
    remote: false,
    metricsFile: null,
    mode: process.env.MONITORING_FANOUT_MODE ?? wranglerVar("MONITORING_FANOUT_MODE"),
    allowlist: process.env.MONITORING_FANOUT_ALLOWLIST ?? null,
    maxInflight: envMaxInflight ? Number.parseInt(envMaxInflight, 10) : null,
    globalEnabled:
      envGlobal != null ? envGlobal === "1" : wranglerVar("MONITORING_FANOUT_GLOBAL") === "1",
    internalWorkspaceConfigured,
    internalWorkspaceSource,
    workflowBindingConfigured: true,
    shadowOnly: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--step" && args[index + 1]) {
      parsed.step = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--remote") {
      parsed.remote = true;
      continue;
    }
    if (arg === "--metrics-file" && args[index + 1]) {
      parsed.metricsFile = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--mode" && args[index + 1]) {
      parsed.mode = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--allowlist" && args[index + 1]) {
      parsed.allowlist = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--max-inflight" && args[index + 1]) {
      parsed.maxInflight = Number.parseInt(args[index + 1], 10);
      index += 1;
      continue;
    }
    if (arg === "--shadow-only" && args[index + 1]) {
      parsed.shadowOnly = Number.parseInt(args[index + 1], 10);
      index += 1;
    }
  }

  return parsed;
}

/**
 * @param {ReturnType<typeof parseArgs>} config
 */
async function loadMetrics(config) {
  /** @type {import("./monitoring-fanout-canary.lib.mjs").FanoutMetricsInput} */
  const metrics = {
    maxInflight: config.maxInflight ?? 8,
    shadowOnly: config.shadowOnly ?? undefined,
  };

  if (config.metricsFile) {
    const raw = readFileSync(config.metricsFile, "utf8");
    Object.assign(metrics, parseWatchlistRunStatusCounts(JSON.parse(raw)));
    return metrics;
  }

  if (!config.remote) {
    return metrics;
  }

  const statusQuery = `
    SELECT status, COUNT(*) AS count
    FROM watchlist_run
    WHERE trigger_type = 'scheduled'
      AND started_at >= datetime('now', '-1 day')
    GROUP BY status
  `;
  const slotQuery = `
    SELECT COUNT(*) AS count
    FROM monitoring_concurrency_slot
    WHERE holder_run_id IS NOT NULL
  `;

  const statusPayload = JSON.parse(
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "0509", "--remote", "--json", "--command", statusQuery],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const slotPayload = JSON.parse(
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "0509", "--remote", "--json", "--command", slotQuery],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );

  Object.assign(metrics, parseWatchlistRunStatusCounts(statusPayload));
  const heldRow = (slotPayload.result ?? []).flatMap(
    /** @param {{ results?: Array<{ count?: number }> }} batch */
    (batch) => batch.results ?? [],
  )[0];
  metrics.heldSlots = Number(heldRow?.count ?? 0);

  if (config.shadowOnly !== null) {
    metrics.shadowOnly = config.shadowOnly;
  }

  return metrics;
}

const config = parseArgs(process.argv.slice(2));
const metrics = await loadMetrics(config);
const evaluation = evaluateFanoutLadderStep(config.step, {
  config: {
    mode: config.mode,
    globalEnabled: config.globalEnabled,
    allowlist: config.allowlist,
    maxInflight: config.maxInflight,
    internalWorkspaceConfigured: config.internalWorkspaceConfigured,
    workflowBindingConfigured: config.workflowBindingConfigured,
  },
  metrics,
});

const payload = {
  ok: evaluation.ok,
  step: evaluation.step,
  blocker: evaluation.blocker,
  notes: evaluation.notes,
  config: {
    mode: config.mode,
    globalEnabled: config.globalEnabled,
    allowlistConfigured: Boolean(config.allowlist?.trim()),
    maxInflight: config.maxInflight,
    internalWorkspaceConfigured: config.internalWorkspaceConfigured,
    internalWorkspaceSource: config.internalWorkspaceSource,
  },
  metrics,
};

if (config.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(formatFanoutLadderReport(evaluation));
  if (config.internalWorkspaceSource === "wrangler_secret_list") {
    console.log("internal workspace: verified present via `wrangler secret list` (name only).");
  } else if (config.internalWorkspaceSource === "unavailable") {
    console.log(
      "internal workspace: could not verify (wrangler unavailable); export MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID per docs/monitoring-fanout-rollout.md.",
    );
  }
  if (config.step !== "config" && !config.remote && !config.metricsFile) {
    console.log("");
    console.log("Tip: pass --remote for read-only D1 metrics, or --metrics-file <wrangler-json>.");
  }
}

process.exit(evaluation.ok ? 0 : 1);
