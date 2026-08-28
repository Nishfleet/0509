/**
 * Run-history capture attempts — read path for issue #1289.
 *
 * `proof_capture` rows are append-only and have no `run_id` column (the
 * issue explicitly forbids a migration). A capture belongs to a run when
 * its `proof_target` belongs to the run's watchlist AND its `attempted_at`
 * falls inside the run's `[started_at, finished_at]` window. For an
 * in-flight run (`finished_at IS NULL`) the upper bound is now, so a
 * partial run still shows what it has checked so far.
 *
 * Every monitoring run that checked a URL produces at least one visible
 * row here — a failed or skipped capture is never silent. A capture that
 * failed as an error/maintenance page AND whose target later had a
 * successful capture is labelled `takedown_restore` so the restore half of
 * the cycle is named honestly, not just `error_page`.
 */
import { queryAll } from "~/lib/data/d1.server";
import { parseJson, type JsonRecord } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import {
  toPublicCaptureStatus,
  toPublicReasonCode,
  type CaptureAttemptReasonCode,
  type CaptureAttemptStatus,
} from "~/lib/capture-attempt-reason-code";
import type { WatchlistRunRecord } from "~/lib/types";

/**
 * The public `capture_attempts` entry shape — exactly what the
 * `/api/v1/watchlists/:id/runs/latest` response and the run-history UI
 * render. `reason_code` is `null` only for succeeded captures and for
 * unclassifiable empty codes; the row is still visible either way.
 */
export interface CaptureAttempt {
  id: string;
  status: CaptureAttemptStatus;
  reasonCode: CaptureAttemptReasonCode | null;
  screenshotArtifactKey: string | null;
  errorMessage: string | null;
  urlChecked: string | null;
  checkedAt: string;
}

interface CaptureAttemptRow {
  id: string;
  proof_target_id: string;
  status: string;
  skip_reason: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  screenshot_artifact_key: string | null;
  capture_metadata_json: string;
  attempted_at: string;
  landing_page_url: string | null;
}

/**
 * Targets in this watchlist that had at least one failed `landing_error_page`
 * capture followed (later) by a successful capture of the same target — the
 * restore half of a takedown/restore cycle. Keyed by proof_target id.
 */
async function takedownRestoreTargetIds(
  env: AppEnv,
  watchlistId: string,
  sinceIso: string,
): Promise<Set<string>> {
  const rows = await queryAll<{ proof_target_id: string }>(
    env,
    `
      SELECT DISTINCT failed.proof_target_id
      FROM proof_capture AS failed
      INNER JOIN proof_capture AS restored
        ON restored.proof_target_id = failed.proof_target_id
        AND restored.status = 'succeeded'
        AND restored.attempted_at > failed.attempted_at
      INNER JOIN proof_target ON proof_target.id = failed.proof_target_id
      WHERE proof_target.watchlist_id = ?
        AND failed.status = 'failed'
        AND (failed.failure_code = 'landing_error_page'
          OR json_extract(failed.capture_metadata_json, '$.unreadableReasonCode') = 'landing_error_page')
        AND failed.attempted_at >= ?
    `,
    watchlistId,
    sinceIso,
  );
  return new Set(rows.map((row) => row.proof_target_id));
}

/**
 * Load the capture attempts that belong to a single watchlist run.
 *
 * Returns an empty array only when the run checked no URLs (e.g. a
 * `skipped` capacity run). A run that did check URLs always returns at
 * least one row, including failed and skipped captures.
 */
export async function listCaptureAttemptsForRun(
  env: AppEnv,
  run: Pick<WatchlistRunRecord, "watchlistId" | "startedAt" | "finishedAt">,
): Promise<CaptureAttempt[]> {
  if (!env.DB) return [];

  const upperBound = run.finishedAt ?? new Date().toISOString();
  // Look back a little before the run start so a capture attempted just
  // before the run row was created (the pipeline creates the run row after
  // reserving the first target) still lands in the window.
  const lowerBound = new Date(
    Date.parse(run.startedAt) - 60_000,
  ).toISOString();

  const takedownTargets = await takedownRestoreTargetIds(
    env,
    run.watchlistId,
    lowerBound,
  ).catch(() => new Set<string>());

  const rows = await queryAll<CaptureAttemptRow>(
    env,
    `
      SELECT
        proof_capture.id,
        proof_capture.proof_target_id,
        proof_capture.status,
        proof_capture.skip_reason,
        proof_capture.failure_code,
        proof_capture.failure_reason,
        proof_capture.screenshot_artifact_key,
        proof_capture.capture_metadata_json,
        proof_capture.attempted_at,
        proof_target.landing_page_url
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      WHERE proof_target.watchlist_id = ?
        AND proof_capture.attempted_at >= ?
        AND proof_capture.attempted_at <= ?
      ORDER BY proof_capture.attempted_at DESC, proof_capture.id DESC
    `,
    run.watchlistId,
    lowerBound,
    upperBound,
  );

  return rows.map((row) =>
    toCaptureAttempt(row, {
      isTakedownRestore: takedownTargets.has(row.proof_target_id),
    }),
  );
}

function toCaptureAttempt(
  row: CaptureAttemptRow,
  options: { isTakedownRestore: boolean },
): CaptureAttempt {
  const metadata = parseJson<JsonRecord>(row.capture_metadata_json, {});
  const internalCode =
    row.failure_code ??
    (typeof metadata.unreadableReasonCode === "string"
      ? metadata.unreadableReasonCode
      : null) ??
    row.skip_reason ??
    null;

  const isTakedownRestore =
    options.isTakedownRestore &&
    (internalCode === "landing_error_page" ||
      internalCode === "landing_http_error");

  return {
    id: row.id,
    status: toPublicCaptureStatus(row.status),
    reasonCode: toPublicReasonCode(internalCode, { isTakedownRestore }),
    screenshotArtifactKey: row.screenshot_artifact_key,
    errorMessage: row.failure_reason,
    urlChecked: row.landing_page_url,
    checkedAt: row.attempted_at,
  };
}
