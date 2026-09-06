import {
  buildCompetitorImportPreview,
  COMPETITOR_IMPORT_MAX_ROWS,
} from "~/lib/competitor-import";
import type { AppEnv } from "~/lib/env.server";

/**
 * Auto competitor watch — Phase 4 (#1372): long-tail bulk accept.
 *
 * Shapes the suggested-competitor candidates from the Phase 2 panel loader
 * into the EXISTING competitor-import bulk path (`buildCompetitorImportPreview`
 * → `createWatchlistWithinLimit`), so a many-advertiser vertical can accept a
 * filtered subset of auto-suggested candidates in one plan-capped action
 * instead of hand-adding each via the one-click Phase 2 accept.
 *
 * Reuse contract (fleet-ops#517 hand-build rule): this module NEVER forks a
 * new bulk importer. It builds a `CompetitorImportPreviewInput` (CSV rawText
 * + selectedRowIds), calls the existing `buildCompetitorImportPreview`, and
 * delegates watchlist creation to the existing `createWatchlistWithinLimit`
 * — the same surface the market-desk import uses. Cap enforcement and the
 * `over_cap` row status come from the existing importer; this module only
 * adapts the candidate shape and aggregates the per-row results.
 *
 * Cap-respect contract (eval 3.5): when N + currentCount > planLimit, exactly
 * (planLimit - currentCount) candidates are admitted and the remainder are
 * returned with status `over_cap` and a named reason — never silently
 * dropped, never silently admitted.
 *
 * Idempotency contract: re-accepting an already-watched candidate does not
 * create a duplicate watchlist. The preview marks fingerprint matches as
 * `existing` (skipped before create); `createWatchlistWithinLimit`'s
 * existing-fingerprint SELECT + INSERT OR IGNORE is the backstop for a
 * candidate accepted between panel render and bulk accept.
 */

export interface BulkAcceptCandidate {
  candidateId: string;
  advertiser: string;
  landingPageUrl: string | null;
  targetCountry: string | null;
}

export interface BulkAcceptOverCapRow {
  candidateId: string;
  advertiser: string;
  reason: string;
}

export interface BulkAcceptResult {
  ok: boolean;
  error?: "plan_limit_exceeded" | "candidate_unknown";
  message: string;
  admittedCount: number;
  existingCount: number;
  overCapCount: number;
  overCapRows: BulkAcceptOverCapRow[];
  createdWatchlistIds: string[];
}

export interface BulkAcceptOptions {
  env: AppEnv;
  workspaceUserId: string;
  candidates: ReadonlyArray<BulkAcceptCandidate>;
  planLimit: number;
  currentCount: number;
  existingFingerprints: readonly string[];
}

/**
 * Shape the suggested candidates as the `name,website` CSV the existing
 * competitor-import parser recognises. The importer's header detector
 * (`hasKnownHeader`) matches both columns, so each data row maps cleanly to a
 * `CompetitorImportRow` with a prepared `CompetitorImportWatchlistInput`
 * target — the same shape `createWatchlistWithinLimit` consumes everywhere
 * else. A candidate with no landing page emits an empty website cell; the
 * importer then falls back to the advertiser name as the watch target.
 */
