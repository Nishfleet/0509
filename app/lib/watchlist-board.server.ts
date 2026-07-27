import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Watch-board capture window (BL-006; brief §6.2).
 *
 * The board draws one 30-day capture strip per competitor, so it needs a
 * per-watchlist / per-day rollup for the WHOLE workspace. Three
 * workspace-scoped queries do it (checked days, captured days, consecutive
 * failures) — ownership stays in SQL and there is no id list to chunk, so a
 * 75-watchlist agency costs the same three round trips as a one-competitor
 * workspace (no D1 parameter ceiling, brief §11).
 *
 * Honesty rules baked into the shape:
 * - a day is `captured` only when a confirmed change is stored for it;
 * - a day is `quiet` only when a run actually completed that day;
 * - every other day stays absent, and the strip renders it as a labelled
 *   `unchecked` gap. We never fill a day we did not check (brief §8.1).
 *
 * The `waiting` state (accent bar, "a change waiting on you") is deliberately
 * NOT produced here: the product stores no per-viewer read state for a
 * captured change, and inventing one would be a claim without a source.
 */

/** Structural mirror of the capture-strip day; kept local so the server
 *  module never imports a React component. */
export type WatchBoardDayState = "quiet" | "captured";

export interface WatchBoardCaptureDay {
  date: string;
  state: WatchBoardDayState;
}

export interface WatchBoardCaptureWindow {
  /** Right edge of the strip, `YYYY-MM-DD` in UTC. */
  endDate: string;
  windowDays: number;
  /** watchlistId → the days we have evidence for (sparse, ascending). */
  days: Record<string, WatchBoardCaptureDay[]>;
  /** watchlistId → confirmed changes captured inside the window. */
  capturedChanges: Record<string, number>;
  /** Confirmed changes captured across the workspace inside the window. */
  totalCapturedChanges: number;
  /**
   * watchlistId → hard failures since the last successful run. Soft provider
   * cooldowns are excluded, exactly as the opened competitor's banner does,
   * so a rate limit never reads as broken tracking.
   */
  failedChecks: Record<string, number>;
}

export const WATCH_BOARD_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

interface DayRow {
  watchlist_id: string;
  day: string | null;
  hits: number | null;
}

export function emptyWatchBoardCaptureWindow(
  now: Date = new Date(),
  windowDays: number = WATCH_BOARD_WINDOW_DAYS,
): WatchBoardCaptureWindow {
  return {
    endDate: isoDay(now),
    windowDays,
    days: {},
    capturedChanges: {},
    totalCapturedChanges: 0,
    failedChecks: {},
  };
}

