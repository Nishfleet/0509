import type { AppEnv } from "~/lib/env.server";
import { execute, queryAll } from "~/lib/data/d1.server";
import {
  deleteProofArtifacts,
  parseProofArtifactKey,
} from "~/lib/proof-artifact-retention.server";

// Bounded retention deletes, run from the six-hourly warmup cron. Before
// this, thirteen tables grew forever (the only deletes in the codebase were
// rate-limit cleanup and rebuild deletes). Each step removes a small batch
// per tick via the id-subselect pattern — D1 has no DELETE ... LIMIT — so a
// backlog drains across ticks without blowing the invocation budget.
//
// Deliberately retained forever: digest_run/digest_item (customer-facing
// history), proof_usage_credit and the webhook event ledgers (billing audit
// trail), and the newest runs per watchlist (change-detection baselines).

const DAY_MS = 24 * 60 * 60 * 1000;

const FETCH_LOG_RETENTION_DAYS = 30;
const BROWSER_JOB_TELEMETRY_RETENTION_DAYS = 30;
const META_LOG_RETENTION_DAYS = 30;
const EXPIRED_CACHE_GRACE_DAYS = 7;
const MAGIC_LINK_TICKET_GRACE_DAYS = 1;
const WATCHLIST_RUN_RETENTION_DAYS = 90;
const WATCHLIST_RUN_KEEP_NEWEST = 5;
const DELIVERY_ATTEMPT_RETENTION_DAYS = 180;
const SNAPSHOT_RETENTION_DAYS = 90;
const RELEASE_SCHEDULED_OBSERVATION_RETENTION_DAYS = 90;

const PRESENCE_ITEM_RETENTION_DAYS = 180;
const SNAPSHOT_RETENTION_LIMIT = 20;

// R2 -> D1 orphan reconciliation. The landing-pages/ bucket holds objects that
// lose their D1 row and become invisible to the D1-driven sweep; this step
// lists the bucket directly and deletes objects with no D1 reference. The
// grace window lets a row written after its object (capture then commit)
// survive, and the per-tick cap keeps the invocation budget bounded.
const ORPHAN_RECONCILE_GRACE_DAYS = 7;
const ORPHAN_RECONCILE_MAX_DELETES = 200;
const ORPHAN_RECONCILE_LIST_LIMIT = 1000;
const ORPHAN_RECONCILE_STATE_ID = "r2_orphan_reconcile_cursor";
const ORPHAN_RECONCILE_ENABLED_VAR = "R2_ORPHAN_RECONCILE_ENABLED";

interface SnapshotRetentionCandidate {
  id: string;
  artifact_key: string | null;
  metadata_json: string | null;
}

interface ArtifactReferenceCount {
  external_references: number | string | null;
}

interface ProofCaptureRetentionCandidate {
  id: string;
  owner_user_id: string;
  html_artifact_key: string | null;
  screenshot_artifact_key: string | null;
}

export type RetentionSweepResult = {
  deleted: Record<string, number>;
  /** Stable step names only; database/provider error details are never returned. */
  failedSteps: string[];
  /** R2 -> D1 orphan reconciliation outcome. */
  orphanReconcile?: OrphanReconcileResult;
};

export type OrphanReconcileResult = {
  /** Objects listed from the bucket this tick. */
  listed: number;
  /** Objects deleted this tick (0 in dry-run mode). */
  deleted: number;
  /** Objects that would be deleted in dry-run mode. */
  dryRunDeletes: number;
  /** Objects skipped because they are referenced in D1. */
  referenced: number;
  /** Objects skipped because they are inside the grace window. */
  tooYoung: number;
  /** Objects skipped because they do not match the producer key shape. */
  nonMatching: number;
  /** True when the delete path is disabled and only counts are reported. */
  dryRun: boolean;
  /** True when the bucket page was truncated and a cursor was persisted. */
  truncated: boolean;
};

