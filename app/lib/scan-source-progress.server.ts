import type { AppEnv } from "~/lib/env.server";
import { ensureDb } from "~/lib/data/d1.server";
import { nowIso } from "~/lib/data/helpers.server";

/**
 * Onboarding source fan-out progress (issue #3176, epic #3172).
 *
 * The activation Workflow fans one scan out across every enabled ad library
 * (the Meta capture plus the #2218 seam adapters) and every live mention
 * source (#3171). Each source writes a tick into
 * `watchlist_run.summary_json.sourceProgress` as it moves through
 * pending -> running -> a terminal state, so the onboard page can read live
 * "scanning N sources, k done" progress straight off D1 — no second store.
 *
 * The ticks ride the run row that already exists for the scan
 * (`prepareFirstWatchlistScanRun`), so no migration is needed. Ticks are
 * atomic `json_set` updates: a Workflow retry re-marks the same keys instead
 * of duplicating them, and `finishOrchestratedWatchlistRun` preserves the
 * `sourceProgress` subtree when it writes the final summary.
 */

export const SCAN_SOURCE_STATUSES = [
  "pending",
  "running",
  "done",
  "unavailable",
  "timed_out",
  "failed",
  "skipped",
] as const;
export type ScanSourceStatus = (typeof SCAN_SOURCE_STATUSES)[number];

export type ScanSourceKind = "ad_library" | "mention";

export interface ScanSourceProgressEntry {
  kind: ScanSourceKind;
  /** Buyer-facing source name ("Meta Ad Library", "Google Ads", "Company site"). */
  label: string;
  status: ScanSourceStatus;
  /** Short machine/buyer detail: a reason code or a count ("items:3"). */
  detail: string | null;
  updatedAt: string;
}

export type ScanSourceProgressMap = Record<string, ScanSourceProgressEntry>;

export interface ScanSourceProgressSummary {
  total: number;
  /** Sources in a terminal state (done, unavailable, timed_out, failed, skipped). */
  done: number;
  /** Sources still in flight (pending or running). */
  remaining: number;
  entries: Array<{ sourceId: string } & ScanSourceProgressEntry>;
}

const TERMINAL_SCAN_SOURCE_STATUSES = new Set<ScanSourceStatus>([
  "done",
  "unavailable",
  "timed_out",
  "failed",
  "skipped",
]);

function scanSourcePathKey(sourceId: string): string {
  const cleaned = sourceId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!cleaned) {
    throw new Error("scan source id must carry at least one safe character");
  }
  return cleaned;
}

/**
 * Write one source tick onto the run row. Safe at any run status: the row
 * outlives the scan, so a mention source finishing after the ad scan's
 * `finishOrchestratedWatchlistRun` still lands its tick (that is the "late
 * sources append without reload" path).
 */
export async function recordScanSourceTick(
  env: AppEnv,
  runId: string,
  sourceId: string,
  tick: { kind: ScanSourceKind; label: string; status: ScanSourceStatus; detail?: string | null },
): Promise<void> {
  const entry: ScanSourceProgressEntry = {
    kind: tick.kind,
    label: tick.label,
    status: tick.status,
    detail: tick.detail ?? null,
    updatedAt: nowIso(),
  };
  await ensureDb(env)
    .prepare(
      `UPDATE watchlist_run
       SET summary_json = json_set(
             CASE WHEN json_valid(summary_json) THEN summary_json ELSE '{}' END,
             '$.sourceProgress.' || ?,
             json(?),
             '$.sourceProgressUpdatedAt',
             ?
           ),
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      scanSourcePathKey(sourceId),
      JSON.stringify(entry),
      entry.updatedAt,
      entry.updatedAt,
      runId,
    )
    .run();
}

/**
 * Mark the whole planned fan-out as pending up front so the page can show
 * the true denominator ("scanning N sources") before the first source
 * finishes. Callers enumerate once, then per-source ticks overwrite the
 * pending entries as sources run.
 */
export async function planScanSources(
  env: AppEnv,
  runId: string,
  sources: ReadonlyArray<{ sourceId: string; kind: ScanSourceKind; label: string }>,
): Promise<void> {
  for (const source of sources) {
    await recordScanSourceTick(env, runId, source.sourceId, {
      kind: source.kind,
      label: source.label,
      status: "pending",
    });
  }
}

function parseSourceProgress(summaryJson: string | null): ScanSourceProgressMap {
  if (!summaryJson) return {};
  let summary: unknown;
  try {
    summary = JSON.parse(summaryJson);
  } catch {
    return {};
  }
  const raw = (summary as Record<string, unknown> | null)?.sourceProgress;
  if (!raw || typeof raw !== "object") return {};
  const map: ScanSourceProgressMap = {};
  for (const [sourceId, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<ScanSourceProgressEntry> | null;
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.status !== "string" || !(SCAN_SOURCE_STATUSES as readonly string[]).includes(entry.status)) continue;
    map[sourceId] = {
      kind: entry.kind === "mention" ? "mention" : "ad_library",
      label: typeof entry.label === "string" && entry.label ? entry.label : sourceId,
      status: entry.status,
      detail: typeof entry.detail === "string" ? entry.detail : null,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
    };
  }
  return map;
}

export function summarizeScanProgress(
  progress: ScanSourceProgressMap,
): ScanSourceProgressSummary {
  const entries = Object.entries(progress)
    .map(([sourceId, entry]) => ({ sourceId, ...entry }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const done = entries.filter((entry) => TERMINAL_SCAN_SOURCE_STATUSES.has(entry.status)).length;
  return { total: entries.length, done, remaining: entries.length - done, entries };
}

/**
 * Read the newest run's source progress for a watchlist. The page calls this
 * on every poll; a run with no fan-out (older rows, non-activation scans)
 * returns an empty summary so the UI can hide the block.
 */
export async function readLatestScanProgressForWatchlist(
  env: AppEnv,
  watchlistId: string,
): Promise<ScanSourceProgressSummary> {
  const row = await ensureDb(env)
    .prepare(
      `SELECT summary_json
       FROM watchlist_run
       WHERE watchlist_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(watchlistId)
    .first<{ summary_json: string | null }>();
  return summarizeScanProgress(parseSourceProgress(row?.summary_json ?? null));
}

/**
 * Race a source fetch against its per-source budget. The loser keeps running
 * detached (workerd discards it with the step); the caller records the
 * `timed_out` tick and moves on, which is what keeps a hung source from ever
 * blocking the first brief.
 */
export async function withScanSourceBudget<T>(
  work: Promise<T>,
  budgetMs: number,
): Promise<{ outcome: "completed"; value: T } | { outcome: "timed_out" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ outcome: "timed_out" }>((resolve) => {
    timer = setTimeout(() => resolve({ outcome: "timed_out" }), budgetMs);
  });
  try {
    return await Promise.race([
      work.then(
        (value) => ({ outcome: "completed" as const, value }),
        (error: unknown) => {
          throw error;
        },
      ),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