export async function loadWatchBoardCaptureWindow(
  env: AppEnv,
  userId: string,
  options: { now?: Date; windowDays?: number } = {},
): Promise<WatchBoardCaptureWindow> {
  const now = options.now ?? new Date();
  const windowDays = Math.max(1, Math.min(90, Math.floor(options.windowDays ?? WATCH_BOARD_WINDOW_DAYS)));
  if (!env.DB) {
    return emptyWatchBoardCaptureWindow(now, windowDays);
  }

  // Inclusive of today, so the window is exactly `windowDays` calendar days.
  const sinceIso = new Date(now.getTime() - (windowDays - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const [checkedRows, capturedRows, failedRows] = await Promise.all([
    queryAll<DayRow>(
      env,
      `
        SELECT watchlist_run.watchlist_id AS watchlist_id,
               date(watchlist_run.started_at) AS day,
               COUNT(*) AS hits
        FROM watchlist_run
        INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
        WHERE watchlist.user_id = ?
          AND watchlist_run.status = 'succeeded'
          AND watchlist_run.started_at >= ?
        GROUP BY watchlist_run.watchlist_id, date(watchlist_run.started_at)
      `,
      userId,
      sinceIso,
    ),
    queryAll<DayRow>(
      env,
      `
        SELECT watch_event.watchlist_id AS watchlist_id,
               date(watch_event.confirmed_at) AS day,
               COUNT(*) AS hits
        FROM watch_event
        INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
        WHERE watchlist.user_id = ?
          AND watch_event.status = 'confirmed'
          AND watch_event.confirmed_at IS NOT NULL
          AND watch_event.confirmed_at >= ?
        GROUP BY watch_event.watchlist_id, date(watch_event.confirmed_at)
      `,
      userId,
      sinceIso,
    ),
    // Consecutive hard failures = failed runs started after the newest
    // succeeded run. Soft provider cooldowns are skipped, matching the opened
    // competitor's failure banner, so a rate limit never reads as broken.
    queryAll<DayRow>(
      env,
      `
        SELECT watchlist_run.watchlist_id AS watchlist_id,
               NULL AS day,
               COUNT(*) AS hits
        FROM watchlist_run
        INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
        WHERE watchlist.user_id = ?
          AND watchlist_run.status = 'failed'
          AND COALESCE(watchlist_run.error_code, '') NOT IN ('rate_limited', 'cache_only')
          AND watchlist_run.started_at > COALESCE(
            (
              SELECT MAX(succeeded.started_at)
              FROM watchlist_run AS succeeded
              WHERE succeeded.watchlist_id = watchlist_run.watchlist_id
                AND succeeded.status = 'succeeded'
            ),
            ''
          )
        GROUP BY watchlist_run.watchlist_id
      `,
      userId,
    ),
  ]);

  return buildWatchBoardCaptureWindow({
    checkedRows,
    capturedRows,
    failedRows,
    now,
    windowDays,
  });
}

/**
 * Pure merge of the rollups — exported so the honest-degrade paths (a capture
 * with no completed run, a run with no capture, failures with no window) are
 * unit-testable without D1.
 */
export function buildWatchBoardCaptureWindow(input: {
  checkedRows: readonly DayRow[];
  capturedRows: readonly DayRow[];
  failedRows?: readonly DayRow[];
  now: Date;
  windowDays: number;
}): WatchBoardCaptureWindow {
  const endDate = isoDay(input.now);
  const startDate = isoDay(new Date(input.now.getTime() - (input.windowDays - 1) * DAY_MS));
  const byWatchlist = new Map<string, Map<string, WatchBoardDayState>>();
  const capturedChanges: Record<string, number> = {};
  let totalCapturedChanges = 0;

  const inWindow = (day: string | null): day is string =>
    typeof day === "string" && day >= startDate && day <= endDate;

  for (const row of input.checkedRows) {
    if (!row.watchlist_id || !inWindow(row.day)) continue;
    const days = byWatchlist.get(row.watchlist_id) ?? new Map<string, WatchBoardDayState>();
    days.set(row.day, "quiet");
    byWatchlist.set(row.watchlist_id, days);
  }

  for (const row of input.capturedRows) {
    if (!row.watchlist_id || !inWindow(row.day)) continue;
    const hits = toCount(row.hits);
    if (hits === 0) continue;
    // A stored change outranks the run rollup: evidence exists even when the
    // run that produced it fell outside the succeeded-run window.
    const days = byWatchlist.get(row.watchlist_id) ?? new Map<string, WatchBoardDayState>();
    days.set(row.day, "captured");
    byWatchlist.set(row.watchlist_id, days);
    capturedChanges[row.watchlist_id] = (capturedChanges[row.watchlist_id] ?? 0) + hits;
    totalCapturedChanges += hits;
  }

  const days: Record<string, WatchBoardCaptureDay[]> = {};
  for (const [watchlistId, dayMap] of byWatchlist) {
    days[watchlistId] = [...dayMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, state]) => ({ date, state }));
  }

  const failedChecks: Record<string, number> = {};
  for (const row of input.failedRows ?? []) {
    if (!row.watchlist_id) continue;
    const hits = toCount(row.hits);
    if (hits > 0) failedChecks[row.watchlist_id] = hits;
  }

  return {
    endDate,
    windowDays: input.windowDays,
    days,
    capturedChanges,
    totalCapturedChanges,
    failedChecks,
  };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