export async function runRetentionSweep(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<RetentionSweepResult> {
  if (!env.DB) {
    return { deleted: {}, failedSteps: [] };
  }

  const now = options.now?.getTime() ?? Date.now();
  const cutoff = (days: number) => new Date(now - days * DAY_MS).toISOString();

  const steps: Array<{ name: string; sql: string; bindings: unknown[] }> = [
    {
      name: "discovery_fetch_log",
      sql: `
        DELETE FROM discovery_fetch_log
        WHERE id IN (
          SELECT id FROM discovery_fetch_log
          WHERE created_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(FETCH_LOG_RETENTION_DAYS)],
    },
    {
      // Append-only browser-job attribution telemetry follows the same 30-day
      // policy as discovery_fetch_log; the deletion path is indexed via
      // idx_browser_job_telemetry_created (created_at) and batched.
      name: "browser_job_telemetry",
      sql: `
        DELETE FROM browser_job_telemetry
        WHERE id IN (
          SELECT id FROM browser_job_telemetry
          WHERE created_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(BROWSER_JOB_TELEMETRY_RETENTION_DAYS)],
    },
    {
      name: "discovery_cache_entry",
      sql: `
        DELETE FROM discovery_cache_entry
        WHERE cache_key IN (
          SELECT cache_key FROM discovery_cache_entry
          WHERE expires_at < ?
          LIMIT 200
        )
      `,
      bindings: [cutoff(EXPIRED_CACHE_GRACE_DAYS)],
    },
    {
      name: "better_auth_magic_link_ticket",
      sql: `
        DELETE FROM better_auth_magic_link_ticket
        WHERE id IN (
          SELECT id FROM better_auth_magic_link_ticket
          WHERE expires_at < ?
             OR consumed_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(MAGIC_LINK_TICKET_GRACE_DAYS), cutoff(MAGIC_LINK_TICKET_GRACE_DAYS)],
    },
    {
      // Pending signup attribution holds an email until the user row exists.
      // Expire it on the stored deadline so abandoned signups do not keep PII.
      name: "signup_source_pending",
      sql: `
        DELETE FROM signup_source_pending
        WHERE email IN (
          SELECT email FROM signup_source_pending
          WHERE expires_at < ?
          LIMIT 500
        )
      `,
      bindings: [new Date(now).toISOString()],
    },
    {
      name: "meta_integration_log",
      sql: `
        DELETE FROM meta_integration_log
        WHERE id IN (
          SELECT id FROM meta_integration_log
          WHERE created_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(META_LOG_RETENTION_DAYS)],
    },
    {
      // Old runs cascade-clean their ad_observation/watch_event/
      // event_candidate children. Kept out of deletion: runs referenced as a
      // change-detection baseline anywhere, and the newest N runs of every
      // watchlist (so a paused watchlist keeps its baseline when reactivated).
      name: "watchlist_run",
      sql: `
        DELETE FROM watchlist_run
        WHERE id IN (
          SELECT id FROM (
            SELECT
              id,
              started_at,
              ROW_NUMBER() OVER (
                PARTITION BY watchlist_id
                ORDER BY started_at DESC
              ) AS recency_rank
            FROM watchlist_run
          )
          WHERE recency_rank > ?
            AND started_at < ?
            AND id NOT IN (
              SELECT baseline_from_run_id FROM watchlist_run
              WHERE baseline_from_run_id IS NOT NULL
              UNION
              SELECT baseline_from_run_id FROM watch_event
              WHERE baseline_from_run_id IS NOT NULL
            )
          LIMIT 100
        )
      `,
      bindings: [WATCHLIST_RUN_KEEP_NEWEST, cutoff(WATCHLIST_RUN_RETENTION_DAYS)],
    },
    {
      // 180 days keeps delivery history through any billing-dispute window.
      name: "delivery_attempt",
      sql: `
        DELETE FROM delivery_attempt
        WHERE id IN (
          SELECT id FROM delivery_attempt
          WHERE created_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(DELIVERY_ATTEMPT_RETENTION_DAYS)],
    },
    {
      name: "presence_item",
      sql: `
        DELETE FROM presence_item
        WHERE id IN (
          SELECT id FROM presence_item
          WHERE created_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(PRESENCE_ITEM_RETENTION_DAYS)],
    },
    {
      name: "release_scheduled_observation",
      sql: `
        DELETE FROM release_scheduled_observation
        WHERE id IN (
          SELECT id FROM release_scheduled_observation
          WHERE completed_at < ?
          LIMIT 500
        )
      `,
      bindings: [cutoff(RELEASE_SCHEDULED_OBSERVATION_RETENTION_DAYS)],
    },
  ];

  const deleted: Record<string, number> = {};
  const failedSteps: string[] = [];

  for (const step of steps) {
    try {
      const result = await env.DB.prepare(step.sql).bind(...step.bindings).run();
      deleted[step.name] = Number(result.meta?.changes ?? 0);
    } catch (error) {
      // One stuck table must not stop the rest of the sweep.
      console.error(`[retention] delete failed for ${step.name}`, error);
      // Keep the returned summary customer-safe: step names are a fixed
      // allowlist above, while database errors may include sensitive details.
      failedSteps.push(step.name);
    }
  }

  try {
    const snapshotResult = await deleteExpiredLandingPageSnapshots(env, {
      cutoff: cutoff(SNAPSHOT_RETENTION_DAYS),
    });
    deleted.landing_page_snapshot = snapshotResult.deleted;
    if (snapshotResult.failed > 0) {
      failedSteps.push("landing_page_snapshot");
    }
  } catch {
    console.error("[retention] delete failed for landing_page_snapshot");
    failedSteps.push("landing_page_snapshot");
  }

  try {
    const proofResult = await deleteExpiredProofCaptureArtifacts(env, {
      cutoff: cutoff(SNAPSHOT_RETENTION_DAYS),
    });
    deleted.proof_capture_artifact = proofResult.cleared;
    if (proofResult.failed > 0) failedSteps.push("proof_capture_artifact");
  } catch {
    console.error("[retention] delete failed for proof_capture_artifact");
    failedSteps.push("proof_capture_artifact");
  }

  let orphanReconcile: OrphanReconcileResult | undefined;
  try {
    orphanReconcile = await reconcileOrphanedArtifacts(env, { now });
    if (orphanReconcile.deleted > 0) {
      deleted.r2_orphan_reconcile = orphanReconcile.deleted;
    }
  } catch {
    console.error("[retention] delete failed for r2_orphan_reconcile");
    failedSteps.push("r2_orphan_reconcile");
  }

  return { deleted, failedSteps, orphanReconcile };
}

/**
 * R2 -> D1 orphan reconciliation. Lists the landing-pages/ bucket one bounded
 * page per tick (cursor persisted in D1 so a single sweep never walks the whole
 * bucket) and deletes objects that have no D1 reference and are past the grace
 * window. Non-matching keys (e.g. backups/d1/) are never touched. The delete
 * path is gated behind R2_ORPHAN_RECONCILE_ENABLED; until it is set the step
 * runs in dry-run mode and only reports counts.
 */
export async function reconcileOrphanedArtifacts(
  env: AppEnv,
  options: { now?: number } = {},
): Promise<OrphanReconcileResult> {
  const now = options.now ?? Date.now();
  const dryRun = !isOrphanReconcileEnabled(env);
  const result: OrphanReconcileResult = {
    listed: 0,
    deleted: 0,
    dryRunDeletes: 0,
    referenced: 0,
    tooYoung: 0,
    nonMatching: 0,
    dryRun,
    truncated: false,
  };

  if (!env.DB || !env.LANDING_PAGE_ARTIFACTS) return result;

  const state = await readOrphanReconcileState(env);
  // When the delete path is first enabled after a dry-run walk, reset the
  // cursor so the live run starts from the beginning of the bucket instead of
  // resuming where the dry-run (which deleted nothing) left off.
  let cursor = state.cursor;
  if (!dryRun && state.mode === "dry-run") {
    cursor = null;
  }

  const page = await env.LANDING_PAGE_ARTIFACTS.list({
    prefix: "landing-pages/",
    cursor: cursor ?? undefined,
    limit: ORPHAN_RECONCILE_LIST_LIMIT,
  });
  result.listed = page.objects.length;
  result.truncated = page.truncated;

  let deletes = 0;
  let capHit = false;
  for (const object of page.objects) {
    if (deletes >= ORPHAN_RECONCILE_MAX_DELETES) {
      capHit = true;
      break;
    }
    const parsed = parseProofArtifactKey(object.key);
    if (!parsed) {
      result.nonMatching += 1;
      continue;
    }
    if (await artifactKeyReferencedInD1(env, parsed.key)) {
      result.referenced += 1;
      continue;
    }
    if (!artifactKeyPastGrace(parsed.key, now)) {
      result.tooYoung += 1;
      continue;
    }
    if (dryRun) {
      result.dryRunDeletes += 1;
      continue;
    }
    try {
      await env.LANDING_PAGE_ARTIFACTS.delete(parsed.key);
      deletes += 1;
      result.deleted += 1;
    } catch {
      // One failed delete must not stop the rest of the page.
      console.error("[retention] orphan delete failed", parsed.key);
    }
  }

  // Advance the cursor only when the whole page was processed. If the delete
  // cap was hit mid-page, leave the cursor unchanged so the next tick re-lists
  // the same page and continues (already-deleted objects no longer appear).
  const nextCursor = capHit ? cursor : page.truncated ? (page.cursor ?? null) : null;
  await writeOrphanReconcileState(env, nextCursor, dryRun ? "dry-run" : "delete", now);

  return result;
}

function isOrphanReconcileEnabled(env: AppEnv): boolean {
  const value = env[ORPHAN_RECONCILE_ENABLED_VAR as keyof AppEnv];
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

interface OrphanReconcileStateRow {
  cursor_value: string | null;
  mode: string | null;
}

async function readOrphanReconcileState(env: AppEnv): Promise<{ cursor: string | null; mode: string }> {
  const [row] = await queryAll<OrphanReconcileStateRow>(
    env,
    `
      SELECT cursor_value, mode
      FROM retention_sweep_state
      WHERE state_id = ?
    `,
    ORPHAN_RECONCILE_STATE_ID,
  );
  return {
    cursor: row?.cursor_value ?? null,
    mode: row?.mode === "delete" ? "delete" : "dry-run",
  };
}

async function writeOrphanReconcileState(
  env: AppEnv,
  cursor: string | null,
  mode: "dry-run" | "delete",
  now: number,
) {
  await execute(
    env,
    `
      INSERT INTO retention_sweep_state (state_id, cursor_value, mode, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(state_id) DO UPDATE SET
        cursor_value = excluded.cursor_value,
        mode = excluded.mode,
        updated_at = excluded.updated_at
    `,
    ORPHAN_RECONCILE_STATE_ID,
    cursor,
    mode,
    new Date(now).toISOString(),
  );
}

/**
 * True when the key is referenced anywhere in D1. Mirrors the shared/referenced
 * guards used by the D1-driven sweep so an object that still has a row (or a
 * row that references it via metadata or ad JSON) is never deleted.
 */
async function artifactKeyReferencedInD1(env: AppEnv, key: string) {
  const [row] = await queryAll<ArtifactReferenceCount>(
    env,
    `
      SELECT (
        SELECT COUNT(*) FROM proof_capture
        WHERE html_artifact_key = ? OR screenshot_artifact_key = ?
          OR (json_valid(capture_metadata_json) AND json_extract(capture_metadata_json, '$.desktopHtmlArtifactKey') = ?)
          OR (json_valid(capture_metadata_json) AND json_extract(capture_metadata_json, '$.desktopScreenshotArtifactKey') = ?)
      ) + (
        SELECT COUNT(*) FROM landing_page_snapshot
        WHERE artifact_key = ?
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.htmlArtifactKey') = ?)
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.screenshotArtifactKey') = ?)
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.desktopHtmlArtifactKey') = ?)
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.desktopScreenshotArtifactKey') = ?)
      ) + (
        SELECT COUNT(*) FROM ad
        WHERE json_valid(raw_json) AND (
          json_extract(raw_json, '$.landingPage.artifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.htmlArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.screenshotArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.desktopHtmlArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.desktopScreenshotArtifactKey') = ?
        )
      ) AS external_references
    `,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
  );
  return Number(row?.external_references ?? 0) > 0;
}

/** True when the date embedded in the key is at least the grace window old. */
function artifactKeyPastGrace(key: string, now: number): boolean {
  const match = /^landing-pages\/(\d{4}-\d{2}-\d{2})\//u.exec(key);
  if (!match) return false;
  const embedded = Date.parse(`${match[1]}T00:00:00.000Z`);
  if (Number.isNaN(embedded)) return false;
  return now - embedded >= ORPHAN_RECONCILE_GRACE_DAYS * DAY_MS;
}

export async function deleteExpiredProofCaptureArtifacts(
  env: AppEnv,
  options: { cutoff: string; limit?: number },
) {
  if (!env.DB) return { cleared: 0, failed: 0 };
  const limit = Math.max(1, Math.min(SNAPSHOT_RETENTION_LIMIT, options.limit ?? SNAPSHOT_RETENTION_LIMIT));
  const candidates = await queryAll<ProofCaptureRetentionCandidate>(
    env,
    `
      SELECT
        proof_capture.id,
        watchlist.user_id AS owner_user_id,
        proof_capture.html_artifact_key,
        proof_capture.screenshot_artifact_key
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE proof_capture.created_at < ?
        AND (
          proof_capture.html_artifact_key IS NOT NULL
          OR proof_capture.screenshot_artifact_key IS NOT NULL
        )
        AND (
          proof_target.last_successful_capture_id IS NULL
          OR proof_target.last_successful_capture_id <> proof_capture.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM watch_event
          WHERE watch_event.proof_capture_id = proof_capture.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM digest_item
          WHERE json_valid(digest_item.metadata_json)
            AND json_extract(digest_item.metadata_json, '$.proofCaptureId') = proof_capture.id
        )
      ORDER BY proof_capture.created_at ASC, proof_capture.id ASC
      LIMIT ?
    `,
    options.cutoff,
    limit,
  );

  let cleared = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const values = [candidate.html_artifact_key, candidate.screenshot_artifact_key]
      .filter((key): key is string => typeof key === "string");
    for (const value of new Set(values)) {
      const parsed = parseProofArtifactKey(value);
      if (!parsed) {
        failed += 1;
        continue;
      }
      try {
        if (await artifactReferencedOutsideProofCapture(env, candidate.id, parsed.key)) {
          const column = parsed.kind === "html" ? "html_artifact_key" : "screenshot_artifact_key";
          const metadataPath = parsed.kind === "html" ? "$.htmlArtifactKey" : "$.screenshotArtifactKey";
          const result = await execute(
            env,
            `
              UPDATE proof_capture
              SET ${column} = NULL,
                  capture_metadata_json = CASE
                    WHEN json_valid(capture_metadata_json)
                    THEN json_remove(capture_metadata_json, '${metadataPath}')
                    ELSE capture_metadata_json
                  END,
                  updated_at = ?
              WHERE id = ? AND ${column} = ? AND created_at < ?
            `,
            new Date().toISOString(),
            candidate.id,
            parsed.key,
            options.cutoff,
          );
          if (Number(result.meta?.changes ?? 0) !== 1) throw new Error("proof_capture_reference_not_cleared");
          cleared += 1;
          continue;
        }
        const [result] = await deleteProofArtifacts(env, candidate.owner_user_id, [parsed.key]);
        if (!result?.ok) throw new Error("proof_capture_artifact_not_deleted");
        cleared += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { cleared, failed };
}

export async function deleteExpiredLandingPageSnapshots(
  env: AppEnv,
  options: { cutoff: string; limit?: number },
) {
  if (!env.DB) return { deleted: 0, failed: 0 };
  const limit = Math.max(1, Math.min(SNAPSHOT_RETENTION_LIMIT, options.limit ?? SNAPSHOT_RETENTION_LIMIT));
  const candidates = await queryAll<SnapshotRetentionCandidate>(
    env,
    `
      SELECT snapshot.id, snapshot.artifact_key, snapshot.metadata_json
      FROM landing_page_snapshot AS snapshot
      WHERE snapshot.created_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM ad_observation
          WHERE ad_observation.landing_page_snapshot_id = snapshot.id
        )
      ORDER BY snapshot.created_at ASC, snapshot.id ASC
      LIMIT ?
    `,
    options.cutoff,
    limit,
  );

  let deleted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const keys = retentionArtifactKeys(candidate);
    if (!keys) {
      failed += 1;
      continue;
    }

    let rowFailed = false;
    for (const key of keys) {
      try {
        const referencedElsewhere = await artifactReferencedOutsideSnapshot(env, candidate.id, key);
        if (referencedElsewhere) continue;
        if (!env.LANDING_PAGE_ARTIFACTS) {
          rowFailed = true;
          break;
        }
        const existing = await env.LANDING_PAGE_ARTIFACTS.head(key);
        if (existing) await env.LANDING_PAGE_ARTIFACTS.delete(key);
      } catch {
        rowFailed = true;
        break;
      }
    }
    if (rowFailed) {
      failed += 1;
      continue;
    }

    try {
      const result = await execute(
        env,
        `
          DELETE FROM landing_page_snapshot
          WHERE id = ?
            AND created_at < ?
            AND NOT EXISTS (
              SELECT 1 FROM ad_observation
              WHERE ad_observation.landing_page_snapshot_id = landing_page_snapshot.id
            )
        `,
        candidate.id,
        options.cutoff,
      );
      deleted += Number(result.meta?.changes ?? 0);
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

function retentionArtifactKeys(candidate: SnapshotRetentionCandidate): string[] | null {
  let metadata: Record<string, unknown> = {};
  if (candidate.metadata_json) {
    try {
      const parsed = JSON.parse(candidate.metadata_json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      metadata = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const values = [
    candidate.artifact_key,
    metadata.htmlArtifactKey,
    metadata.screenshotArtifactKey,
    // Issue #3105: desktop-viewport evidence artifacts live only in snapshot
    // metadata; they must age out WITH the snapshot, never leak as orphans.
    metadata.desktopHtmlArtifactKey,
    metadata.desktopScreenshotArtifactKey,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const keys = new Set<string>();
  for (const value of values) {
    const parsed = parseProofArtifactKey(value);
    if (!parsed) return null;
    keys.add(parsed.key);
  }
  return [...keys];
}

async function artifactReferencedOutsideSnapshot(env: AppEnv, snapshotId: string, key: string) {
  const [row] = await queryAll<ArtifactReferenceCount>(
    env,
    `
      SELECT (
        SELECT COUNT(*) FROM landing_page_snapshot AS other
        WHERE other.id <> ? AND (
          other.artifact_key = ?
          OR (json_valid(other.metadata_json) AND json_extract(other.metadata_json, '$.htmlArtifactKey') = ?)
          OR (json_valid(other.metadata_json) AND json_extract(other.metadata_json, '$.screenshotArtifactKey') = ?)
          OR (json_valid(other.metadata_json) AND json_extract(other.metadata_json, '$.desktopHtmlArtifactKey') = ?)
          OR (json_valid(other.metadata_json) AND json_extract(other.metadata_json, '$.desktopScreenshotArtifactKey') = ?)
        )
      ) + (
        SELECT COUNT(*) FROM proof_capture
        WHERE html_artifact_key = ? OR screenshot_artifact_key = ?
          OR (json_valid(capture_metadata_json) AND json_extract(capture_metadata_json, '$.desktopHtmlArtifactKey') = ?)
          OR (json_valid(capture_metadata_json) AND json_extract(capture_metadata_json, '$.desktopScreenshotArtifactKey') = ?)
      ) + (
        SELECT COUNT(*) FROM ad
        WHERE json_valid(raw_json) AND (
          json_extract(raw_json, '$.landingPage.artifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.htmlArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.screenshotArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.desktopHtmlArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.desktopScreenshotArtifactKey') = ?
        )
      ) AS external_references
    `,
    snapshotId,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
  );
  return Number(row?.external_references ?? 0) > 0;
}

async function artifactReferencedOutsideProofCapture(env: AppEnv, proofCaptureId: string, key: string) {
  const [row] = await queryAll<ArtifactReferenceCount>(
    env,
    `
      SELECT (
        SELECT COUNT(*) FROM proof_capture AS other
        WHERE other.id <> ?
          AND (other.html_artifact_key = ? OR other.screenshot_artifact_key = ?
            OR (json_valid(other.capture_metadata_json) AND json_extract(other.capture_metadata_json, '$.desktopHtmlArtifactKey') = ?)
            OR (json_valid(other.capture_metadata_json) AND json_extract(other.capture_metadata_json, '$.desktopScreenshotArtifactKey') = ?)
          )
      ) + (
        SELECT COUNT(*) FROM landing_page_snapshot
        WHERE artifact_key = ?
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.htmlArtifactKey') = ?)
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.screenshotArtifactKey') = ?)
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.desktopHtmlArtifactKey') = ?)
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.desktopScreenshotArtifactKey') = ?)
      ) + (
        SELECT COUNT(*) FROM ad
        WHERE json_valid(raw_json) AND (
          json_extract(raw_json, '$.landingPage.artifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.htmlArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.screenshotArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.desktopHtmlArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.desktopScreenshotArtifactKey') = ?
        )
      ) AS external_references
    `,
    proofCaptureId,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
  );
  return Number(row?.external_references ?? 0) > 0;
}

export const MAX_SNAPSHOT_RETENTION_ROWS = SNAPSHOT_RETENTION_LIMIT;
