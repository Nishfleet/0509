/**
 * Read-only monitoring fan-out ladder evaluation for GA proof runs.
 * Does not activate fan-out, trigger crons, or send customer notifications.
 */

export const FANOUT_LADDER_STEPS = Object.freeze([
  "config",
  "shadow",
  "allowlist",
  "fleet75",
  "nightly",
]);

/**
 * @typedef {{
 *   mode?: string | null,
 *   globalEnabled?: boolean,
 *   allowlist?: string | null,
 *   maxInflight?: number | null,
 *   internalWorkspaceConfigured?: boolean,
 *   workflowBindingConfigured?: boolean,
 * }} FanoutConfigInput
 */

/**
 * @typedef {{
 *   shadowOnly?: number,
 *   queued?: number,
 *   dispatchFailures?: number,
 *   duplicates?: number,
 *   scheduledRunsCreated?: number,
 *   succeeded?: number,
 *   running?: number,
 *   pending?: number,
 *   failed?: number,
 *   skipped?: number,
 *   heldSlots?: number,
 *   maxInflight?: number,
 *   oldestQueuedAgeMs?: number | null,
 * }} FanoutMetricsInput
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   step: string,
 *   blocker: string | null,
 *   notes: string[],
 * }} FanoutLadderEvaluation
 */

/** @param {string | null | undefined} mode */
function normalizeMode(mode) {
  return (mode ?? "inline").trim().toLowerCase();
}

/**
 * @param {FanoutConfigInput} config
 * @returns {FanoutLadderEvaluation}
 */
export function evaluateFanoutConfigStep(config) {
  const mode = normalizeMode(config.mode);
  const notes = [];
  let blocker = null;

  if (mode === "inline") {
    notes.push("Inline scheduling is the rollback-safe posture and does not dispatch workflows.");
  } else if (mode === "shadow") {
    notes.push("Shadow counts eligible watchlists only; no D1 runs or workflows.");
  } else if (mode === "fanout") {
    notes.push("Fan-out mode dispatches workflows for allowlisted workspaces.");
  } else {
    blocker = "fanout_mode_invalid";
  }

  if (!config.workflowBindingConfigured) {
    blocker = blocker ?? "workflow_binding_missing";
  }

  if (!config.internalWorkspaceConfigured) {
    blocker = blocker ?? "internal_workspace_undocumented";
  }

  const allowlist = config.allowlist?.trim() ?? "";
  if (mode === "fanout" && !config.globalEnabled && allowlist.length === 0) {
    notes.push("Allowlist unset: fan-out schedules nothing until a workspace user ID is listed.");
  }
  if (allowlist === "*") {
    blocker = blocker ?? "allowlist_wildcard_unsafe";
    notes.push("Never use MONITORING_FANOUT_ALLOWLIST=* before multi-window pilot proof.");
  }

  if (config.globalEnabled) {
    notes.push("MONITORING_FANOUT_GLOBAL=1 is allowed only after owner-approved dispatch proof.");
    if (mode !== "fanout") {
      blocker = blocker ?? "global_without_fanout_mode";
    }
  }

  const maxInflight = config.maxInflight ?? 8;
  if (maxInflight < 1 || maxInflight > 64) {
    blocker = blocker ?? "max_inflight_out_of_range";
  }

  return {
    ok: blocker === null,
    step: "config",
    blocker,
    notes,
  };
}

/**
 * @param {FanoutMetricsInput} metrics
 * @returns {FanoutLadderEvaluation}
 */
export function evaluateShadowStep(metrics) {
  const notes = [
    "Expected: monitoring_fanout_scheduled log with shadowOnly > 0.",
    "Expected: zero watchlist_run rows for the shadow window (no workflows, no deliveries).",
  ];
  let blocker = null;

  if ((metrics.scheduledRunsCreated ?? 0) > 0) {
    blocker = "shadow_created_durable_runs";
  }
  if ((metrics.queued ?? 0) > 0) {
    blocker = blocker ?? "shadow_queued_workflows";
  }
  if ((metrics.shadowOnly ?? 0) < 1) {
    blocker = blocker ?? "shadow_no_eligible_count";
  }

  return {
    ok: blocker === null,
    step: "shadow",
    blocker,
    notes,
  };
}

/**
 * @param {FanoutMetricsInput} metrics
 * @returns {FanoutLadderEvaluation}
 */
export function evaluateAllowlistStep(metrics) {
  const notes = [
    "Pilot: one internal workspace, MONITORING_FANOUT_MAX_INFLIGHT=1, customer notifications disabled.",
    "Expected: exactly one queued/dispatched scheduled run for the allowlisted workspace.",
  ];
  let blocker = null;

  if ((metrics.dispatchFailures ?? 0) > 0) {
    blocker = "allowlist_dispatch_failures";
  }
  if ((metrics.queued ?? 0) !== 1 && (metrics.running ?? 0) !== 1 && (metrics.succeeded ?? 0) !== 1) {
    blocker = blocker ?? "allowlist_not_single_job";
  }
  if ((metrics.maxInflight ?? 1) > 1) {
    notes.push("Warning: max inflight > 1 during one-watchlist pilot reduces isolation.");
  }

  return {
    ok: blocker === null,
    step: "allowlist",
    blocker,
    notes,
  };
}

