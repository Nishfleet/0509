import type { WatchlistRecord } from "~/lib/types";
import {
  WATCH_BAND_FAILURE_THRESHOLD,
  resolveWatchBandState,
  type WatchBandState,
} from "~/lib/watchlist-display";

/**
 * BL-030 — the Competitors list, as a list.
 *
 * Pure presentation over the loader payload. Every sentence below is derived
 * from stored evidence the list loader already has: whether the competitor is
 * active, whether a check has ever completed, how many changes were captured
 * inside the capture window, and how many checks failed in a row. Nothing here
 * invents a headline it cannot read — the list loader deliberately does not
 * load per-competitor events (that is one query per band), so a row states the
 * shape of what happened and the detail pane states what it was.
 */

export const COMPETITOR_FILTER_PARAM = "state";

export type CompetitorFilter = "all" | "caught" | "quiet" | "attention" | "paused";

export const COMPETITOR_FILTERS: readonly CompetitorFilter[] = [
  "all",
  "caught",
  "quiet",
  "attention",
  "paused",
] as const;

const FILTER_LABELS: Record<CompetitorFilter, string> = {
  all: "All",
  caught: "Caught",
  quiet: "Quiet",
  attention: "Attention",
  paused: "Paused",
};

export function competitorFilterLabel(filter: CompetitorFilter) {
  return FILTER_LABELS[filter];
}

/** Tabs are navigation: the active filter is read off the URL, never state. */
export function resolveCompetitorFilter(raw: string | null | undefined): CompetitorFilter {
  const value = raw?.trim().toLowerCase();
  return (COMPETITOR_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as CompetitorFilter)
    : "all";
}

export interface CompetitorRow {
  id: string;
  name: string;
  targetLabel: string;
  state: WatchBandState;
  statusLabel: string;
  statusTone: "quiet" | "on" | "bad";
  /** The one plain sentence. */
  line: string;
  lastScannedAt: string | null;
  isActive: boolean;
  capturedChanges: number;
  failedChecks: number;
}

function toneFor(state: WatchBandState): "quiet" | "on" | "bad" {
  if (state === "caught") return "on";
  if (state === "attention") return "bad";
  return "quiet";
}

/**
 * Product voice: verbs, plain words, no exclamation marks, never blames the
 * customer, and always says what happens next. "Quiet" is written as a
 * finding, not as a gap.
 */
export function resolveCompetitorRowLine(input: {
  state: WatchBandState;
  capturedChanges: number;
  failedChecks: number;
  windowDays: number;
}): string {
  switch (input.state) {
    case "paused":
      return "Paused. No checks run and the history stays.";
    case "attention": {
      const failed = Math.max(input.failedChecks, WATCH_BAND_FAILURE_THRESHOLD);
      return `${failed} checks in a row failed. We're still retrying and the history stays.`;
    }
    case "caught": {
      const count = input.capturedChanges;
      return `${count} ${count === 1 ? "change" : "changes"} captured in the last ${input.windowDays} days.`;
    }
    case "watching":
      // The list loader does not read this competitor's runs (that is one
      // query per row), so it must not claim a capture is running. It states
      // the fact it has — nothing has completed — and what happens next.
      return "No completed check yet. This row updates itself when the first capture lands.";
    default:
      return `Checked, and nothing has changed in the last ${input.windowDays} days.`;
  }
}

export function toCompetitorRows(input: {
  watchlists: readonly WatchlistRecord[];
  capturedChanges: Record<string, number>;
  failedChecks?: Record<string, number>;
  windowDays: number;
}): CompetitorRow[] {
  return input.watchlists.map((watchlist) => {
    const capturedChanges = input.capturedChanges[watchlist.id] ?? 0;
    const failedChecks = input.failedChecks?.[watchlist.id] ?? 0;
    const stamp = resolveWatchBandState({
      isActive: watchlist.isActive,
      lastScannedAt: watchlist.lastScannedAt,
      capturedChanges,
      failedChecks,
    });
    return {
      id: watchlist.id,
      name: watchlist.name,
      targetLabel: watchlist.targetLabel,
      state: stamp.state,
      statusLabel: stamp.label,
      statusTone: toneFor(stamp.state),
      line: resolveCompetitorRowLine({
        state: stamp.state,
        capturedChanges,
        failedChecks,
        windowDays: input.windowDays,
      }),
      lastScannedAt: watchlist.lastScannedAt,
      isActive: watchlist.isActive,
      capturedChanges,
      failedChecks,
    };
  });
}

export function countCompetitorStates(
  rows: readonly CompetitorRow[],
): Record<CompetitorFilter, number> {
  return {
    all: rows.length,
    caught: rows.filter((row) => row.state === "caught").length,
    // "Quiet" on the tab bar means "checked and nothing changed", which is
    // what the row says too. A competitor still waiting for its first capture
    // is Watching, and it is counted in All only — claiming it as quiet would
    // be the dishonest read the board exists to avoid.
    quiet: rows.filter((row) => row.state === "quiet").length,
    attention: rows.filter((row) => row.state === "attention").length,
    paused: rows.filter((row) => row.state === "paused").length,
  };
}

export function filterCompetitorRows(
  rows: readonly CompetitorRow[],
  filter: CompetitorFilter,
): CompetitorRow[] {
  if (filter === "all") return [...rows];
  return rows.filter((row) => row.state === filter);
}

/**
 * The one context line under the page title. It answers "which of my
 * competitors moved, and is the machine running" before anything is scrolled.
 */
export function formatCompetitorContextLine(input: {
  rows: readonly CompetitorRow[];
  windowDays: number;
}): string {
  const total = input.rows.length;
  if (total === 0) {
    return "No competitors yet. Add one and its first check starts immediately.";
  }
  const noun = total === 1 ? "competitor" : "competitors";
  const counts = countCompetitorStates(input.rows);
  if (counts.caught > 0) {
    const verb = counts.caught === 1 ? "changed" : "changed";
    return `${total} ${noun}. ${counts.caught} ${verb} in the last ${input.windowDays} days.`;
  }
  if (counts.attention > 0) {
    return `${total} ${noun}. ${counts.attention} needs attention; the rest are quiet.`;
  }
  if (counts.paused === total) {
    return `${total} ${noun}. All paused — no checks run until you resume one.`;
  }
  if (counts.quiet === 0) {
    return `${total} ${noun}. The first captures are still running.`;
  }
  return `${total} ${noun}. Nothing has changed in the last ${input.windowDays} days.`;
}
