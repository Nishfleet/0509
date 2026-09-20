/**
 * Shared D1 quota-window ledger for the metered presence connectors
 * (consolidated from the per-connector copies in reddit/threads/youtube,
 * issue #3775).
 *
 * Each metered connector rides on ONE env-held credential (one Reddit OAuth
 * client, one Meta token, one Google API key), so the documented cap applies
 * to the SUM of every same-connector target's usage — not just the target
 * being polled. Each target's usage lives in its own
 * `presence_poll_cursor.cursor_json` under a connector key
 * (`redditUsage`/`threadsUsage`/`youtubeUsage`) as a TUMBLING window
 * `{ windowStart, count }`: all counted calls expire together at
 * `windowStart + windowMs`. Before fetching, the connector reads every
 * same-connector target's open window and refuses the poll once they total
 * the cap — the budget is enforced in connector logic and can never be
 * silently exceeded.
 *
 * The counter advances only because the poll orchestrator persists the
 * returned cursor back into `presence_poll_cursor.cursor_json`
 * (`pollPresenceSourceTarget` does) — a direct `poll` caller that drops the
 * cursor un-counts its own calls. The counter is a fail-safe floor, not a
 * mutex: polls are already serialized upstream by `runPresencePollingBatch`.
 */

export interface QuotaUsageWindow {
  windowStart: string;
  count: number;
}

export interface QuotaUsageLedger {
  /** Summed open-window counts across ALL same-connector targets. */
  used: number;
  /**
   * Folds this target's own prior cursor keys forward with the counter
   * incremented (or the window rotated) as required. `counted=false` keeps
   * the open window (or opens an empty one) without incrementing — for
   * connectors whose documented cap exempts empty-result calls.
   */
  nextCursor: (counted: boolean, extra?: Record<string, unknown>) => Record<string, unknown>;
}

export function parseCursorJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readUsageWindow(
  cursor: Record<string, unknown>,
  now: number,
  cursorKey: string,
  windowMs: number,
): QuotaUsageWindow | null {
  const raw = cursor[cursorKey];
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const { windowStart, count } = raw as Partial<QuotaUsageWindow>;
  if (typeof windowStart !== "string" || typeof count !== "number") {
    return null;
  }
  const started = new Date(windowStart).getTime();
  if (Number.isNaN(started) || now - started >= windowMs) {
    return null; // window closed — its calls no longer count
  }
  return { windowStart, count };
}

/**
 * Reads every `<connectorId>` target's `<cursorKey>` window out of
 * `presence_poll_cursor.cursor_json` and returns the fleet-wide total plus a
 * `nextCursor(counted, extra)` that folds this target's own prior cursor keys
 * forward with the counter incremented (or the window rotated) as required.
 */
export async function readQuotaWindowLedger(
  db: D1Database | undefined,
  options: { connectorId: string; cursorKey: string; windowMs: number },
  targetId: string,
): Promise<QuotaUsageLedger> {
  const now = Date.now();

  if (!db) {
    // No D1 binding means no cursor persistence either — nothing can be
    // tracked, so there is no prior usage to enforce against.
    return { used: 0, nextCursor: (_counted, extra = {}) => ({ ...extra }) };
  }

  const rows = await db
    .prepare(
      `SELECT st.id AS target_id, pc.cursor_json AS cursor_json
       FROM source_target st
       JOIN presence_poll_cursor pc ON pc.source_target_id = st.id
       WHERE st.connector_id = ? AND st.deleted_at IS NULL`,
    )
    .bind(options.connectorId)
    .all<{ target_id: string; cursor_json: string }>();

  let used = 0;
  let ownCursor: Record<string, unknown> = {};
  for (const row of rows.results ?? []) {
    const cursor = parseCursorJson(row.cursor_json);
    const window = readUsageWindow(cursor, now, options.cursorKey, options.windowMs);
    used += window?.count ?? 0;
    if (row.target_id === targetId) {
      ownCursor = cursor;
    }
  }

  const ownWindow = readUsageWindow(ownCursor, now, options.cursorKey, options.windowMs);
  const cursorKey = options.cursorKey;
  return {
    used,
    nextCursor: (counted, extra = {}) => {
      const window: QuotaUsageWindow = counted
        ? ownWindow
          ? { windowStart: ownWindow.windowStart, count: ownWindow.count + 1 }
          : { windowStart: new Date(now).toISOString(), count: 1 }
        : (ownWindow ?? { windowStart: new Date(now).toISOString(), count: 0 });
      return { ...ownCursor, ...extra, [cursorKey]: window };
    },
  };
}