/**
 * @param {FanoutMetricsInput} metrics
 * @returns {FanoutLadderEvaluation}
 */
export function evaluateFleet75Step(metrics) {
  const notes = [
    "Simulated: vitest schedules 75 agency watchlists via createBatch (sqlite, mocked workflow).",
    "Live: allowlisted internal workspace with 75 active agency watchlists; dispatchFailures must be 0.",
  ];
  let blocker = null;

  const completed = (metrics.succeeded ?? 0) + (metrics.running ?? 0) + (metrics.pending ?? 0);
  if ((metrics.queued ?? 0) < 75 && completed < 75) {
    blocker = "fleet75_insufficient_jobs";
  }
  if ((metrics.dispatchFailures ?? 0) > 0) {
    blocker = blocker ?? "fleet75_dispatch_failures";
  }
  if ((metrics.heldSlots ?? 0) > (metrics.maxInflight ?? 8)) {
    blocker = blocker ?? "fleet75_slot_overcommit";
  }

  return {
    ok: blocker === null,
    step: "fleet75",
    blocker,
    notes,
  };
}

/**
 * @param {FanoutMetricsInput} metrics
 * @returns {FanoutLadderEvaluation}
 */
export function evaluateNightlyStep(metrics) {
  const notes = [
    "Observe one full 04:00 UTC nightly window plus warmup reconciliation.",
    "Pending queue should drain; oldestQueuedAgeMs should not grow unbounded across windows.",
  ];
  let blocker = null;

  if ((metrics.failed ?? 0) > 0) {
    blocker = "nightly_failed_runs";
  }
  if ((metrics.pending ?? 0) > 0 && (metrics.oldestQueuedAgeMs ?? 0) > 6 * 60 * 60 * 1000) {
    blocker = blocker ?? "nightly_stale_pending_queue";
  }

  return {
    ok: blocker === null,
    step: "nightly",
    blocker,
    notes,
  };
}

/**
 * @param {string} step
 * @param {{ config?: FanoutConfigInput, metrics?: FanoutMetricsInput }} input
 * @returns {FanoutLadderEvaluation}
 */
export function evaluateFanoutLadderStep(step, input = {}) {
  const normalized = step.trim().toLowerCase();
  const config = input.config ?? {};
  const metrics = input.metrics ?? {};

  switch (normalized) {
    case "config":
      return evaluateFanoutConfigStep(config);
    case "shadow":
      return evaluateShadowStep(metrics);
    case "allowlist":
      return evaluateAllowlistStep(metrics);
    case "fleet75":
      return evaluateFleet75Step(metrics);
    case "nightly":
      return evaluateNightlyStep(metrics);
    default:
      return {
        ok: false,
        step: normalized,
        blocker: "unknown_ladder_step",
        notes: [`Supported steps: ${FANOUT_LADDER_STEPS.join(", ")}`],
      };
  }
}

/**
 * @param {FanoutLadderEvaluation} evaluation
 */
export function formatFanoutLadderReport(evaluation) {
  const lines = [
    `Monitoring fan-out ladder (${evaluation.step}): ${evaluation.ok ? "ok" : "failed"}`,
  ];
  if (evaluation.blocker) {
    lines.push(`blocker: ${evaluation.blocker}`);
  }
  for (const note of evaluation.notes) {
    lines.push(`- ${note}`);
  }
  return lines.join("\n");
}

/**
 * Parse D1 JSON output from wrangler into run status counts.
 * @param {unknown} payload
 * @returns {FanoutMetricsInput}
 */
export function parseWatchlistRunStatusCounts(payload) {
  /** @type {FanoutMetricsInput} */
  const metrics = {
    queued: 0,
    succeeded: 0,
    running: 0,
    pending: 0,
    failed: 0,
    skipped: 0,
    scheduledRunsCreated: 0,
  };

  const rows = extractD1Rows(payload);
  for (const row of rows) {
    const status = String(row.status ?? "").toLowerCase();
    const count = Number(row.count ?? row.c ?? 0);
    if (!Number.isFinite(count)) {
      continue;
    }
    metrics.scheduledRunsCreated = (metrics.scheduledRunsCreated ?? 0) + count;
    if (status === "pending") {
      metrics.pending = count;
      metrics.queued = (metrics.queued ?? 0) + count;
    } else if (status === "running") {
      metrics.running = count;
    } else if (status === "succeeded") {
      metrics.succeeded = count;
    } else if (status === "failed") {
      metrics.failed = count;
    } else if (status === "skipped") {
      metrics.skipped = count;
    }
  }

  return metrics;
}

/**
 * @param {unknown} payload
 * @returns {Array<Record<string, unknown>>}
 */
function extractD1Rows(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const body = /** @type {{ result?: Array<{ results?: Array<Record<string, unknown>> }> }} */ (payload);
  if (!Array.isArray(body.result)) {
    return [];
  }
  return body.result.flatMap((batch) => batch.results ?? []);
}