function shapeCandidatesAsImportCsv(
  candidates: ReadonlyArray<BulkAcceptCandidate>,
): string {
  const header = "name,website";
  const lines = candidates.map((candidate) => {
    const name = csvCell(candidate.advertiser);
    const website = candidate.landingPageUrl ? csvCell(candidate.landingPageUrl) : "";
    return `${name},${website}`;
  });
  return [header, ...lines].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildBulkAcceptMessage(input: {
  admittedCount: number;
  existingCount: number;
  overCapCount: number;
}): string {
  const parts: string[] = [];
  if (input.admittedCount > 0) {
    parts.push(
      `Now watching ${input.admittedCount} new competitor${input.admittedCount === 1 ? "" : "s"}.`,
    );
  }
  if (input.existingCount > 0) {
    parts.push(
      `${input.existingCount} ${input.existingCount === 1 ? "was" : "were"} already on your watchlist.`,
    );
  }
  if (input.overCapCount > 0) {
    parts.push(
      `${input.overCapCount} ${input.overCapCount === 1 ? "row no longer fits" : "rows no longer fit"} your plan — pause another watchlist or upgrade to add them.`,
    );
  }
  if (parts.length === 0) {
    return "No competitors selected — nothing to add.";
  }
  return parts.join(" ");
}

export async function bulkAcceptSuggestedCompetitors(
  options: BulkAcceptOptions,
): Promise<BulkAcceptResult> {
  const { env, workspaceUserId, candidates, planLimit, currentCount, existingFingerprints } =
    options;

  // Zero selected candidates is a no-op, not an error (issue requirement).
  if (candidates.length === 0) {
    return {
      ok: true,
      message: "No competitors selected — nothing to add.",
      admittedCount: 0,
      existingCount: 0,
      overCapCount: 0,
      overCapRows: [],
      createdWatchlistIds: [],
    };
  }

  // Defensive cap to the existing importer's row ceiling. The panel loader
  // already caps at 8 candidates, so this only guards a caller that bypasses
  // the panel; the importer itself rejects > MAX_ROWS anyway.
  const capped = candidates.slice(0, COMPETITOR_IMPORT_MAX_ROWS);

  const { createWatchlistWithinLimit } = await import("~/lib/data.server");

  let admittedCount = 0;
  let existingCount = 0;
  const overCapRows: BulkAcceptOverCapRow[] = [];
  const createdWatchlistIds: string[] = [];

  // Group candidates by their own target country (fallback "all") so each
  // watchlist gets the correct country + fingerprint — the same per-candidate
  // semantics as the one-click accept and the existing importer's
  // `prepareImportRow`, which folds country into `targetCountry` and the
  // `watchlistFingerprint`. A sweep can span several countries (the panel
  // sorts by overlap across the whole workspace, not per country), so a
  // single batch-level country would mislabel every row outside the leader's
  // country and break cross-path idempotency. The existing bulk import path
  // is still the single accept surface: one preview+create pass per country
  // group (fleet-ops#517).
  const groups = new Map<string, BulkAcceptCandidate[]>();
  for (const candidate of capped) {
    const key = candidate.targetCountry?.trim() || "all";
    const group = groups.get(key);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(key, [candidate]);
    }
  }

  let runningCurrentCount = currentCount;
  for (const [country, group] of groups) {
    const rawText = shapeCandidatesAsImportCsv(group);
    // The importer assigns `row-${rowNumber}` ids; with a header row, data
    // rows start at rowNumber 2. Selecting every row id makes the preview's
    // cap enforcement mark the over-cap tail with `over_cap`.
    const selectedRowIds = group.map((_, index) => `row-${index + 2}`);

    const preview = buildCompetitorImportPreview({
      rawText,
      country,
      planLimit,
      currentCount: runningCurrentCount,
      existingFingerprints,
      selectedRowIds,
    });

    let groupAdmitted = 0;
    for (let index = 0; index < group.length; index += 1) {
      const candidate = group[index]!;
      const row = preview.rows[index];
      if (!row) {
        continue;
      }

    // Over-cap rows are flagged by the existing importer with the named
    // `over_cap` status and a human reason — never silently dropped, never
    // silently admitted (eval 3.5).
    if (row.status === "over_cap") {
      overCapRows.push({
        candidateId: candidate.candidateId,
        advertiser: candidate.advertiser,
        reason:
          row.reason ??
          "Over the current plan limit. Select fewer competitors or upgrade.",
      });
      continue;
    }

    // Already-watched candidates (fingerprint match) are marked `existing` by
    // the importer and skipped — idempotent at the preview layer.
    if (row.status === "existing") {
      existingCount += 1;
      continue;
    }

    // Within-batch duplicates and invalid rows are not admitted; the importer
    // has already flagged them with a named reason. They are not over-cap, so
    // they do not surface as over_cap rows.
    if (row.status === "duplicate" || row.status === "invalid") {
      continue;
    }

    // row.status === "valid" — create the watchlist via the existing path.
    if (!row.selected || !row.target) {
      continue;
    }

    const result = await createWatchlistWithinLimit(
      env,
      workspaceUserId,
      row.target,
      planLimit,
    );

    if (result.status === "created") {
      admittedCount += 1;
      groupAdmitted += 1;
      createdWatchlistIds.push(result.watchlist.id);
    } else if (result.status === "existing") {
      // INSERT OR IGNORE backstop: a candidate accepted between panel render
      // and bulk accept is caught here, not duplicated.
      existingCount += 1;
    } else if (result.status === "over_cap") {
      overCapRows.push({
        candidateId: candidate.candidateId,
        advertiser: candidate.advertiser,
        reason: "You hit your plan limit before we could create this row.",
      });
    }
    }
    // Carry admitted rows into the next country group so cap enforcement
    // (currentCount) stays cumulative across the whole batch.
    runningCurrentCount += groupAdmitted;
  }

  const overCapCount = overCapRows.length;
  const message = buildBulkAcceptMessage({
    admittedCount,
    existingCount,
    overCapCount,
  });

  return {
    ok: overCapCount === 0,
    error: overCapCount > 0 ? "plan_limit_exceeded" : undefined,
    message,
    admittedCount,
    existingCount,
    overCapCount,
    overCapRows,
    createdWatchlistIds,
  };
}
